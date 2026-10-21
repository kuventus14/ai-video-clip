'use client'

import { ArrowRight, Film, Play, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { useState, type CSSProperties } from 'react'
import { isRunning } from '../../src/db/status.ts'
import type { JobDto } from '../../src/shared/types.ts'
import { formatDuration, formatKoreanDate, isBusy, NEXT_ACTION, progressState, purposeLabel, ROW_CTA, shownPurpose, STATUS_LABEL, STEPS, stepForJob, thumbAspect } from '../../src/ui/format.ts'
import { reviewBadgeFor } from '../../src/ui/report.ts'
import { Badge } from '../ui/Badge.tsx'
import { Button } from '../ui/Button.tsx'
import { cx } from '../ui/cx.ts'
import { Spinner } from '../ui/Spinner.tsx'
import { Steps } from '../ui/Steps.tsx'

/** 카드 전체가 하나의 링크(제목)이고, 안의 삭제 버튼만 그 위에 따로 눌린다. 키보드 포커스는 카드 테두리로 보인다. */
const STRETCHED_LINK = "outline-none after:absolute after:inset-0 after:content-['']"
const FOCUS_RING = 'has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-2 has-[a:focus-visible]:outline-ring'

function DeleteButton({ job, onDelete, className }: { job: JobDto; onDelete: (job: JobDto) => void; className?: string }) {
  const running = isRunning(job.status)
  return (
    <Button
      variant="ghost"
      size="icon"
      className={cx('relative z-10 shrink-0', className)}
      disabled={running}
      onClick={() => onDelete(job)}
      aria-label={running ? `${job.title} — 진행 중이라 삭제할 수 없어요` : `${job.title} 삭제`}
      title={running ? '진행 중이라 삭제할 수 없어요' : '삭제'}
    >
      <Trash2 size={17} strokeWidth={1.75} aria-hidden="true" />
    </Button>
  )
}

function PurposeBadge({ job }: { job: JobDto }) {
  const purpose = shownPurpose(job)
  return purpose ? <Badge>{purposeLabel(purpose)}</Badge> : null
}

function ReviewBadge({ job }: { job: JobDto }) {
  const badge = reviewBadgeFor(job.report)
  return badge ? <Badge tone={badge.tone}>{badge.text}</Badge> : null
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
    <span className="inline-flex items-center gap-2 text-ink-2">
      <Spinner size={14} className="text-accent" />
      {text}
    </span>
  ) : (
    <span>{text}</span>
  )
}

/** 모니터 프레임: 영상의 원래 비율 그대로 검은 무대 가운데에 선다 */
function Monitor({ job, className }: { job: JobDto; className?: string }) {
  return (
    <div className={cx('relative flex items-center justify-center overflow-hidden rounded-[14px] bg-stage', className)}>
      {job.media.thumb ? <img src={job.media.thumb} alt="" loading="lazy" decoding="async" className="max-h-full max-w-full object-contain" style={{ aspectRatio: thumbAspect(job) }} /> : <Film size={22} strokeWidth={1.5} className="text-ink-3" aria-hidden="true" />}
    </div>
  )
}

/** 진행 중·실패한 작업 한 줄 */
export function JobRow({ job, onDelete, index = 0 }: { job: JobDto; onDelete: (job: JobDto) => void; index?: number }) {
  const cta = ROW_CTA[job.status]
  return (
    <li className={cx('enter group relative flex items-center gap-4 rounded-panel bg-panel p-3 transition-colors duration-200 hover:bg-raised sm:gap-5 sm:p-4', FOCUS_RING)} style={{ ['--i' as string]: index + 3 }}>
      <Monitor job={job} className="h-[76px] w-[116px] shrink-0 sm:h-[88px] sm:w-[140px]" />
      <div className="min-w-0 flex-1">
        <Link href={`/jobs/${job.id}`} className={cx(STRETCHED_LINK, 'block truncate text-[16px] font-semibold tracking-[-0.01em] text-ink')}>
          {job.title}
        </Link>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] text-ink-3">
          <PurposeBadge job={job} />
          <StatusText job={job} />
        </div>
      </div>
      <Steps compact current={stepForJob(job)} state={progressState(job.status)} className="hidden w-44 shrink-0 lg:block" />
      {cta ? (
        <span aria-hidden="true" className="hidden shrink-0 items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-[13px] font-semibold text-accent-deep transition-transform duration-300 ease-[var(--ease-expo)] group-hover:translate-x-0.5 sm:inline-flex">
          {cta}
          <ArrowRight size={15} strokeWidth={2.25} />
        </span>
      ) : null}
      <DeleteButton job={job} onDelete={onDelete} />
    </li>
  )
}

