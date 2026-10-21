'use client'

import { Film, Plus, TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import type { JobDto } from '../../src/shared/types.ts'
import { ApiError, removeJob } from '../../src/ui/api.ts'
import { isBusy, NEXT_ACTION } from '../../src/ui/format.ts'
import { useJobs } from '../../src/ui/useJobs.ts'
import { Button, buttonClass } from '../ui/Button.tsx'
import { ConfirmDialog } from '../ui/ConfirmDialog.tsx'
import { EmptyState } from '../ui/EmptyState.tsx'
import { Skeleton } from '../ui/Skeleton.tsx'
import { JobCard, JobRow } from './JobCard.tsx'

function SectionTitle({ id, children, count }: { id: string; children: string; count?: number }) {
  return (
    <h2 id={id} tabIndex={-1} className="mb-4 flex items-baseline gap-2.5 text-[20px] font-bold tracking-[-0.02em] text-ink">
      {children}
      {count !== undefined ? <span className="text-[14px] font-medium tnum text-ink-3">{count}</span> : null}
    </h2>
  )
}

/** 화면 맨 위: 제목, 지금 상태를 한 줄로(내 차례·제작 중·멈춤·확정), 새 영상 만들기 */
function PageHeader({ jobs }: { jobs: JobDto[] | null }) {
  const parts: string[] = []
  if (jobs) {
    const waiting = jobs.filter((j) => NEXT_ACTION[j.status]).length
    const busy = jobs.filter((j) => isBusy(j.status)).length
    const failed = jobs.filter((j) => j.status === 'failed').length
    const done = jobs.filter((j) => j.status === 'confirmed').length
    if (waiting) parts.push(`내 차례 ${waiting}개`)
    if (busy) parts.push(`만드는 중 ${busy}개`)
    if (failed) parts.push(`멈춘 작업 ${failed}개`)
    if (done) parts.push(`확정한 영상 ${done}개`)
  }
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="min-w-0">
        <h1 className="wipe text-[34px] font-bold leading-[1.15] tracking-[-0.035em] sm:text-[44px]">내 영상</h1>
        {parts.length > 0 ? (
          <p className="enter mt-2 text-[15px] text-ink-2" style={{ ['--i' as string]: 2 }}>
            {parts.join(' · ')}
          </p>
        ) : null}
      </div>
      <Link href="/new" className={buttonClass('primary', 'md', 'enter')} style={{ ['--i' as string]: 3 }}>
        <Plus size={19} strokeWidth={2.25} aria-hidden="true" />
        새 영상 만들기
      </Link>
    </div>
  )
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-10" aria-busy="true" aria-label="목록을 불러오는 중">
      <div className="flex flex-col gap-3">
        {[0, 1].map((i) => (
          <div key={i} className="flex items-center gap-5 rounded-panel bg-panel p-4">
            <Skeleton className="h-[88px] w-[140px] shrink-0 !rounded-[14px]" />
            <div className="flex flex-1 flex-col gap-2.5">
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="h-3 w-1/4" />
            </div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-4 [--h:220px] sm:[--h:260px] xl:[--h:300px]">
        {[1.78, 0.56, 0.56, 1.78].map((ar, i) => (
          <Skeleton key={i} className="!rounded-[18px]" style={{ flexGrow: ar * 100, flexBasis: `calc(var(--h) * ${ar})`, height: 'var(--h)' }} />
        ))}
      </div>
    </div>
  )
}

export function HistoryList() {
  const { jobs, error, reload, remove } = useJobs()
  const [target, setTarget] = useState<JobDto | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const closeDialog = () => {
    setTarget(null)
    setDeleteError(null)
  }

  async function confirmDelete() {
    if (!target) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await removeJob(target.id)
    } catch (e) {
      // 이미 없는 작업이면 지운 것과 같다
      if (!(e instanceof ApiError && e.status === 404)) {
        setDeleteError(e instanceof Error ? e.message : String(e))
        setDeleting(false)
        return
      }
    }
    remove(target.id)
    setDeleting(false)
    closeDialog()
    // 지운 줄의 버튼이 사라지므로, 포커스가 문서 맨 위로 튀지 않게 그 구역의 제목으로 옮긴다
    const heading = target.status === 'confirmed' ? 'done-title' : 'active-title'
    setTimeout(() => (document.getElementById(heading) ?? document.getElementById('done-title') ?? document.querySelector('h1'))?.focus(), 50)
  }

  if (jobs === null) {
    return (
      <div className="flex flex-col gap-10">
        <PageHeader jobs={null} />
        {error ? <EmptyState icon={<TriangleAlert size={36} strokeWidth={1.5} />} title="목록을 불러오지 못했어요" description={error} action={<Button onClick={reload}>다시 시도</Button>} /> : <ListSkeleton />}
      </div>
    )
  }

  const active = jobs.filter((j) => j.status !== 'confirmed')
  const done = jobs.filter((j) => j.status === 'confirmed')

  return (
    <div className="flex flex-col gap-12">
      <PageHeader jobs={jobs} />

      {error ? (
        <p role="status" className="flex items-center gap-2 rounded-control bg-warn-soft px-4 py-3 text-[13px] text-warn">
          <TriangleAlert size={16} strokeWidth={2} aria-hidden="true" className="shrink-0" />
          목록을 새로 읽지 못했어요. 계속 다시 시도하고 있어요. ({error})
        </p>
      ) : null}

      {jobs.length === 0 ? (
        <EmptyState
          className="enter rounded-panel bg-panel py-20"
          icon={<Film size={40} strokeWidth={1.4} />}
          title="아직 만든 영상이 없어요"
          description="영상을 하나 올리면, 레퍼런스처럼 컷·자막·구도를 맞춰 자동으로 편집하고 검수까지 해 드려요."
          action={
            <Link href="/new" className={buttonClass('primary')}>
              <Plus size={19} strokeWidth={2.25} aria-hidden="true" />
              새 영상 만들기
            </Link>
          }
        />
      ) : (
        <>
          {active.length > 0 ? (
            <section aria-labelledby="active-title">
              <SectionTitle id="active-title" count={active.length}>
                진행 중
              </SectionTitle>
              <ul className="flex flex-col gap-3">
                {active.map((job, i) => (
                  <JobRow key={job.id} job={job} onDelete={setTarget} index={i} />
                ))}
              </ul>
            </section>
          ) : null}

          <section aria-labelledby="done-title">
            <SectionTitle id="done-title" count={done.length}>
              확정한 영상
            </SectionTitle>
            {done.length > 0 ? (
              <ul className="flex flex-wrap gap-4 [--h:230px] sm:[--h:260px] xl:[--h:300px]">
                {done.map((job, i) => (
                  <JobCard key={job.id} job={job} onDelete={setTarget} index={i} />
                ))}
                <li aria-hidden="true" className="h-0 grow-[999] basis-0 max-sm:hidden" />
              </ul>
            ) : (
              <p className="rounded-panel bg-panel px-6 py-10 text-center text-[15px] text-ink-2">결과를 확인하고 확정하면 여기에 모여요.</p>
            )}
          </section>
        </>
      )}

      <ConfirmDialog
        open={target !== null}
        title="이 영상을 지울까요?"
        description={target ? `‘${target.title}’ 과 만들어 둔 결과 파일이 모두 지워지고, 되돌릴 수 없어요.` : undefined}
        confirmLabel="삭제"
        busy={deleting}
        error={deleteError}
        onConfirm={confirmDelete}
        onCancel={closeDialog}
      />
    </div>
  )
}
