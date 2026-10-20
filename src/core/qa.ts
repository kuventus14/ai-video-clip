import { run } from './exec.ts'
import { askClaude } from './llm.ts'
import { probeVideo } from './media.ts'
import { trackPeople } from './person.ts'
import {
  checkAudioLevels,
  checkBlackSegments,
  checkCueTiming,
  checkDuration,
  checkFraming,
  checkResolution,
  flagLowConfidence,
  parseBlackdetect,
  parseVolumeDetect,
  proofreadCues,
  type CueCorrection,
  type Finding,
} from './qaChecks.ts'
import { remapSpans } from './timeline.ts'
import type { Canvas, CaptionCue, Purpose, ReframeMode, Span, VideoInfo, Word } from './types.ts'

export interface QaInput {
  sourceInfo: VideoInfo
  outputPath: string
  canvas: Canvas
  reframe: ReframeMode
  cues: CaptionCue[]
  words: Word[]
  maxChars: number
  summary: { topic: string; genre: string }
  /** 자막을 끄고 만든 영상이면 true — 자막 점검을 건너뛴다 */
  skipCaptions?: boolean
  /** 용도에 비해 영상이 너무 긴지 점검한다 */
  purpose?: Purpose
  /** 원본 영상 경로와 남긴 구간 — 원본에도 있던 검은 구간을 결함으로 보지 않으려고 쓴다 */
  sourcePath?: string
  kept?: Span[]
}

export interface QaReport {
  /** high 가 하나도 없으면 true */
  passed: boolean
  findings: Finding[]
  /** 자막 교정 제안(적용 여부는 호출한 쪽이 정한다) */
  corrections: CueCorrection[]
  checkedAt: string
}

const LOW_CONFIDENCE = 0.5
const BLACKDETECT = 'blackdetect=d=0.5:pix_th=0.10'

/** span 이 others 와 겹치는 총 길이(초) */
function overlapSec(span: Span, others: Span[]): number {
  return others.reduce((sum, o) => sum + Math.max(0, Math.min(span.end, o.end) - Math.max(span.start, o.start)), 0)
}

export async function runQa(
  i: QaInput,
  deps: { ask?: typeof askClaude; track?: typeof trackPeople } = {},
): Promise<QaReport> {
  const track = deps.track ?? trackPeople
  const findings: Finding[] = []
  let corrections: CueCorrection[] = []

  // 1) 결과물 규격
  const out = await probeVideo(i.outputPath)
  if (out.durationSec < 0.1) findings.push({ id: 'output-empty', severity: 'high', message: '결과 영상이 비어 있어요.', fixHint: 'rerender-quality' })
  if (out.width !== i.canvas.width || out.height !== i.canvas.height) {
    findings.push({
      id: 'output-size',
      severity: 'high',
      message: `결과 영상 크기가 ${out.width}x${out.height} 로 목표(${i.canvas.width}x${i.canvas.height})와 달라요.`,
      fixHint: 'rerender-quality',
    })
  }
  if (i.sourceInfo.hasAudio && !out.hasAudio) {
    findings.push({ id: 'output-no-audio', severity: 'high', message: '원본에는 소리가 있었는데 결과 영상에 소리가 없어요.', fixHint: 'rerender-quality' })
  }

  // 2) 검은 화면
  const black = await run('ffmpeg', ['-hide_banner', '-nostdin', '-i', i.outputPath, '-vf', BLACKDETECT, '-an', '-f', 'null', '-'])
  let blackSpans = parseBlackdetect(black.stderr)
  if (blackSpans.some((s) => s.end - s.start >= 0.5) && i.sourcePath && i.kept) {
    // 원본에도 검은 구간(페이드·어두운 장면)이 있었다면 우리가 만든 결함이 아니다
    const sourceBlack = await run('ffmpeg', ['-hide_banner', '-nostdin', '-i', i.sourcePath, '-vf', BLACKDETECT, '-an', '-f', 'null', '-'])
    const expected = remapSpans(parseBlackdetect(sourceBlack.stderr), i.kept)
    blackSpans = blackSpans.filter((s) => overlapSec(s, expected) < (s.end - s.start) / 2)
  }
  findings.push(...checkBlackSegments(blackSpans))

  // 3) 오디오 레벨
  if (out.hasAudio) {
    const vol = await run('ffmpeg', ['-hide_banner', '-nostdin', '-i', i.outputPath, '-vn', '-af', 'volumedetect', '-f', 'null', '-'])
    findings.push(...checkAudioLevels(parseVolumeDetect(vol.stderr)))
  }

  // 4) 해상도(확대 배율), 용도에 비해 너무 긴지
  findings.push(...checkResolution(i.sourceInfo, i.canvas, i.reframe))
  if (i.purpose) findings.push(...checkDuration(i.purpose, out.durationSec))

  // 5) 자막
  if (i.skipCaptions) {
    findings.push({ id: 'captions-off', severity: 'info', message: '자막을 끄고 만든 영상이라 자막 점검은 건너뛰었어요.', fixHint: 'none' })
  } else if (!i.words.length) {
    findings.push({ id: 'no-speech', severity: 'info', message: '음성이 없어 자막 점검을 건너뛰었어요.', fixHint: 'none' })
  } else {
    findings.push(...checkCueTiming(i.cues, out.durationSec, i.maxChars))
    // 이미 교정돼 자막에서 사라진 단어는 더 이상 의심하지 않는다
    const suspect = i.words.filter((w) => w.confidence < LOW_CONFIDENCE && i.cues.some((c) => c.text.includes(w.text)))
    findings.push(...flagLowConfidence(suspect, LOW_CONFIDENCE))
    try {
      corrections = await proofreadCues(i.cues, { ...i.summary, suspectWords: suspect.map((w) => w.text) }, { ask: deps.ask })
      if (corrections.length) {
        findings.push({
          id: 'caption-corrections',
          severity: 'medium',
          message: `자막 ${corrections.length}곳에 오타·오인식 교정이 필요해 보여요.`,
          fixHint: 'recaption',
        })
      }
    } catch (e) {
      // 몇 분 걸려 만든 영상을 교정 호출 하나가 실패했다고 잃지 않는다
      findings.push({ id: 'proofread-failed', severity: 'info', message: `자막 교정 점검을 하지 못했어요 (${(e as Error).message})`, fixHint: 'none' })
    }
  }

  // 6) 세로 크롭의 인물 구도 (출력 영상에서 다시 찾은 위치로)
  if (i.reframe === 'track') findings.push(...checkFraming(await track(i.outputPath), i.reframe, i.canvas))

  return { passed: !findings.some((f) => f.severity === 'high'), findings, corrections, checkedAt: new Date().toISOString() }
}
