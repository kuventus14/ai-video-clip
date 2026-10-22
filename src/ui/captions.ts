import type { CaptionEdit, CaptionReviewDto } from '../shared/types.ts'

/** 자막 확인 화면에서 사용자가 고치고 있는 상태: 줄 번호 → 고친 글자(null = 지움). 안 고친 줄은 키가 없다. */
export type CaptionDraft = Record<number, string | null>

/** 서버(plan 본문)의 한도와 같다 */
export const MAX_CAPTION_CHARS = 160

const norm = (s: string) => s.trim().replace(/\s+/g, ' ')

/** 저장돼 있던 편집으로 시작한다. 지금 줄 목록에 없는 번호는 버린다. */
export function draftFrom(r: CaptionReviewDto): CaptionDraft {
  const known = new Set(r.parts.map((p) => p.i))
  const d: CaptionDraft = {}
  for (const e of r.edits) if (known.has(e.i)) d[e.i] = e.text
  return d
}

/** 한 줄의 글자를 바꾼다. 원문과 같으면(공백 차이만 있어도) 초안에서 뺀다. 입력 중인 글자는 그대로 둔다. */
export function setPartText(d: CaptionDraft, r: CaptionReviewDto, i: number, text: string): CaptionDraft {
  const next = { ...d }
  const original = r.parts.find((p) => p.i === i)?.text ?? ''
  if (norm(text) === norm(original)) delete next[i]
  else next[i] = text
  return next
}

/** 줄 지우기 ↔ 되돌리기(되돌리면 원문으로 돌아간다) */
export function togglePartDelete(d: CaptionDraft, i: number): CaptionDraft {
  const next = { ...d }
  if (next[i] === null) delete next[i]
  else next[i] = null
  return next
}

/** 서버로 보낼 편집(줄 번호 오름차순). 비웠거나 지운 줄은 text null. */
export function editsFrom(d: CaptionDraft): CaptionEdit[] {
  return Object.keys(d)
    .map(Number)
    .sort((a, b) => a - b)
    .map((i) => {
      const v = d[i]
      const text = v === null || v === undefined ? null : norm(v)
      return { i, text: text ? text : null }
    })
}

/** 줄 번호 → 문제(한국어). 지금은 160자 초과뿐이다. */
export function partProblems(d: CaptionDraft): Record<number, string> {
  const out: Record<number, string> = {}
  for (const [k, v] of Object.entries(d)) if (typeof v === 'string' && Array.from(v).length > MAX_CAPTION_CHARS) out[Number(k)] = `${MAX_CAPTION_CHARS}자를 넘어요`
  return out
}

/** 보여 줄 줄. onlySuspect 면 인식기가 확신하지 못한 단어가 있는 줄만. */
export function visibleParts(r: CaptionReviewDto, onlySuspect: boolean): CaptionReviewDto['parts'] {
  return onlySuspect ? r.parts.filter((p) => p.lowWords.length > 0) : r.parts
}
