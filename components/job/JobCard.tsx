import { Film, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { isRunning } from '../../src/db/status.ts'
import type { JobDto } from '../../src/shared/types.ts'
import { formatDuration, formatKoreanDate, isBusy, NEXT_ACTION, progressState, purposeLabel, shownPurpose, STATUS_LABEL, STEPS, stepForJob } from '../../src/ui/format.ts'
import { Badge } from '../ui/Badge.tsx'
import { Button } from '../ui/Button.tsx'
import { cx } from '../ui/cx.ts'
import { Spinner } from '../ui/Spinner.tsx'
import { Steps } from '../ui/Steps.tsx'

/** 카드 전체가 하나의 링크(제목)이고, 안의 삭제 버튼만 그 위에 따로 눌린다. 키보드 포커스는 카드 테두리로 보인다. */
const CARD_BASE =
  'relative border border-line bg-panel transition-colors duration-150 hover:bg-sunken/60 has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-2 has-[a:focus-visible]:outline-ring'
const STRETCHED_LINK = "outline-none after:absolute after:inset-0 after:content-['']"

function Thumb({ job, className, timecode }: { job: JobDto; className?: string; timecode?: string }) {
  return (
    <div className={cx('relative aspect-video overflow-hidden bg-shell', className)}>
      {job.media.thumb ? (
        // 세로 영상은 양옆이 비도록 원래 비율 그대로 보인다
        <img src={job.media.thumb} alt="" loading="lazy" decoding="async" className="size-full object-contain" />
      ) : (
        <div className="flex size-full items-center justify-center text-shell-ink-2">
          <Film size={20} strokeWidth={1.5} aria-hidden="true" />
        </div>
      )}
      {timecode ? <span className="absolute bottom-1.5 right-1.5 rounded-chip bg-black/75 px-1.5 py-0.5 text-[12px] font-medium leading-none tabular-nums text-white">{timecode}</span> : null}
    </div>
  )
}

function DeleteButton({ job, onDelete }: { job: JobDto; onDelete: (job: JobDto) => void }) {
  const running = isRunning(job.status)
  return (
    <Button variant="ghost" size="icon" className="relative z-10 shrink-0" disabled={running} onClick={() => onDelete(job)} aria-label={running ? `${job.title} — 진행 중이라 삭제할 수 없어요` : `${job.title} 삭제`} title={running ? '진행 중이라 삭제할 수 없어요' : '삭제'}>
      <Trash2 size={16} strokeWidth={1.75} aria-hidden="true" />
    </Button>
  )
}

function PurposeBadge({ job }: { job: JobDto }) {
  const purpose = shownPurpose(job)
  return purpose ? <Badge>{purposeLabel(purpose)}</Badge> : null
}

function ReviewBadge({ job }: { job: JobDto }) {
  const report = job.report
  if (!report) return null
  if (report.passed) return <Badge tone="ok">검수 통과</Badge>
  const issues = report.findings.filter((f) => f.severity !== 'info').length
  return <Badge tone="warn">{issues > 0 ? `확인 필요 ${issues}건` : '확인 필요'}</Badge>
}

/** 한 줄 상태 문구: 실패 / 내 차례 / 워커가 하는 중 / 그 밖 */
function StatusText({ job }: { job: JobDto }) {
  if (job.status === 'failed') {
    return (
      <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
        <Badge tone="bad">실패</Badge>
        <span>{STEPS[stepForJob(job)]} 단계에서 멈췄어요</span>
      </span>
    )
  }
  const action = NEXT_ACTION[job.status]
  if (action) {
    return (
      <span>
        <span className="font-semibold text-accent-ink">내 차례</span>
        <span aria-hidden="true"> · </span>
        {action}
      </span>
    )
  }
  const text = job.stage ?? STATUS_LABEL[job.status]
  return isBusy(job.status) ? (
    <span className="inline-flex items-center gap-1.5">
      <Spinner size={14} />
      {text}
    </span>
  ) : (
    <span>{text}</span>
  )
}

/** 진행 중·실패한 작업 한 줄 */
export function JobRow({ job, onDelete }: { job: JobDto; onDelete: (job: JobDto) => void }) {
  return (
    <li className={cx(CARD_BASE, 'flex items-center gap-3 rounded-panel p-3 sm:gap-4')}>
      <Thumb job={job} className="w-[88px] shrink-0 rounded-control" />
      <div className="min-w-0 flex-1">
        <Link href={`/jobs/${job.id}`} className={cx(STRETCHED_LINK, 'block truncate text-[15px] font-medium text-ink')}>
          {job.title}
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-2">
          <PurposeBadge job={job} />
          <StatusText job={job} />
        </div>
      </div>
      <Steps compact current={stepForJob(job)} state={progressState(job.status)} className="hidden w-44 shrink-0 md:block" />
      <DeleteButton job={job} onDelete={onDelete} />
    </li>
  )
}

/** 확정한 영상 카드 — 썸네일이 크다. 길이는 썸네일 위의 타임코드. */
export function JobCard({ job, onDelete }: { job: JobDto; onDelete: (job: JobDto) => void }) {
  return (
    <li className={cx(CARD_BASE, 'flex flex-col overflow-hidden rounded-panel')}>
      <Thumb job={job} timecode={job.resultInfo ? formatDuration(job.resultInfo.durationSec) : undefined} />
      <div className="flex flex-1 flex-col gap-2 p-3.5">
        <Link href={`/jobs/${job.id}`} className={cx(STRETCHED_LINK, 'line-clamp-2 text-[15px] font-medium leading-snug text-ink')}>
          {job.title}
        </Link>
        <div className="flex flex-wrap gap-1.5">
          <PurposeBadge job={job} />
          <ReviewBadge job={job} />
        </div>
        <div className="mt-auto flex items-center justify-between gap-2 pt-1">
          <span className="text-[13px] text-ink-3">{formatKoreanDate(job.confirmedAt ?? job.createdAt)}</span>
          <DeleteButton job={job} onDelete={onDelete} />
        </div>
      </div>
    </li>
  )
}
