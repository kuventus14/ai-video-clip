import { z } from 'zod'
import { askClaude } from './llm.ts'
import type { PersonBox, PersonTrack } from './person.ts'
import type { Canvas, CaptionCue, Purpose, ReframeMode, Span, Word } from './types.ts'

export type Severity = 'high' | 'medium' | 'info'
export type FixHint = 'recaption' | 'rerender-quality' | 'recrop' | 'none'
export interface Finding {
  id: string
  severity: Severity
  message: string
  atSec?: number
  fixHint: FixHint
}

const MEDIUM_UPSCALE = 1.5
const HIGH_UPSCALE = 2.2
const MIN_BLACK_SEC = 0.5
const CLIP_DB = -0.1
const QUIET_DB = -35
const MIN_CUE_SEC = 0.3
const FRAMING_BAND: [number, number] = [0.25, 0.75]
const FRAMING_PASS_RATIO = 0.8
const EDGE_TOUCH = 0.005
const CLOSEUP_BODY_WIDTH = 0.8
const MIN_SAFE_SIMILARITY = 0.6
const SHORT_MAX_SEC = 180

/** 원본 화면이 출력 캔버스에서 확대되는 배율 (1 이하면 줄어듦) */
export function upscaleFactor(src: { width: number; height: number }, canvas: Canvas, mode: ReframeMode): number {
  if (mode === 'track') return canvas.height / src.height
  return Math.min(canvas.width / src.width, canvas.height / src.height)
}

export function checkResolution(src: { width: number; height: number }, canvas: Canvas, mode: ReframeMode): Finding[] {
  const f = upscaleFactor(src, canvas, mode)
  if (f <= MEDIUM_UPSCALE) return []
  return [
    {
      id: 'upscale',
      severity: f > HIGH_UPSCALE ? 'high' : 'medium',
      message: `원본 해상도가 낮아 화면이 ${f.toFixed(1)}배로 확대돼요. 선명도가 떨어질 수 있어요.`,
      fixHint: 'none',
    },
  ]
}

/** ffmpeg blackdetect 출력에서 검은 구간을 읽는다. */
export function parseBlackdetect(stderr: string): Span[] {
  return [...stderr.matchAll(/black_start:\s*([0-9.]+)\s+black_end:\s*([0-9.]+)/g)].map((m) => ({ start: Number(m[1]), end: Number(m[2]) }))
}

export function checkBlackSegments(spans: Span[]): Finding[] {
  return spans
    .filter((s) => s.end - s.start >= MIN_BLACK_SEC)
    .map((s) => ({
      id: 'black-frames',
      severity: 'high' as const,
      message: `${s.start.toFixed(1)}초부터 ${(s.end - s.start).toFixed(1)}초 동안 화면이 검게 나와요.`,
      atSec: s.start,
      fixHint: 'rerender-quality' as const,
    }))
}

/** ffmpeg volumedetect 출력에서 평균·최대 음량(dB)을 읽는다. 못 읽으면 던진다. */
export function parseVolumeDetect(stderr: string): { meanDb: number; maxDb: number } {
  const read = (key: string) => {
    const m = stderr.match(new RegExp(`${key}:\\s*(-?[0-9.]+|-inf)`))
    if (!m) throw new Error(`volumedetect 결과를 읽을 수 없어요 (${key})`)
    return m[1] === '-inf' ? -Infinity : Number(m[1])
  }
  return { meanDb: read('mean_volume'), maxDb: read('max_volume') }
}

export function checkAudioLevels(v: { meanDb: number; maxDb: number }): Finding[] {
  const out: Finding[] = []
  if (v.maxDb >= CLIP_DB) out.push({ id: 'audio-clipping', severity: 'medium', message: '소리가 너무 커서 찌그러질 수 있어요(클리핑).', fixHint: 'none' })
  if (v.meanDb < QUIET_DB) out.push({ id: 'audio-quiet', severity: 'medium', message: '전체적으로 소리가 너무 작아요.', fixHint: 'none' })
  return out
}

const chars = (s: string) => s.replace(/\s/g, '').length

