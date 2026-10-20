export type LinkCheck = { kind: 'empty' } | { kind: 'ok'; url: string } | { kind: 'bad' }

/** 레퍼런스 링크 입력을 검사한다. 비면 "레퍼런스 없음", http(s) 링크(공백 없음)면 다듬어서 ok, 그 밖은 bad. */
export function checkLink(raw: string): LinkCheck {
  const v = raw.trim()
  if (!v) return { kind: 'empty' }
  return /^https?:\/\/\S+$/i.test(v) ? { kind: 'ok', url: v } : { kind: 'bad' }
}

export const BAD_LINK_MESSAGE = 'http:// 또는 https:// 로 시작하는 링크를 넣어 주세요. (공백이 없어야 해요)'

/** 작업에 이미 들어 있는 레퍼런스(링크·올린 파일)를 선택 화면의 처음 상태로 옮긴다. */
export function initialReference(referenceSource: string | null, hasUploadedReference: boolean, recommendations: { id: string; url: string }[]): { recId: string | null; link: string; fileName: string | null } {
  const none = { recId: null, link: '', fileName: null }
  if (!referenceSource) return none
  const rec = recommendations.find((r) => r.url === referenceSource)
  if (rec) return { ...none, recId: rec.id }
  if (/^https?:\/\//i.test(referenceSource)) return { ...none, link: referenceSource }
  if (hasUploadedReference && referenceSource.startsWith('파일: ')) return { ...none, fileName: referenceSource.slice('파일: '.length) }
  return none
}
