import type { CaptionCue, CropKeyframe, Span, Word } from './types.ts'

const EPS = 1e-6
const MIN_WORD_SEC = 0.05
const KEYFRAME_LEAD_SEC = 0.001
const round6 = (n: number) => Math.round(n * 1e6) / 1e6

/** kept 의 각 구간이 출력 타임라인에서 시작하는 시각 */
function offsets(kept: Span[]): number[] {
  const out: number[] = []
  let acc = 0
  for (const k of kept) {
    out.push(acc)
    acc += k.end - k.start
  }
  return out
}

/** 원본 시각 t 를 컷 이후 시각으로. 제거된 구간이면 null. 구간 경계는 그 구간의 시작/끝으로 매핑된다. */
export function remapTime(t: number, kept: Span[]): number | null {
  const off = offsets(kept)
  for (const [i, k] of kept.entries()) {
    if (t >= k.start - EPS && t <= k.end + EPS) return round6(off[i]! + Math.min(Math.max(t, k.start), k.end) - k.start)
  }
  return null
}

/** 남은 구간과 겹치는 부분만 남겨 출력 시간으로 옮긴다. 제거 구간을 가로지르는 단어는 이어 붙인다. */
export function remapWords(words: Word[], kept: Span[]): Word[] {
  const off = offsets(kept)
  const out: Word[] = []
  for (const word of words) {
    let total = 0
    let first: number | null = null
    let last = 0
    for (const [i, k] of kept.entries()) {
      const a = Math.max(word.start, k.start)
      const b = Math.min(word.end, k.end)
      if (b - a <= EPS) continue
      total += b - a
      if (first === null) first = off[i]! + (a - k.start)
      last = off[i]! + (b - k.start)
    }
    if (first === null || total < MIN_WORD_SEC) continue
    out.push({ ...word, start: round6(first), end: round6(last) })
  }
  return out.sort((x, y) => x.start - y.start)
}

/** 원본 시간의 구간들을 남은 구간과 겹치는 부분만 컷 이후 시간으로 옮긴다 (시작 시각 순). */
export function remapSpans(spans: Span[], kept: Span[]): Span[] {
  const off = offsets(kept)
  const out: Span[] = []
  for (const s of spans) {
    for (const [i, k] of kept.entries()) {
      const a = Math.max(s.start, k.start)
      const b = Math.min(s.end, k.end)
      if (b - a <= EPS) continue
      out.push({ start: round6(off[i]! + a - k.start), end: round6(off[i]! + b - k.start) })
    }
  }
  return out.sort((x, y) => x.start - y.start)
}

/** 훅 장면을 맨 앞에 붙인 출력 타임라인. segments 는 출력 순서(훅이 있으면 첫째)대로의 원본 구간이다. */
export interface OutputTimeline {
  segments: Span[]
  /** 훅 길이(초). 훅이 없으면 0 */
  hookSec: number
  totalSec: number
}

export function buildTimeline(kept: Span[], hook?: Span): OutputTimeline {
  const hookSec = hook ? hook.end - hook.start : 0
  const segments = hook ? [hook, ...kept] : kept
  const totalSec = segments.reduce((sum, k) => sum + (k.end - k.start), 0)
  return { segments, hookSec: round6(hookSec), totalSec: round6(totalSec) }
}

/**
 * 원본 시각 t 를 출력 시각으로(훅 길이만큼 밀린다). 잘려 나간 자리면 그 뒤 첫 남은 구간의 시작에 붙인다
 * (오버레이가 "그 무렵"에 나오게). 영상 밖(음수, 마지막 남은 구간 뒤)이면 null.
 */
export function srcToOut(t: number, kept: Span[], hookSec: number): number | null {
  if (t < 0) return null
  const direct = remapTime(t, kept)
  if (direct !== null) return round6(direct + hookSec)
  const off = offsets(kept)
  const next = kept.findIndex((k) => k.start > t)
  return next < 0 ? null : round6(off[next]! + hookSec)
}

/** 자막 큐의 start·end 를 같이 민다. */
export function shiftCues<T extends { start: number; end: number }>(cues: T[], dt: number): T[] {
  return cues.map((c) => ({ ...c, start: round6(c.start + dt), end: round6(c.end + dt) }))
}

function interpolate(kf: CropKeyframe[], t: number): number {
  const first = kf[0]!
  const lastKf = kf.at(-1)!
  if (t <= first.t) return first.centerX
  if (t >= lastKf.t) return lastKf.centerX
  for (let i = 1; i < kf.length; i++) {
    const a = kf[i - 1]!
    const b = kf[i]!
    if (t <= b.t) return b.t === a.t ? b.centerX : a.centerX + ((b.centerX - a.centerX) * (t - a.t)) / (b.t - a.t)
  }
  return lastKf.centerX
}

/**
 * 원본 시간의 크롭 키프레임을 컷 이후 시간으로 옮긴다.
 * 남은 구간마다 시작·끝에 보간한 값을 찍고, 구간 사이는 한 번에 점프하도록 (끝 − 0.001초, 다음 시작) 두 점으로 둔다.
 */
export function remapKeyframes(kf: CropKeyframe[], kept: Span[]): CropKeyframe[] {
  if (!kf.length) return []
  const sorted = [...kf].sort((a, b) => a.t - b.t)
  const off = offsets(kept)
  const out: CropKeyframe[] = []
  const push = (t: number, centerX: number) => {
    const rt = round6(t)
    if (!out.length || rt > out.at(-1)!.t + 1e-9) out.push({ t: rt, centerX: round6(centerX) })
  }
  kept.forEach((k, i) => {
    const outStart = off[i]!
    const outEnd = outStart + (k.end - k.start)
    push(outStart, interpolate(sorted, k.start))
    for (const p of sorted) if (p.t > k.start + EPS && p.t < k.end - EPS) push(outStart + (p.t - k.start), p.centerX)
    push(i === kept.length - 1 ? outEnd : outEnd - KEYFRAME_LEAD_SEC, interpolate(sorted, k.end))
  })
  return out
}

const chars = (s: string) => s.replace(/\s/g, '').length

/** 단어를 자막 큐로 묶는다. 단어 경계에서만 나누고, 글자 수·길이·간격 한도를 지킨다. */
export function groupWordsIntoCues(
  words: Word[],
  o: { maxChars: number; maxDurationSec?: number; minDurationSec?: number },
): CaptionCue[] {
  const maxDuration = o.maxDurationSec ?? 2.5
  const minDuration = o.minDurationSec ?? 0.4
  const groups: Word[][] = []
  let cur: Word[] = []
  for (const w of words) {
    const prev = cur.at(-1)
    const fits =
      prev === undefined ||
      (chars(cur.map((x) => x.text).join('')) + chars(w.text) <= o.maxChars && w.end - cur[0]!.start <= maxDuration && w.start - prev.end <= 1)
    if (!fits) {
      groups.push(cur)
      cur = []
    }
    cur.push(w)
  }
  if (cur.length) groups.push(cur)

  const cues: CaptionCue[] = groups.map((g) => ({ text: g.map((x) => x.text).join(' '), start: g[0]!.start, end: g.at(-1)!.end }))
  cues.forEach((c, i) => {
    if (c.end - c.start >= minDuration) return
    const next = cues[i + 1]
    c.end = Math.max(c.end, Math.min(c.start + minDuration, next ? next.start : Infinity))
  })
  return cues
}