export function checkCueTiming(cues: CaptionCue[], durationSec: number, maxChars: number): Finding[] {
  const out: Finding[] = []
  cues.forEach((c, i) => {
    const prev = cues[i - 1]
    if (prev && c.start < prev.end - 1e-6)
      out.push({ id: 'cue-overlap', severity: 'high', message: `자막이 겹쳐요: "${prev.text}" / "${c.text}"`, atSec: c.start, fixHint: 'recaption' })
    if (c.end - c.start < MIN_CUE_SEC - 1e-6)
      out.push({ id: 'cue-short', severity: 'medium', message: `자막 "${c.text}" 이(가) 너무 짧게 나와요.`, atSec: c.start, fixHint: 'recaption' })
    if (chars(c.text) > maxChars)
      out.push({ id: 'cue-too-long', severity: 'medium', message: `자막 "${c.text}" 이(가) 한 줄 ${maxChars}자를 넘어요.`, atSec: c.start, fixHint: 'recaption' })
    if (c.start < 0 || c.end > durationSec + 0.05)
      out.push({ id: 'cue-out-of-range', severity: 'medium', message: `자막 "${c.text}" 이(가) 영상 길이를 벗어나요.`, atSec: c.start, fixHint: 'recaption' })
  })
  return out
}

export function flagLowConfidence(words: Word[], threshold = 0.5): Finding[] {
  return words
    .filter((w) => w.confidence < threshold)
    .map((w) => ({
      id: 'low-confidence',
      severity: 'medium' as const,
      message: `"${w.text}" 을(를) 잘못 알아들었을 수 있어요 (신뢰도 ${Math.round(w.confidence * 100)}%).`,
      atSec: w.start,
      fixHint: 'recaption' as const,
    }))
}

export interface CueCorrection {
  index: number
  text: string
  reason: 'typo' | 'term' | 'spacing'
}

const Corrections = z.object({
  corrections: z.array(z.object({ index: z.number().int().min(0), text: z.string().min(1), reason: z.enum(['typo', 'term', 'spacing']) })),
})

/** 자막의 오타·오인식·전문 용어·띄어쓰기 오류를 LLM 으로 점검해 확실한 교정만 돌려준다. */
export async function proofreadCues(
  cues: CaptionCue[],
  ctx: { topic: string; genre: string; suspectWords?: string[] },
  deps: { ask?: typeof askClaude } = {},
): Promise<CueCorrection[]> {
  if (!cues.length) return []
  const ask = deps.ask ?? askClaude
  const prompt = [
    '당신은 한국어 영상 자막 교정자입니다. 아래 자막은 음성 인식 결과라 오인식·오타·띄어쓰기 오류가 있을 수 있습니다.',
    `영상 주제: ${ctx.topic} / 장르: ${ctx.genre}. 이 분야의 용어(예: 골프의 '백스윙')가 비슷한 소리로 잘못 적혔는지 특히 살피세요.`,
    ...(ctx.suspectWords?.length ? [`음성 인식기가 확신하지 못한 의심 단어: ${ctx.suspectWords.join(', ')} — 문맥상 어색하면 주제에 맞는 말로 고치세요.`] : []),
    '확실한 오류만 고치고, 의미를 바꾸거나 말투를 다듬지 마세요. 고칠 게 없으면 빈 배열을 돌려주세요.',
    '',
    '자막(번호: 글):',
    ...cues.map((c, i) => `${i}: ${c.text}`),
    '',
    '출력 형식(JSON 한 개, 다른 글 금지): {"corrections": [{"index": 번호, "text": "고친 자막 전체", "reason": "typo|term|spacing"}]}',
  ].join('\n')
  const { corrections } = await ask({ prompt, schema: Corrections, effort: 'low' })
  return corrections.filter((c) => c.index < cues.length && c.text.trim() !== cues[c.index]!.text.trim())
}

function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    let diagonal = prev[0]!
    prev[0] = i
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j]!
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1))
      diagonal = up
    }
  }
  return prev[b.length]!
}

/**
 * 교정이 원문에서 글자 몇 개만 바뀌는 안전한 수정인지(띄어쓰기를 뺀 글자 유사도 ≥ 0.6).
 * 음성 인식이 못 알아들은 말을 모델이 추측으로 새로 쓰는 교정은 근거가 없어 자동 적용하지 않는다.
 */
