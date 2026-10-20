import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import type { ReportDto } from '../../src/shared/types.ts'
import { formatDuration } from '../../src/ui/format.ts'
import { correctionReasonLabel, groupFindings, verdictOf } from '../../src/ui/report.ts'
import { Badge } from '../ui/Badge.tsx'
import { Card } from '../ui/Card.tsx'

type Correction = ReportDto['appliedCorrections'][number]

const SEVERITY = {
  high: { label: '중요', icon: CircleAlert, color: 'text-bad' },
  medium: { label: '확인', icon: TriangleAlert, color: 'text-warn' },
  info: { label: '참고', icon: Info, color: 'text-info' },
} as const

function SectionTitle({ children, count }: { children: ReactNode; count?: number }) {
  return (
    <h3 className="mb-2 flex items-baseline gap-2 text-[15px] font-semibold text-ink">
      {children}
      {count !== undefined ? <span className="text-[13px] font-normal tabular-nums text-ink-3">{count}</span> : null}
    </h3>
  )
}

function CorrectionList({ items, note }: { items: Correction[]; note?: string }) {
  return (
    <ul className="flex flex-col gap-2">
      {items.map((c, i) => (
        <li key={`${c.index}-${i}`} className="rounded-control border border-line px-3 py-2.5">
          <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[13px] text-ink-3">
            <span className="tabular-nums">자막 {c.index + 1}번</span>
            <Badge>{correctionReasonLabel(c.reason)}</Badge>
          </div>
          <dl className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-2 gap-y-1 text-[15px]">
            {c.original ? (
              <>
                <dt className="text-[13px] text-ink-3">원문</dt>
                <dd className="min-w-0 break-words text-ink-2">{c.original}</dd>
              </>
            ) : null}
            <dt className="text-[13px] text-ink-3">{note ? '제안' : '수정'}</dt>
            <dd className="min-w-0 break-words font-medium text-ink">{c.text}</dd>
          </dl>
          {note ? <p className="mt-1.5 text-[13px] text-ink-3">{note}</p> : null}
        </li>
      ))}
    </ul>
  )
}

/**
 * 검수 리포트를 있는 그대로 보여 준다(낙관하지 않는다): 통과/확인 요약, 심각도별 항목(시간 포함), 자동으로 고친 자막(원문 → 수정),
 * 고치지 않은 제안과 이유, 그리고 이 검수가 확인하지 않는 항목은 항상 펼쳐서 보인다.
 */
export function ReportPanel({ report }: { report: ReportDto | null }) {
  const verdict = verdictOf(report)
  if (!report) {
    return (
      <Card title="검수 리포트">
        <p className="flex items-center gap-2 text-[15px] text-warn">
          <TriangleAlert size={18} strokeWidth={1.75} aria-hidden="true" />
          {verdict.text}. 영상을 직접 꼼꼼히 확인해 주세요.
        </p>
      </Card>
    )
  }

  const groups = groupFindings(report.findings)
  const hasFindings = groups.high.length + groups.medium.length + groups.info.length > 0
  const nothingFound = !hasFindings && report.appliedCorrections.length === 0 && report.suggestions.length === 0

  return (
    <Card title="검수 리포트" description="자동 검수가 확인한 내용이에요. 확인하지 못한 항목은 아래에 따로 적었어요.">
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Badge tone={verdict.tone}>{verdict.text}</Badge>
          <span className="text-[13px] text-ink-3 tabular-nums">만든 횟수 {report.attempts}번{report.attempts > 1 ? ' (검수에서 문제가 나와 다시 만들었어요)' : ''}</span>
        </div>

        {nothingFound ? (
          <p className="flex items-center gap-2 text-[15px] text-ink-2">
            <CircleCheck size={18} strokeWidth={1.75} className="text-ok" aria-hidden="true" />
            자동 검수에서 발견된 문제는 없어요.
          </p>
        ) : null}

        {(['high', 'medium', 'info'] as const).map((sev) => {
          const items = groups[sev]
          if (items.length === 0) return null
          const { label, icon: Icon, color } = SEVERITY[sev]
          return (
            <section key={sev} aria-label={`${label} 항목`}>
              <SectionTitle count={items.length}>
                <span className={`inline-flex items-center gap-1.5 ${color}`}>
                  <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
                  {label}
                </span>
              </SectionTitle>
              <ul className="flex flex-col gap-1.5">
                {items.map((f, i) => (
                  <li key={`${f.id}-${i}`} className="grid grid-cols-[3rem_minmax(0,1fr)] gap-x-2 text-[15px] text-ink">
                    <span className="pt-0.5 text-[13px] tabular-nums text-ink-3">{f.atSec !== undefined ? formatDuration(f.atSec) : ''}</span>
                    <span className="min-w-0 break-words">{f.message}</span>
                  </li>
                ))}
              </ul>
            </section>
          )
        })}

        {report.appliedCorrections.length > 0 ? (
          <section aria-label="자동으로 고친 자막">
            <SectionTitle count={report.appliedCorrections.length}>자동으로 고친 자막</SectionTitle>
            <CorrectionList items={report.appliedCorrections} />
          </section>
        ) : null}

        {report.suggestions.length > 0 ? (
          <section aria-label="고치지 않은 제안">
            <SectionTitle count={report.suggestions.length}>고치지 않은 제안</SectionTitle>
            <CorrectionList items={report.suggestions} note="원문과 많이 달라서 자동으로 적용하지 않았어요. 맞다고 판단되면 수정 요청으로 알려 주세요." />
          </section>
        ) : null}

        {report.unchecked.length > 0 ? (
          <details open className="rounded-control bg-sunken px-4 py-3">
            <summary className="cursor-pointer rounded-chip text-[15px] font-semibold text-ink">
              이 검수가 확인하지 않는 것 <span className="text-[13px] font-normal tabular-nums text-ink-3">{report.unchecked.length}</span>
            </summary>
            <ul className="mt-2 flex flex-col gap-1 text-[15px] text-ink-2">
              {report.unchecked.map((u, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span aria-hidden="true" className="mt-[0.65em] size-1.5 shrink-0 rounded-full bg-ink-3" />
                  <span className="min-w-0 break-words">{u}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[13px] text-ink-3">이 항목들은 직접 확인해 주세요.</p>
          </details>
        ) : null}
      </div>
    </Card>
  )
}
