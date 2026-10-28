import { CAPTION_LINE_LIMITS, captionLineProblems } from '../shared/captionReview.ts'
import type { CaptionLine, CaptionOriginalLine } from '../shared/types.ts'

/** 자막 편집기의 줄 목록(시작순). 아래 함수는 모두 새 배열을 돌려주고 입력은 바꾸지 않는다. */
export type Lines = CaptionLine[]

const MIN = CAPTION_LINE_LIMITS.minSec
const round2 = (n: number) => Math.round(n * 100) / 100
const norm = (s: string) => s.trim().replace(/\s+/g, ' ')
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
const count = (s: string) => Array.from(s.replace(/\s/g, '')).length

export function setText(l: Lines, i: number, text: string): Lines {
  return l.map((x, k) => (k === i ? { ...x, text } : x))
}

/** 시작 시각: 앞 줄 끝 이상, 이 줄 끝-0.2초 이하(겹치지 않게). 숫자가 아니면 그대로. */
export function setStart(l: Lines, i: number, t: number): Lines {
  const cur = l[i]
  if (!cur || !Number.isFinite(t)) return l
  const lo = i > 0 ? l[i - 1]!.end : 0
  return l.map((x, k) => (k === i ? { ...x, start: round2(clamp(t, lo, Math.max(lo, cur.end - MIN))) } : x))
}

/** 끝 시각: 이 줄 시작+0.2초 이상, 다음 줄 시작(마지막 줄은 영상 끝) 이하. 숫자가 아니면 그대로. */
export function setEnd(l: Lines, i: number, t: number, videoSec: number): Lines {
  const cur = l[i]
  if (!cur || !Number.isFinite(t)) return l
  const lo = cur.start + MIN
  const hi = i < l.length - 1 ? l[i + 1]!.start : videoSec
  return l.map((x, k) => (k === i ? { ...x, end: round2(clamp(t, lo, Math.max(lo, hi))) } : x))
}

export function removeLine(l: Lines, i: number): Lines {
  return l.filter((_, k) => k !== i)
}

/**
 * startSec 에 durationSec 길이의 빈 글자 줄을 끼운다(글자를 쓰면 자막이 되고, 비워 두면 저장 때 빠진다).
 * 이미 있는 줄 안이면 그 줄 끝 뒤로 옮기고, 길이는 다음 줄 시작·영상 끝에서 자른다. 자리가 0.2초도 안 남으면 그대로.
 */
export function addLineAt(l: Lines, startSec: number, durationSec: number, videoSec: number): Lines {
  let s = Math.max(0, startSec)
  const inside = l.find((x) => s > x.start - 1e-9 && s < x.end)
  if (inside) s = inside.end
  const found = l.findIndex((x) => x.start >= s - 1e-9)
  const at = found < 0 ? l.length : found
  const nextStart = at < l.length ? l[at]!.start : videoSec
  const start = round2(s)
  const end = round2(Math.min(s + durationSec, nextStart, videoSec))
  if (end - start < MIN - 1e-9) return l
  return [...l.slice(0, at), { start, end, text: '' }, ...l.slice(at)]
}

/** 커서(charIndex) 위치에서 한 줄을 둘로 나눈다. 시간은 글자 수 비율로. 한쪽이 비거나 0.2초보다 짧아지면 그대로. */
export function splitLine(l: Lines, i: number, charIndex: number): Lines {
  const cur = l[i]
  if (!cur) return l
  const chars = Array.from(cur.text)
  const a = norm(chars.slice(0, charIndex).join(''))
  const b = norm(chars.slice(charIndex).join(''))
  if (!a || !b) return l
  const mid = round2(cur.start + ((cur.end - cur.start) * count(a)) / (count(a) + count(b)))
  if (mid - cur.start < MIN - 1e-9 || cur.end - mid < MIN - 1e-9) return l
  return [...l.slice(0, i), { start: cur.start, end: mid, text: a }, { start: mid, end: cur.end, text: b }, ...l.slice(i + 1)]
}

/** 다음 줄과 합친다(글자는 공백으로 잇고 시간은 앞 시작~뒤 끝). 다음 줄이 없으면 그대로. */
export function mergeWithNext(l: Lines, i: number): Lines {
  const cur = l[i]
  const next = l[i + 1]
  if (!cur || !next) return l
  return [...l.slice(0, i), { start: cur.start, end: next.end, text: norm(`${cur.text} ${next.text}`) }, ...l.slice(i + 2)]
}