/**
 * 확정한 영상 한 장 — 필름 갤러리의 한 컷. 높이는 같고 폭은 영상 비율대로라, 세로·가로 영상이 한 줄에 나란히 선다.
 * 마우스를 올리면(또는 키보드로 닿으면) 결과 영상이 소리 없이 미리 재생된다(움직임 줄이기 설정이면 재생하지 않는다).
 */
export function JobCard({ job, onDelete, index = 0 }: { job: JobDto; onDelete: (job: JobDto) => void; index?: number }) {
  const ar = thumbAspect(job)
  const [preview, setPreview] = useState(false)
  const canPreview = !!job.media.result
  const start = () => {
    if (canPreview && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) setPreview(true)
  }
  const style = {
    '--ar': ar,
    '--mb': ar > 1 ? '100%' : 'calc(50% - 8px)',
    flexGrow: ar * 100,
    flexBasis: 'calc(var(--h) * var(--ar))',
    height: 'var(--h)',
    animationDelay: `${Math.min(index, 8) * 70 + 200}ms`,
  } as CSSProperties
  return (
    <li
      className={cx('enter group relative min-w-0 overflow-hidden rounded-[18px] bg-stage max-sm:!h-auto max-sm:!grow-0 max-sm:basis-[var(--mb)] max-sm:[aspect-ratio:var(--ar)]', FOCUS_RING)}
      style={style}
      onPointerEnter={start}
      onPointerLeave={() => setPreview(false)}
      onFocus={start}
      onBlur={() => setPreview(false)}
    >
      {job.media.thumb ? (
        <img src={job.media.thumb} alt="" loading="lazy" decoding="async" className="absolute inset-0 size-full object-cover transition-transform duration-[900ms] ease-[var(--ease-expo)] group-hover:scale-[1.04]" />
      ) : (
        <Film size={28} strokeWidth={1.5} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-ink-3" aria-hidden="true" />
      )}
      {preview && job.media.result ? <video src={job.media.result} muted loop playsInline autoPlay preload="auto" aria-hidden="true" className="absolute inset-0 size-full object-cover" /> : null}

      {/* 글자가 영상 위에서 읽히도록 아래쪽에만 깔리는 어두운 막 */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-[62%] bg-[linear-gradient(to_top,rgb(0_0_0/0.85),rgb(0_0_0/0.5)_55%,transparent)]" />

      <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-black/60 px-2.5 py-1 text-[12px] font-semibold text-white tnum">
        <Play size={11} fill="currentColor" strokeWidth={0} aria-hidden="true" />
        {job.resultInfo ? formatDuration(job.resultInfo.durationSec) : '—'}
      </span>
      <DeleteButton
        job={job}
        onDelete={onDelete}
        className="absolute right-2 top-2 bg-black/55 text-white opacity-0 transition-opacity duration-200 hover:!bg-black/80 hover:!text-white focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
      />

      <div className="absolute inset-x-0 bottom-0 flex flex-col gap-2 p-4">
        <Link href={`/jobs/${job.id}`} className={cx(STRETCHED_LINK, 'line-clamp-2 text-[16px] font-semibold leading-snug tracking-[-0.015em] text-white')}>
          {job.title}
        </Link>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <PurposeBadge job={job} />
          <ReviewBadge job={job} />
          <span className="text-[12px] text-white/70">{formatKoreanDate(job.confirmedAt ?? job.createdAt)}</span>
        </div>
      </div>
    </li>
  )
}
