'use client'

import { SearchX, TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState, type ReactNode } from 'react'
import type { JobDto } from '../../src/shared/types.ts'
import { atDate, formatKoreanDate, progressState, purposeLabel, shownPurpose, stepForJob } from '../../src/ui/format.ts'
import { useJob } from '../../src/ui/useJob.ts'
import { Badge } from '../ui/Badge.tsx'
import { Button, buttonClass } from '../ui/Button.tsx'
import { EmptyState } from '../ui/EmptyState.tsx'
import { Skeleton } from '../ui/Skeleton.tsx'
import { Steps } from '../ui/Steps.tsx'
import { FailedPanel } from './FailedPanel.tsx'
import { JobInfo } from './JobInfo.tsx'
import { PlanApproval } from './PlanApproval.tsx'
import { ProgressPanel } from './ProgressPanel.tsx'
import { ReferencePicker } from './ReferencePicker.tsx'
import { ResultReview } from './ResultReview.tsx'
import { UploadForm } from './UploadForm.tsx'

/** 작업 화면. 작업을 읽어 오고 상태가 바뀌면 본문을 알맞은 패널로 바꾼다. */
export function JobView({ id }: { id: string }) {
  const { job, error, notFound, refresh } = useJob(id)
  // 계획이 이미 있거나 계획 단계에서 실패한 작업에서 "레퍼런스 바꾸기" 로 레퍼런스 선택 화면을 여는 스위치. 상태가 바뀌면(계획을 다시 요청하면) 닫는다.
  const [pickerOpen, setPickerOpen] = useState(false)
  const status = job?.status
  useEffect(() => setPickerOpen(false), [status])

  if (notFound) {
    return (
      <EmptyState
        icon={<SearchX size={36} strokeWidth={1.5} />}
        title="작업을 찾을 수 없어요"
        description="지워졌거나 주소가 잘못됐을 수 있어요."
        action={
          <Link href="/" className={buttonClass('primary')}>
            기록으로 가기
          </Link>
        }
      />
    )
  }

  if (!job) {
    if (error) {
      return <EmptyState icon={<TriangleAlert size={36} strokeWidth={1.5} />} title="작업을 불러오지 못했어요" description={error} action={<Button onClick={() => refresh()}>다시 시도</Button>} />
    }
    return (
      <div className="flex flex-col gap-6" aria-busy="true" aria-label="작업을 불러오는 중">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-9 w-3/5" />
          <Skeleton className="h-4 w-1/4" />
        </div>
        <Skeleton className="h-10 w-full" />
        <Skeleton className="aspect-video w-full !rounded-panel" />
      </div>
    )
  }

  const purpose = shownPurpose(job)
  const body = bodyFor(job, { refresh, pickerOpen, setPickerOpen })

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="wipe max-w-[56ch] break-words text-[28px] font-bold leading-[1.25] tracking-[-0.03em] sm:text-[34px]">{job.title}</h1>
        <div className="enter mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-[14px] text-ink-3" style={{ ['--i' as string]: 2 }}>
          {purpose ? <Badge>{purposeLabel(purpose)}</Badge> : null}
          <span>{atDate(formatKoreanDate(job.createdAt))} 만들었어요</span>
        </div>
      </div>

      {error ? (
        <p role="status" className="flex items-center gap-2 rounded-control bg-warn-soft px-4 py-3 text-[13px] text-warn">
          <TriangleAlert size={16} strokeWidth={2} aria-hidden="true" className="shrink-0" />
          작업 상태를 새로 읽지 못했어요. 계속 다시 시도하고 있어요. ({error})
        </p>
      ) : null}

      <div className="enter" style={{ ['--i' as string]: 3 }}>
        <Steps current={stepForJob(job)} state={progressState(job.status)} />
      </div>

      <div className="enter" style={{ ['--i' as string]: 4 }}>
        {body.wide ? (
          body.node
        ) : (
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_21rem]">
            <div className="min-w-0">{body.node}</div>
            <JobInfo job={job} />
          </div>
        )}
      </div>
    </div>
  )
}

interface BodyContext {
  refresh: (next?: JobDto) => void
  pickerOpen: boolean
  setPickerOpen: (open: boolean) => void
}

/** 상태 → 본문. wide 면 보조 정보 칸 없이 전체 폭을 쓴다. 이 화면이 아직 모르는 상태는 빈 화면이 아니라 안내를 보인다. */
function bodyFor(job: JobDto, { refresh, pickerOpen, setPickerOpen }: BodyContext): { node: ReactNode; wide?: boolean } {
  const picker = <ReferencePicker job={job} onChanged={refresh} onCancel={() => setPickerOpen(false)} />
  switch (job.status) {
    case 'created':
      return {
        node: (
          <EmptyState
            title="올리던 영상이 끝나지 않았어요"
            description="업로드가 중간에 멈춘 작업이에요. 영상을 다시 올려 주세요."
            action={
              <Link href="/new" className={buttonClass('primary')}>
                새 영상 올리기
              </Link>
            }
          />
        ),
      }
    case 'ready':
      return { node: <UploadForm resume={job} onStarted={refresh} />, wide: true }
    case 'queued_probe':
    case 'probing':
    case 'queued_analysis':
    case 'analyzing':
    case 'queued_plan':
    case 'planning':
    case 'queued_produce':
    case 'producing':
      return { node: <ProgressPanel job={job} /> }
    case 'awaiting_reference':
      return { node: <ReferencePicker job={job} onChanged={refresh} /> }
    case 'awaiting_plan':
      return { node: pickerOpen ? picker : <PlanApproval job={job} onChanged={refresh} onEditReference={() => setPickerOpen(true)} /> }
    case 'awaiting_confirm':
    case 'confirmed':
      return { node: <ResultReview job={job} onChanged={refresh} />, wide: true }
    case 'failed':
      if (job.failedPhase === 'plan' && pickerOpen) return { node: picker }
      return { node: <FailedPanel job={job} onChanged={refresh} onEditReference={() => setPickerOpen(true)} /> }
    default:
      return {
        node: <EmptyState icon={<TriangleAlert size={36} strokeWidth={1.5} />} title="이 상태를 표시하지 못했어요" description={`작업 상태: ${job.status}`} />,
      }
  }
}
