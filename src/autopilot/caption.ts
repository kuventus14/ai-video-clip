/** {title} 자리에 제목을 넣는다 */
export const fillTemplate = (template: string, title: string): string => template.replaceAll('{title}', title).trim()

/** 유튜브 제목은 100자, 꺾쇠(<>)는 쓸 수 없다 */
export function youtubeTitle(template: string, title: string): string {
  const t = fillTemplate(template, title).replace(/[<>]/g, '').replace(/\s+/g, ' ').trim()
  return [...t].slice(0, 100).join('').trim() || '골프 레슨'
}

/** 인스타 글은 2,200자, 해시태그 30개까지 */
export function instagramCaption(template: string, title: string): string {
  let tags = 0
  const text = fillTemplate(template, title).replace(/#[^\s#]+/g, (m) => (++tags <= 30 ? m : ''))
  return [...text].slice(0, 2200).join('')
}

/** 유튜브 설명은 5,000자, 꺾쇠(<>)는 쓸 수 없다 */
export const youtubeDescription = (template: string, title: string): string => [...fillTemplate(template, title).replace(/[<>]/g, '')].slice(0, 5000).join('')

/** 글에서 해시태그만 뽑아 유튜브 태그로 쓴다 */
export const hashtagsOf = (text: string): string[] => [...new Set([...text.matchAll(/#([^\s#]+)/g)].map((m) => m[1]!))]

/** report.json 에서 영상 제목을 고른다: AI 가 지은 화면 제목 → 첫머리 제목 → 주제 → 원본 파일 이름 */
export function titleFromReport(report: unknown, fallback: string): string {
  const r = (report ?? {}) as { script?: { title?: unknown }; summary?: { hookTitle?: unknown; topic?: unknown } }
  for (const v of [r.script?.title, r.summary?.hookTitle, r.summary?.topic]) if (typeof v === 'string' && v.trim()) return v.trim()
  return fallback
}
