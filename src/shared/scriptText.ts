/**
 * 편집 대본의 문구 규칙. 편집 엔진(core)·승인 API(web)·승인 화면(ui)이 같은 기준을 쓰도록 여기 둔다.
 * 브라우저 번들에도 들어가므로 node 모듈을 가져오지 않는다.
 */
export const SCRIPT_TEXT_LIMITS = { title: 18, question: 22, reaction: 24, section: 10, opening: 22, maxOpening: 3 } as const

const len = (s: string) => Array.from(s).length
const URL_RE = /https?:\/\/|www\./i
// 글자·숫자가 하나도 없으면(이모지·기호뿐) 쓸 수 없는 문구다
const HAS_TEXT = /[\p{L}\p{N}]/u

/** 문구를 정리해 돌려주고, 못 쓰면 이유(한국어)를 돌려준다. 상한(글자 수)을 넘으면 잘라 붙이지 않고 거절한다. */
export function cleanScriptText(v: unknown, max: number): { ok: string } | { why: string } {
  if (typeof v !== 'string') return { why: '문구가 글자가 아니에요' }
  const t = v.replace(/\s+/g, ' ').trim()
  if (!t) return { why: '비어 있어요' }
  if (URL_RE.test(t)) return { why: '주소가 들어 있어요' }
  if (!HAS_TEXT.test(t)) return { why: '글자가 없어요' }
  if (len(t) > max) return { why: `${max}자를 넘어요` }
  return { ok: t }
}
