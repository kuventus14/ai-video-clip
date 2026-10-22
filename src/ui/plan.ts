export interface PlanItem {
  text: string
  /** warn: 반영하지 못했거나 지원하지 않거나 비슷하게만 되는 항목 — 화면에서 눈에 띄게 보인다 */
  tone: 'normal' | 'warn'
}

export interface ParsedPlanCard {
  headline: string | null
  items: PlanItem[]
}

const HEADLINE = /^이렇게 이해했어요:\s*/
const WARN = /반영하지 못했어요|지원하지 않아요|비슷하게만 가능해요|짜지 못해서/

/** planCard 의 줄들("이렇게 이해했어요: …" 머리말 + "• …" 항목)을 화면용으로 나눈다. 줄은 하나도 잃지 않는다. */
export function parsePlanCard(lines: string[]): ParsedPlanCard {
  let headline: string | null = null
  const items: PlanItem[] = []
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    if (headline === null && HEADLINE.test(line)) {
      headline = line.replace(HEADLINE, '').trim()
      continue
    }
    const text = line.replace(/^•\s*/, '').trim()
    if (text) items.push({ text, tone: WARN.test(text) ? 'warn' : 'normal' })
  }
  return { headline, items }
}

export type PlanItemKind = 'captions' | 'title' | 'cuts' | 'frame' | 'music' | 'transition' | 'other'

/** 계획 항목 맨 앞 말("자막: …", "컷 속도: …")로 앞에 붙일 아이콘 종류를 고른다. */
export function planItemKind(text: string): PlanItemKind {
  const head = text.trim()
  if (head.startsWith('자막')) return 'captions'
  if (head.startsWith('제목') || head.startsWith('후킹') || head.startsWith('소제목') || head.startsWith('소개 줄') || head.startsWith('중간 질문') || head.startsWith('영상 구성')) return 'title'
  if (head.startsWith('컷') || head.startsWith('속도') || head.startsWith('빼는 구간')) return 'cuts'
  if (head.startsWith('화면')) return 'frame'
  if (head.startsWith('음악') || head.startsWith('효과음')) return 'music'
  if (head.startsWith('전환')) return 'transition'
  return 'other'
}
