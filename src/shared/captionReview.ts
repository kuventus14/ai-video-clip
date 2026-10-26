import type { CaptionEdit, CaptionLine } from './types.ts'

/**
 * 자막 확인에 필요한 만큼만 아는 단어·인식 결과 모양(편집 엔진의 Word·Transcript 가 이 모양을 만족한다).
 * 화면 쪽(shared·web)은 core 를 가져오지 못하므로 여기서 구조만 정의한다.
 */
export interface ReviewWord {
  text: string
  start: number
  end: number
  /** 0..1 */
  confidence: number
}
export interface ReviewTranscript {
  words: ReviewWord[]
  segments: { text: string; start: number; end: number }[]
  hasSpeech: boolean
}
type Word = ReviewWord

/** 자막 확인 화면의 한 줄: 인식한 단어 words[from..to) 를 묶은 것 */
export interface ReviewPart {
  i: number
  start: number
  end: number
  text: string
  /** 인식기가 확신하지 못한 단어(신뢰도 0.5 미만) */
  lowWords: string[]
  from: number
  to: number
}

export const REVIEW_LIMITS = { maxChars: 18, maxGapSec: 0.7, lowConfidence: 0.5, maxTextChars: 160 } as const

const SENTENCE_END = /[.?!…。？！]$/
const SEGMENT_GAP_SEC = 0.8
const chars = (s: string) => Array.from(s.replace(/\s/g, '')).length
const norm = (s: string) => s.trim().replace(/\s+/g, ' ')
const round3 = (n: number) => Math.round(n * 1000) / 1000

/**
 * 인식한 단어를 사람이 확인하기 좋은 줄로 묶는다(결정적: 같은 transcript 는 늘 같은 줄 번호).
 * 새 줄은 글자 수(공백 뺀)가 18자를 넘기게 될 때, 앞 단어와 0.7초 넘게 떨어졌을 때, 앞 단어가 문장부호로 끝났을 때 연다.
 */
export function reviewParts(t: Pick<ReviewTranscript, 'words'>): ReviewPart[] {
  const parts: ReviewPart[] = []
  let from = 0
  let count = 0
  const close = (to: number) => {
    const ws = t.words.slice(from, to)
    parts.push({
      i: parts.length,
      start: ws[0]!.start,
      end: ws[ws.length - 1]!.end,
      text: ws.map((w) => w.text).join(' '),
      lowWords: ws.filter((w) => w.confidence < REVIEW_LIMITS.lowConfidence).map((w) => w.text),
      from,
      to,
    })
  }
  t.words.forEach((w, k) => {
    const prev = t.words[k - 1]
    const len = chars(w.text)
    if (k > 0 && (count + len > REVIEW_LIMITS.maxChars || w.start - prev!.end > REVIEW_LIMITS.maxGapSec || SENTENCE_END.test(prev!.text))) {
      close(k)
      from = k
      count = 0
    }
    count += len
  })
  if (t.words.length) close(t.words.length)
  return parts
}

/** 고친 단어 하나가 이보다 짧으면 이웃과 합친다(컷이 줄이면 최종 자막에서 0.05초 미만 단어는 사라진다) */
const MIN_WORD_SEC = 0.1

interface Interval {
  start: number
  end: number
}

/** 줄의 원래 단어들이 말하던 시간 구간들(겹치거나 맞닿으면 합친다). 단어 사이 쉬는 구간은 들어가지 않는다. */
function speechIntervals(words: Word[]): Interval[] {
  const out: Interval[] = []
  for (const w of [...words].sort((a, b) => a.start - b.start)) {
    if (w.end - w.start <= 0) continue
    const last = out.at(-1)
    if (last && w.start <= last.end + 1e-6) last.end = Math.max(last.end, w.end)
    else out.push({ start: w.start, end: w.end })
  }
  return out
}

/**
 * 새 글자를 줄의 **말하던 구간에만** 글자 수에 비례해 이어 붙인다(신뢰도 1 = 사람이 확인한 글자).
 * 쉬는 구간에는 단어가 시작하거나 끝나지 않는다 — 컷이 그 무음을 잘라도 고친 글자가 사라지지 않는다(컷은 말이 있던 곳은 지키므로).
 * 말하던 시간이 0.1초도 안 되는 조각은 이웃과 합쳐, 글자는 하나도 빠지지 않는다.
 */
