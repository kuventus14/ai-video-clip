import type { JobDto, PurposeValue, ReportDto } from '../shared/types.ts'

const REASON_LABEL: Record<string, string> = { typo: '오탈자', term: '전문 용어', spacing: '띄어쓰기' }

/** 교정 이유 코드(typo|term|spacing)를 한국어로. 모르는 값은 그대로 보여 준다. */
export function correctionReasonLabel(reason: string): string {
  return REASON_LABEL[reason] ?? reason
}

type Finding = ReportDto['findings'][number]

/**
 * 검수 항목을 심각도별로 묶고 시간 순으로 정렬한다(시간이 없는 것은 뒤). 자막 제안(caption-suggestion)은
 * 제안 목록에 따로 나오므로 여기서는 뺀다.
 */
export function groupFindings(findings: Finding[]): Record<'high' | 'medium' | 'info', Finding[]> {
  const out: Record<'high' | 'medium' | 'info', Finding[]> = { high: [], medium: [], info: [] }
  for (const f of findings) if (f.id !== 'caption-suggestion') out[f.severity].push(f)
  for (const list of Object.values(out)) list.sort((a, b) => (a.atSec ?? Infinity) - (b.atSec ?? Infinity))
  return out
}

/** 검수 결과 한 줄. 리포트가 없거나 확인할 항목이 있으면 통과라고 하지 않는다. */
export function verdictOf(report: ReportDto | null): { tone: 'ok' | 'warn'; text: string } {
  if (!report) return { tone: 'warn', text: '검수 리포트를 읽지 못했어요' }
  const n = report.findings.filter((f) => f.severity !== 'info').length
  if (report.passed && n === 0) return { tone: 'ok', text: '검수 통과' }
  return { tone: 'warn', text: n > 0 ? `확인할 것 ${n}건` : '확인 필요' }
}

/** 결과 영상을 내려받을 때의 파일 이름 */
export function downloadName(job: Pick<JobDto, 'sourceName' | 'title'>): string {
  const stem = (job.sourceName ?? job.title).replace(/\.[^./\\]+$/, '').replace(/[\\/:*?"<>|]+/g, ' - ').replace(/\s+-\s+/g, ' - ').trim()
  if (stem.endsWith('편집본')) return `${stem}.mp4`
  return `${stem ? `${stem}_` : ''}편집본.mp4`
}

/** 수정 요청을 이전 요청 뒤에 덧붙인다(줄바꿈으로 이어 붙임). 새 요청이 비면 이전 요청 그대로. */
export function mergeRequest(previous: string, extra: string): string {
  return [previous.trim(), extra.trim()].filter(Boolean).join('\n')
}

export const oppositePurpose = (p: PurposeValue): PurposeValue => (p === 'short' ? 'post' : 'short')