/** 자막이 없는 구간(앞·사이·뒤에서 minGapSec 이상 비어 있는 곳). 빈 글자 줄도 자리를 차지한 것으로 본다. */
export function gapsOf(l: Lines, videoSec: number, minGapSec = 1): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = []
  let cursor = 0
  for (const x of [...l].sort((a, b) => a.start - b.start)) {
    if (x.start - cursor >= minGapSec - 1e-9) out.push({ start: round2(cursor), end: round2(x.start) })
    cursor = Math.max(cursor, x.end)
  }
  if (videoSec - cursor >= minGapSec - 1e-9) out.push({ start: round2(cursor), end: round2(videoSec) })
  return out
}

/** 서버로 보낼 줄: 빈 글자 줄을 빼고, 글자를 정리하고, 시각을 소수 둘째 자리로, 시작순으로. */
export function trackToSend(l: Lines): CaptionLine[] {
  return l
    .map((x) => ({ start: round2(x.start), end: round2(x.end), text: norm(x.text) }))
    .filter((x) => x.text !== '')
    .sort((a, b) => a.start - b.start)
}

/** 저장하지 않은 고침이 있나(서버가 준 현재 줄과 지금 줄을 보낼 모양으로 비교). 빈 줄만 늘어난 건 아니다. */
export function isDirty(base: Lines, current: Lines): boolean {
  return JSON.stringify(trackToSend(base)) !== JSON.stringify(trackToSend(current))
}

/** 지금 줄이 인식한 줄 그대로인가(의심 단어 칸은 보지 않는다) — 그러면 "원래대로" 상태다. */
export function sameAsOriginal(original: CaptionOriginalLine[], current: Lines): boolean {
  return JSON.stringify(trackToSend(original)) === JSON.stringify(trackToSend(current))
}

/**
 * 계획 요청에 자막을 어떻게 실을까. 고치지 않았으면 싣지 않고(저장된 건 그대로), 인식한 그대로로 되돌렸는데 저장된 고침이 있으면 null 로 비우고,
 * 그 밖에는 보낼 모양의 줄 전체를 싣는다(전부 지웠으면 빈 배열 = 자막 없음).
 */
export function trackPayload(review: { lines: Lines; original: CaptionOriginalLine[]; custom: boolean }, current: Lines): { captionTrack?: CaptionLine[] | null } {
  if (!isDirty(review.lines, current)) return {}
  if (sameAsOriginal(review.original, current)) return review.custom ? { captionTrack: null } : {}
  return { captionTrack: trackToSend(current) }
}

/** 줄마다 문제(한국어, 없으면 null). 빈 글자 줄은 저장 때 빠지니 문제가 아니다. */
export function lineProblems(l: Lines, videoSec: number): (string | null)[] {
  return captionLineProblems(l, videoSec).map((p, i) => (p === '글자가 비었어요' && l[i]!.text.trim() === '' ? null : p))
}

/** 줄 시간에 비해 글자가 초당 12자를 넘으면 경고(막지는 않는다). 빈 줄은 없다. */
export function rateWarning(line: CaptionLine): string | null {
  const n = count(line.text)
  const sec = Math.max(line.end - line.start, 0.1)
  return n / sec > 12 ? `이 줄은 ${sec.toFixed(1)}초인데 글자가 ${n}자라 자막이 너무 빨리 지나가요` : null
}

/** 이 줄과 가장 많이 겹치는 원래(인식한) 줄. 그 원래 줄의 30% 이상 겹쳐야 하고, 없으면 null. */
export function originalFor(original: CaptionOriginalLine[], line: CaptionLine): CaptionOriginalLine | null {
  let best: CaptionOriginalLine | null = null
  let bestOverlap = 0
  for (const o of original) {
    const overlap = Math.min(o.end, line.end) - Math.max(o.start, line.start)
    if (overlap > bestOverlap && overlap / Math.max(o.end - o.start, 1e-6) >= 0.3) {
      best = o
      bestOverlap = overlap
    }
  }
  return best
}
