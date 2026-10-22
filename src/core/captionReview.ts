import type { CaptionEdit } from '../shared/types.ts'
import { segmentWords } from './transcribe.ts'
import type { Transcript, Word } from './types.ts'

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
const chars = (s: string) => Array.from(s.replace(/\s/g, '')).length
const norm = (s: string) => s.trim().replace(/\s+/g, ' ')
const round3 = (n: number) => Math.round(n * 1000) / 1000

/**
 * 인식한 단어를 사람이 확인하기 좋은 줄로 묶는다(결정적: 같은 transcript 는 늘 같은 줄 번호).
 * 새 줄은 글자 수(공백 뺀)가 18자를 넘기게 될 때, 앞 단어와 0.7초 넘게 떨어졌을 때, 앞 단어가 문장부호로 끝났을 때 연다.
 */
export function reviewParts(t: Transcript): ReviewPart[] {
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

/** 새 글자를 [start, end] 안에 글자 수에 비례해 이어 붙인 단어들(신뢰도 1 = 사람이 확인한 글자) */
function spreadWords(text: string, start: number, end: number): Word[] {
  const tokens = text.split(' ')
  const total = tokens.reduce((s, tk) => s + Array.from(tk).length, 0)
  let done = 0
  return tokens.map((tk, k) => {
    const a = k === 0 ? start : round3(start + ((end - start) * done) / total)
    done += Array.from(tk).length
    const b = k === tokens.length - 1 ? end : round3(start + ((end - start) * done) / total)
    return { text: tk, start: a, end: b, confidence: 1 }
  })
}

/**
 * 사용자가 고친 줄(reviewParts 의 번호)의 글자를 입힌 transcript 를 돌려준다(원본은 바꾸지 않는다).
 * 글자가 비었거나 null 이면 그 줄의 단어를 뺀다. 범위 밖 번호·글자가 아닌 text 는 무시하고, 같은 번호는 마지막 것이 이긴다.
 * 원문과 같은 글자는 고친 것으로 치지 않는다. 고친 게 하나도 없으면 입력을 그대로 돌려준다.
 */
export function applyTranscriptEdits(t: Transcript, edits: CaptionEdit[] | null | undefined): Transcript {
  if (!edits?.length) return t
  const parts = reviewParts(t)
  const byPart = new Map<number, string | null>()
  for (const e of edits) {
    if (!Number.isInteger(e.i) || e.i < 0 || e.i >= parts.length) continue
    if (e.text !== null && typeof e.text !== 'string') continue
    byPart.set(e.i, e.text === null ? null : norm(e.text))
  }

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
    words.push(...spreadWords(Array.from(edit).slice(0, REVIEW_LIMITS.maxTextChars).join('').trim(), p.start, p.end))
  }
  if (!changed) return t
  return { ...t, words, segments: segmentWords(words), hasSpeech: words.length > 0 }
}