function spreadWords(text: string, original: Word[], fallback: Interval): Word[] {
  let spans = speechIntervals(original)
  if (spans.length === 0) spans = [fallback]
  const total = spans.reduce((s, sp) => s + (sp.end - sp.start), 0)
  const tokens = text.split(' ').map((t) => ({ t, w: Array.from(t).length }))
  const chars = tokens.reduce((s, tk) => s + tk.w, 0)

  /** 말한 시간 u(초) → 실제 시각. preferEarlier 면 구간 경계에서 앞 구간의 끝을, 아니면 뒤 구간의 시작을 고른다 */
  const at = (u: number, preferEarlier: boolean): number => {
    let acc = 0
    for (const sp of spans) {
      const len = sp.end - sp.start
      if (preferEarlier ? u <= acc + len + 1e-9 : u < acc + len - 1e-9) return sp.start + Math.min(Math.max(u - acc, 0), len)
      acc += len
    }
    return spans.at(-1)!.end
  }

  let done = 0
  let items = tokens.map((tk, k) => {
    const u0 = (total * done) / chars
    done += tk.w
    const u1 = (total * done) / chars
    return { text: tk.t, start: k === 0 ? spans[0]!.start : round3(at(u0, false)), end: k === tokens.length - 1 ? spans.at(-1)!.end : round3(at(u1, true)), speech: u1 - u0 }
  })
  // 말하던 시간이 너무 짧은 조각은 이웃과 합친다
  for (let k = 0; items.length > 1 && k < items.length; ) {
    if (items[k]!.speech >= MIN_WORD_SEC) {
      k++
      continue
    }
    const a = k === 0 ? 0 : k - 1
    const b = a + 1
    items.splice(a, 2, { text: `${items[a]!.text} ${items[b]!.text}`, start: items[a]!.start, end: items[b]!.end, speech: items[a]!.speech + items[b]!.speech })
    k = Math.max(0, a)
  }
  return items.map((it) => ({ text: it.text, start: it.start, end: it.end, confidence: 1 }))
}

/** 줄 번호 → 고친 글자(null = 지움, 정리한 글자). 범위 밖 번호·글자가 아닌 text 는 무시하고 같은 번호는 마지막이 이긴다. */
function collectEdits(partCount: number, edits: CaptionEdit[]): Map<number, string | null> {
  const byPart = new Map<number, string | null>()
  for (const e of edits) {
    if (!Number.isInteger(e.i) || e.i < 0 || e.i >= partCount) continue
    if (e.text !== null && typeof e.text !== 'string') continue
    byPart.set(e.i, e.text === null ? null : norm(e.text))
  }
  return byPart
}

/** 사용자가 자막에서 뺀(지운 줄) 구간의 시작~끝. 글자만 고친 줄은 아니다. 인식 결과는 원본을 준다. */
export function deletedParts(t: Pick<ReviewTranscript, 'words'>, edits: CaptionEdit[] | null | undefined): { start: number; end: number }[] {
  if (!edits?.length) return []
  const parts = reviewParts(t)
  const byPart = collectEdits(parts.length, edits)
  return parts.filter((p) => byPart.has(p.i) && (byPart.get(p.i) === null || byPart.get(p.i) === '')).map((p) => ({ start: p.start, end: p.end }))
}

/**
 * 사용자가 고친 줄(reviewParts 의 번호)의 글자를 입힌 transcript 를 돌려준다(원본은 바꾸지 않는다).
 * 글자가 비었거나 null 이면 그 줄의 단어를 뺀다. 범위 밖 번호·글자가 아닌 text 는 무시하고, 같은 번호는 마지막 것이 이긴다.
 * 원문과 같은 글자는 고친 것으로 치지 않는다. 고친 게 하나도 없으면 입력을 그대로 돌려준다.
 */
export function applyTranscriptEdits<T extends ReviewTranscript>(t: T, edits: CaptionEdit[] | null | undefined): T {
  if (!edits?.length) return t
  const parts = reviewParts(t)
  const byPart = collectEdits(parts.length, edits)

  const words: Word[] = []
  let changed = false
  for (const p of parts) {
    const edit = byPart.get(p.i)
    if (edit === undefined || edit === p.text) {
      words.push(...t.words.slice(p.from, p.to))
      continue
    }
    changed = true
    if (edit === null || edit === '') continue
    words.push(...spreadWords(Array.from(edit).slice(0, REVIEW_LIMITS.maxTextChars).join('').trim(), t.words.slice(p.from, p.to), { start: p.start, end: p.end }))
  }
  if (!changed) return t
  return { ...t, words, segments: segmentWords(words), hasSpeech: words.length > 0 }
}

function toSegment(ws: Word[]) {
  return { text: ws.map((w) => w.text).join(' '), start: ws[0]!.start, end: ws[ws.length - 1]!.end }
}

