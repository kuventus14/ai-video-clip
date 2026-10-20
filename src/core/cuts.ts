import { run } from './exec.ts'
import type { Span, Transcript, Word } from './types.ts'

export type CutReason = 'silence' | 'filler' | 'retake'
export interface CutPlan {
  kept: Span[]
  removed: (Span & { reason: CutReason })[]
  keptDurationSec: number
}

const MIN_SILENCE_SEC = 0.7
const MIN_KEPT_SEC = 0.3
const MIN_FILLER_SEC = 0.2
const MIN_PIECE_SEC = 0.05
const EDGE_SEC = 0.01
const RETAKE_SIMILARITY = 0.7
const RETAKE_MIN_TOKENS = 3
const FILLER = /^(음+|어+|으+음?|아+|에+)[.,…?!]*$/
const EPS = 1e-9
const PRIORITY: Record<CutReason, number> = { retake: 3, filler: 2, silence: 1 }

/** ffmpeg silencedetect 출력에서 무음 구간을 읽는다. 끝나지 않은 무음은 end = Infinity. 순수 함수. */
export function parseSilences(ffmpegStderr: string): Span[] {
  const out: Span[] = []
  let open: number | null = null
  for (const line of ffmpegStderr.split('\n')) {
    const s = line.match(/silence_start:\s*(-?[0-9.]+)/)
    if (s) open = Math.max(0, Number(s[1]))
    const e = line.match(/silence_end:\s*([0-9.]+)/)
    if (e && open !== null) {
      out.push({ start: open, end: Number(e[1]) })
      open = null
    }
  }
  if (open !== null) out.push({ start: open, end: Infinity })
  return out
}

async function hasAudioStream(p: string): Promise<boolean> {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', p])
  return stdout.trim().length > 0
}

export async function detectSilences(mediaPath: string, o: { noiseDb?: number; minSec?: number } = {}): Promise<Span[]> {
  if (!(await hasAudioStream(mediaPath))) return []
  const { stderr } = await run('ffmpeg', [
    '-hide_banner', '-nostdin', '-i', mediaPath,
    '-af', `silencedetect=noise=${o.noiseDb ?? -35}dB:d=${o.minSec ?? MIN_SILENCE_SEC}`,
    '-vn', '-f', 'null', '-',
  ])
  return parseSilences(stderr)
}

const overlaps = (a: Span, b: Span) => a.start < b.end - EPS && a.end > b.start + EPS

/** span 에서 holes 를 뺀 조각들 */
function subtract(span: Span, holes: Span[]): Span[] {
  let pieces: Span[] = [span]
  for (const h of holes) {
    pieces = pieces.flatMap((p) => {
      if (!overlaps(p, h)) return [p]
      const out: Span[] = []
      if (h.start > p.start) out.push({ start: p.start, end: h.start })
      if (h.end < p.end) out.push({ start: h.end, end: p.end })
      return out
    })
  }
  return pieces
}

function tokens(text: string): Set<string> {
  return new Set(text.replace(/[.,…?!"'“”]/g, '').split(/\s+/).filter(Boolean))
}

function similar(a: string, b: string): boolean {
  const ta = tokens(a)
  const tb = tokens(b)
  if (ta.size < RETAKE_MIN_TOKENS || tb.size < RETAKE_MIN_TOKENS) return false
  const inter = [...ta].filter((t) => tb.has(t)).length
  return inter / (ta.size + tb.size - inter) >= RETAKE_SIMILARITY
}

type Removal = Span & { reason: CutReason }

function mergeRemovals(list: Removal[]): Removal[] {
  const sorted = [...list].sort((a, b) => a.start - b.start)
  const out: Removal[] = []
  for (const r of sorted) {
    const last = out.at(-1)
    if (last && r.start <= last.end + EPS) {
      last.end = Math.max(last.end, r.end)
      if (PRIORITY[r.reason] > PRIORITY[last.reason]) last.reason = r.reason
    } else out.push({ ...r })
  }
  return out
}

function complement(removed: Span[], durationSec: number): Span[] {
  const kept: Span[] = []
  let cursor = 0
  for (const r of removed) {
    if (r.start > cursor + EPS) kept.push({ start: cursor, end: r.start })
    cursor = Math.max(cursor, r.end)
  }
  if (cursor < durationSec - EPS) kept.push({ start: cursor, end: durationSec })
  return kept
}

export function planCuts(i: { transcript: Transcript; silences: Span[]; durationSec: number; padSec: number }): CutPlan {
  const { transcript, durationSec, padSec } = i
  if (!transcript.hasSpeech) return { kept: [{ start: 0, end: durationSec }], removed: [], keptDurationSec: durationSec }

  const isFiller = (w: Word) => FILLER.test(w.text) && w.end - w.start >= MIN_FILLER_SEC
  const protectedSpans: Span[] = transcript.words.filter((w) => !isFiller(w)).map((w) => ({ start: w.start, end: w.end }))
  const raw: Removal[] = []

  for (const s of i.silences) {
    const start = Math.max(0, s.start)
    const end = Math.min(durationSec, s.end)
    if (end - start < MIN_SILENCE_SEC - EPS) continue
    const a = start <= EDGE_SEC ? 0 : start + padSec
    const b = end >= durationSec - EDGE_SEC ? durationSec : end - padSec
    if (b - a <= 0) continue
    for (const piece of subtract({ start: a, end: b }, protectedSpans)) {
      if (piece.end - piece.start >= MIN_PIECE_SEC) raw.push({ ...piece, reason: 'silence' })
    }
  }
  for (const w of transcript.words) if (isFiller(w)) raw.push({ start: w.start, end: w.end, reason: 'filler' })
  const segs = transcript.segments
  for (let k = 0; k < segs.length - 1; k++) {
    if (similar(segs[k]!.text, segs[k + 1]!.text)) raw.push({ start: segs[k]!.start, end: segs[k]!.end, reason: 'retake' })
  }

  let removed = mergeRemovals(raw.map((r) => ({ ...r, start: Math.max(0, r.start), end: Math.min(durationSec, r.end) })).filter((r) => r.end > r.start))

  // 0.3초 미만으로 남는 조각이 생기면: 말이 없으면 이웃 제거 구간과 합치고, 말이 있으면 그 말을 지키려고 짧은 쪽 제거를 취소한다
  for (let guard = 0; guard < 1000; guard++) {
    const kept = complement(removed, durationSec)
    const tiny = kept.find((k) => k.end - k.start < MIN_KEPT_SEC - EPS && k.start > EPS && k.end < durationSec - EPS)
    if (!tiny) break
    const before = removed.find((r) => Math.abs(r.end - tiny.start) < 1e-6)
    const after = removed.find((r) => Math.abs(r.start - tiny.end) < 1e-6)
    if (!before || !after) break
    if (protectedSpans.some((p) => overlaps(p, tiny))) {
      const shorter = before.end - before.start <= after.end - after.start ? before : after
      removed = removed.filter((r) => r !== shorter)
    } else {
      removed = mergeRemovals([...removed, { start: tiny.start, end: tiny.end, reason: before.reason }])
    }
  }

  const kept = complement(removed, durationSec)
  return { kept, removed, keptDurationSec: kept.reduce((s, k) => s + (k.end - k.start), 0) }
}