export function isSafeCorrection(original: string, corrected: string): boolean {
  const a = original.replace(/\s/g, '')
  const b = corrected.replace(/\s/g, '')
  if (!b) return false
  if (a === b) return true
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length) >= MIN_SAFE_SIMILARITY
}

/** 교정 제안을 자동 적용해도 되는 것과 제안으로만 남길 것으로 나눈다. 범위 밖 index 는 버린다. */
export function partitionCorrections(cues: CaptionCue[], corrections: CueCorrection[]): { safe: CueCorrection[]; unsafe: CueCorrection[] } {
  const safe: CueCorrection[] = []
  const unsafe: CueCorrection[] = []
  for (const c of corrections) {
    const cue = cues[c.index]
    if (!cue) continue
    ;(isSafeCorrection(cue.text, c.text) ? safe : unsafe).push(c)
  }
  return { safe, unsafe }
}

/** 용도에 비해 영상이 너무 길면 알린다 (릴스·숏츠는 3분 이하). */
export function checkDuration(purpose: Purpose, durationSec: number): Finding[] {
  if (purpose === 'short' && durationSec > SHORT_MAX_SEC) {
    return [
      {
        id: 'duration-for-purpose',
        severity: 'medium',
        message: `릴스·숏츠용인데 영상이 ${Math.round(durationSec)}초로 길어요. 보통 3분(${SHORT_MAX_SEC}초) 이하여야 올릴 수 있어요.`,
        fixHint: 'none',
      },
    ]
  }
  return []
}

export function applyCorrections(cues: CaptionCue[], corrections: CueCorrection[]): CaptionCue[] {
  const out = cues.map((c) => ({ ...c }))
  for (const c of corrections) if (c.index >= 0 && c.index < out.length) out[c.index]!.text = c.text
  return out
}

const area = (b: PersonBox) => b.w * b.h

/** 출력 영상에서 다시 찾은 사람 위치로 세로 크롭의 구도를 점검한다. (track 일 때만) */
export function checkFraming(track: PersonTrack, mode: ReframeMode, _canvas: Canvas): Finding[] {
  if (mode !== 'track') return []
  let withPerson = 0
  let good = 0
  let closeupUnjudged = 0
  const largest = (boxes: PersonBox[]) => boxes.reduce((a, b) => (area(b) > area(a) ? b : a))
  for (const s of track.samples) {
    const humans = s.boxes.filter((b) => b.kind === 'human')
    const faces = s.boxes.filter((b) => b.kind === 'face')
    let judged: PersonBox
    if (humans.length && largest(humans).w > CLOSEUP_BODY_WIDTH) {
      // 클로즈업: 몸이 화면 폭을 거의 채워 가장자리에 닿는 게 정상이므로 얼굴 박스로 판정한다
      if (!faces.length) {
        closeupUnjudged++
        continue
      }
      judged = largest(faces)
    } else {
      const pool = humans.length ? humans : faces
      if (!pool.length) continue
      judged = largest(pool)
    }
    withPerson++
    const cx = judged.x + judged.w / 2
    const touchesEdge = judged.x < EDGE_TOUCH || judged.x + judged.w > 1 - EDGE_TOUCH
    if (cx >= FRAMING_BAND[0] && cx <= FRAMING_BAND[1] && !touchesEdge) good++
  }
  if (withPerson === 0) {
    return closeupUnjudged > 0
      ? [{ id: 'framing-closeup', severity: 'info', message: '인물이 화면을 가득 채우는 클로즈업이라 구도를 정확히 확인하지 못했어요.', fixHint: 'none' }]
      : [{ id: 'framing-no-person', severity: 'info', message: '사람을 찾지 못해 인물 구도는 확인하지 못했어요.', fixHint: 'none' }]
  }
  if (good / withPerson < FRAMING_PASS_RATIO) {
    return [
      {
        id: 'framing',
        severity: 'high',
        message: `인물이 화면 중앙에서 벗어나거나 잘린 구간이 많아요 (${Math.round((good / withPerson) * 100)}%만 정상).`,
        fixHint: 'recrop',
      },
    ]
  }
  return []
}