/** 단어를 문장 단위(0.8초 넘게 쉬거나 문장부호로 끝나면 새 문장)로 묶는다. 순수 함수. */
export function segmentWords(words: Word[]): ReviewTranscript['segments'] {
  const segments: ReviewTranscript['segments'] = []
  let cur: { words: Word[] } | null = null
  for (const w of words) {
    const prev: Word | undefined = cur?.words[cur.words.length - 1]
    if (!cur || !prev || w.start - prev.end > SEGMENT_GAP_SEC || SENTENCE_END.test(prev.text)) {
      if (cur) segments.push(toSegment(cur.words))
      cur = { words: [] }
    }
    cur.words.push(w)
  }
  if (cur && cur.words.length) segments.push(toSegment(cur.words))
  return segments
}

// ───────────────────────── 자막 트랙: 사용자가 만든 줄 전체 ─────────────────────────

/** 서버(zod)와 화면이 같이 쓰는 줄 한도 */
export const CAPTION_LINE_LIMITS = { maxText: 160, minSec: 0.2, maxLines: 800, overlapSec: 0.01, endSlackSec: 0.5 } as const

const round2 = (n: number) => Math.round(n * 100) / 100
const lineText = (l: CaptionLine) => (typeof l.text === 'string' ? norm(l.text) : '')
const validLine = (l: CaptionLine) => lineText(l) !== '' && Number.isFinite(l.start) && Number.isFinite(l.end) && l.end > l.start

/** 인식한 줄(reviewParts)을 자막 줄 목록으로. 시각은 소수 둘째 자리. */
export function captionLinesOf(t: Pick<ReviewTranscript, 'words'>): CaptionLine[] {
  return reviewParts(t).map((p) => ({ start: round2(p.start), end: round2(p.end), text: p.text }))
}

/**
 * 줄마다 문제(한국어, 없으면 null). 줄은 시작순으로 줘야 한다 — 앞 줄과 겹치는지를 앞 줄 기준으로 본다.
 * 시작 시각·끝이 시작보다 빠름·0.2초 미만·글자 없음·160자 초과·영상 길이(+0.5초) 밖·앞 줄과 겹침.
 */
export function captionLineProblems(lines: CaptionLine[], durationSec: number): (string | null)[] {
  const L = CAPTION_LINE_LIMITS
  let prevEnd = -Infinity
  return lines.map((l) => {
    const text = lineText(l)
    let problem: string | null = null
    if (!Number.isFinite(l.start) || l.start < 0) problem = '시작 시각이 잘못됐어요'
    else if (!Number.isFinite(l.end) || l.end <= l.start) problem = '끝이 시작보다 빨라요'
    else if (l.end - l.start < L.minSec - 1e-9) problem = `${L.minSec}초보다 짧아요`
    else if (!text) problem = '글자가 비었어요'
    else if (Array.from(text).length > L.maxText) problem = `${L.maxText}자를 넘어요`
    else if (l.end > durationSec + L.endSlackSec) problem = `영상 길이(${durationSec.toFixed(1)}초)를 넘어요`
    else if (l.start < prevEnd - L.overlapSec) problem = '앞 줄과 겹쳐요'
    if (Number.isFinite(l.end)) prevEnd = Math.max(prevEnd, l.end)
    return problem
  })
}

/**
 * 사용자가 만든 자막 트랙을 입힌 transcript(원본은 바꾸지 않는다). 트랙이 null 이면 입력 그대로(예전 편집 경로를 쓰라는 뜻).
 * - 원래 인식한 줄과 글자·시작·끝(±0.06초)이 같은 줄은 **원래 단어를 그대로**(시각·신뢰도 포함) 쓴다.
 * - 글자나 시각이 바뀐 줄, 인식이 놓친 구간에 새로 넣은 줄은 글자 수 비율로 단어를 만든다(신뢰도 1 = 사람이 확인한 글자).
 *   그 줄 구간에 걸친 원래 단어의 **말하던 구간에만** 놓고, 걸친 단어가 없으면 줄 전체 구간에 놓는다.
 * - 트랙에 없는 원래 줄의 단어는 빠진다. 빈 글자·길이 없는 줄은 무시. 160자를 넘는 글자는 160자까지.
 */
