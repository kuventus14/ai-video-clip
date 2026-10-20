'use client'

import { SearchX, TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import type { JobDto } from '../../src/shared/types.ts'
import { formatKoreanDate, progressState, purposeLabel, shownPurpose, stepForJob } from '../../src/ui/format.ts'
import { useJob } from '../../src/ui/useJob.ts'
import { Badge } from '../ui/Badge.tsx'
import { Button, buttonClass } from '../ui/Button.tsx'
import { Card } from '../ui/Card.tsx'
import { EmptyState } from '../ui/EmptyState.tsx'
import { Skeleton } from '../ui/Skeleton.tsx'
import { Steps } from '../ui/Steps.tsx'
import { FailedPanel } from './FailedPanel.tsx'
import { JobInfo } from './JobInfo.tsx'
import { ProgressPanel } from './ProgressPanel.tsx'
import { UploadForm } from './UploadForm.tsx'

/** 작업 화면. 작업을 읽어 오고 상태가 바뀌면 본문을 알맞은 패널로 바꾼다. */
export function JobView({ id }: { id: string }) {
  const { job, error, notFound, refresh } = useJob(id)

  if (notFound) {
    return (
      <Card>
        <EmptyState
          icon={<SearchX size={32} strokeWidth={1.5} />}
          title="작업을 찾을 수 없어요"
          description="지워졌거나 주소가 잘못됐을 수 있어요."
          action={
            <Link href="/" className={buttonClass('primary')}>
              기록으로 가기
            </Link>
          }
        />
      </Card>
    )
  }

  if (!job) {
    if (error) {
      return (
        <Card>
          <EmptyState icon={<TriangleAlert size={32} strokeWidth={1.5} />} title="작업을 불러오지 못했어요" description={error} action={<Button onClick={() => refresh()}>다시 시도</Button>} />
        </Card>
      )
    }
    return (
      <div className="flex flex-col gap-6" aria-busy="true" aria-label="작업을 불러오는 중">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-1/2" />
          <Skeleton className="h-4 w-1/4" />
        </div>
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    )
  }

  const purpose = shownPurpose(job)
  const body = bodyFor(job, refresh)

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="break-words text-[22px] font-semibold leading-tight">{job.title}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] text-ink-3">
          {purpose ? <Badge>{purposeLabel(purpose)}</Badge> : null}
          <span>{formatKoreanDate(job.createdAt)}에 만들었어요</span>
        </div>
      </div>

      {error ? (
        <p role="status" className="flex items-center gap-2 rounded-control bg-warn-soft px-3 py-2 text-[13px] text-warn">
          <TriangleAlert size={16} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
          작업 상태를 새로 읽지 못했어요. 계속 다시 시도하고 있어요. ({error})
        </p>
      ) : null}

      <Steps current={stepForJob(job)} state={progressState(job.status)} />

      {body.wide ? (
        body.node
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0">{body.node}</div>
          <JobInfo job={job} />
        </div>
      )}
    </div>
  )
}

/** 상태 → 본문. wide 면 보조 정보 칸 없이 전체 폭을 쓴다. 이 화면이 아직 모르는 상태는 빈 화면이 아니라 안내를 보인다. */
function bodyFor(job: JobDto, refresh: (next?: JobDto) => void): { node: ReactNode; wide?: boolean } {
  switch (job.status) {
    case 'created':
      return {
        node: (
          <Card>
            <EmptyState
              title="올리던 영상이 끝나지 않았어요"
              description="업로드가 중간에 멈춘 작업이에요. 영상을 다시 올려 주세요."
              action={
                <Link href="/new" className={buttonClass('primary')}>
                  새 영상 올리기
                </Link>
              }
            />
          </Card>
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
    case 'failed':
      return { node: <FailedPanel job={job} onChanged={refresh} /> }
    default:
      return {
        node: (
          <Card>
            <EmptyState icon={<TriangleAlert size={32} strokeWidth={1.5} />} title="이 상태를 표시하지 못했어요" description={`작업 상태: ${job.status}`} />
          </Card>
        ),
      }
  }
}