export function applyCaptionTrack<T extends ReviewTranscript>(t: T, track: CaptionLine[] | null | undefined): T {
  if (track === null || track === undefined) return t
  const parts = reviewParts(t)
  const used = new Set<number>()
  const lines = track
    .filter(validLine)
    .map((l) => ({ start: l.start, end: l.end, text: Array.from(lineText(l)).slice(0, CAPTION_LINE_LIMITS.maxText).join('').trim() }))
    .sort((a, b) => a.start - b.start)
  const words: Word[] = []
  for (const l of lines) {
    const same = parts.find((p) => !used.has(p.i) && p.text === l.text && Math.abs(p.start - l.start) < 0.06 && Math.abs(p.end - l.end) < 0.06)
    if (same) {
      used.add(same.i)
      words.push(...t.words.slice(same.from, same.to))
      continue
    }
    const own = t.words
      .filter((x) => {
        const mid = (x.start + x.end) / 2
        return mid >= l.start && mid <= l.end
      })
      .map((x) => ({ ...x, start: Math.max(x.start, l.start), end: Math.min(x.end, l.end) }))
      .filter((x) => x.end > x.start)
    words.push(...spreadWords(l.text, own, { start: l.start, end: l.end }))
  }
  words.sort((a, b) => a.start - b.start)
  return { ...t, words, segments: segmentWords(words), hasSpeech: words.length > 0 }
}

/** 컷이 지켜 줄 "말" 로 쓰이는 가짜 단어(사용자가 넣은 줄 구간) */
const protect = (l: CaptionLine, start: number, end: number): Word => ({ text: lineText(l), start, end, confidence: 1 })

/**
 * 컷을 계산할 인식 결과: 원래 단어 전부(자막을 지워도 영상은 그대로) + 사용자가 **인식이 놓친 곳에 넣은** 줄 구간.
 * 인식된 말과 겹치는 줄은 말 앞·뒤로 0.3초 이상 늘린 부분만 더 지킨다(줄 안의 말 사이 쉬는 구간은 지키지 않는다 — 무음 컷은 그대로).
 */
export function cutTranscriptFor<T extends ReviewTranscript>(t: T, track: CaptionLine[] | null | undefined): T {
  if (track === null || track === undefined) return t
  const extra: Word[] = []
  for (const l of track.filter(validLine)) {
    const hit = t.words.filter((x) => x.start < l.end && x.end > l.start)
    if (hit.length === 0) {
      extra.push(protect(l, l.start, l.end))
      continue
    }
    const first = Math.min(...hit.map((x) => x.start))
    const last = Math.max(...hit.map((x) => x.end))
    if (first - l.start >= 0.3) extra.push(protect(l, l.start, first))
    if (l.end - last >= 0.3) extra.push(protect(l, last, l.end))
  }
  if (extra.length === 0) return t
  const words = [...t.words, ...extra].sort((a, b) => a.start - b.start)
  return { ...t, words, segments: segmentWords(words), hasSpeech: true }
}

/** 인식된 말이 있는데 자막 줄이 없는 구간: 원래 줄 중 트랙의 줄과 30% 이상 겹치지 않는 것. 트랙이 null 이면 없다. */
export function removedSpans(t: Pick<ReviewTranscript, 'words'>, track: CaptionLine[] | null | undefined): { start: number; end: number }[] {
  if (track === null || track === undefined) return []
  const lines = track.filter(validLine)
  return reviewParts(t)
    .filter((p) => {
      const len = p.end - p.start
      if (len <= 0) return false
      const overlap = lines.reduce((s, l) => s + Math.max(0, Math.min(p.end, l.end) - Math.max(p.start, l.start)), 0)
      return overlap / len < 0.3
    })
    .map((p) => ({ start: p.start, end: p.end }))
}

/** 예전(줄 번호) 편집을 자막 줄 목록으로: 글자를 고친 줄은 시각 그대로 글자만 바뀌고, 지운 줄은 빠진다. 편집이 없으면 원래 줄. */
export function captionLinesWithEdits(t: Pick<ReviewTranscript, 'words'>, edits: CaptionEdit[] | null | undefined): CaptionLine[] {
  const parts = reviewParts(t)
  const byPart = edits?.length ? collectEdits(parts.length, edits) : new Map<number, string | null>()
  return parts.flatMap((p) => {
    const edit = byPart.get(p.i)
    const text = edit === undefined ? p.text : edit === null ? '' : edit
    return text ? [{ start: round2(p.start), end: round2(p.end), text }] : []
  })
}

/** 서버가 저장하는 모양: 시작순 정렬, 글자 공백 정리(빈 글자 줄은 뺀다), 시각은 소수 둘째 자리. 입력은 바꾸지 않는다. */
export function normalizeCaptionLines(lines: CaptionLine[]): CaptionLine[] {
  return lines
    .filter((l) => lineText(l) !== '')
    .map((l) => ({ start: round2(l.start), end: round2(l.end), text: lineText(l) }))
    .sort((a, b) => a.start - b.start)
}
