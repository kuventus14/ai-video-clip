'use client'

import { Film, Plus, TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import type { JobDto } from '../../src/shared/types.ts'
import { ApiError, removeJob } from '../../src/ui/api.ts'
import { useJobs } from '../../src/ui/useJobs.ts'
import { Button, buttonClass } from '../ui/Button.tsx'
import { Card } from '../ui/Card.tsx'
import { ConfirmDialog } from '../ui/ConfirmDialog.tsx'
import { EmptyState } from '../ui/EmptyState.tsx'
import { Skeleton } from '../ui/Skeleton.tsx'
import { JobCard, JobRow } from './JobCard.tsx'

function SectionTitle({ id, children, count }: { id: string; children: string; count?: number }) {
  return (
    <h2 id={id} tabIndex={-1} className="mb-3 flex items-baseline gap-2 text-[17px] font-semibold text-ink">
      {children}
      {count !== undefined ? <span className="text-[13px] font-normal tabular-nums text-ink-3">{count}</span> : null}
    </h2>
  )
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-8" aria-busy="true" aria-label="목록을 불러오는 중">
      <div className="flex flex-col gap-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-4 rounded-panel border border-line bg-panel p-3">
            <Skeleton className="aspect-video w-[88px] shrink-0" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="h-3 w-1/4" />
            </div>
          </div>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="overflow-hidden rounded-panel border border-line bg-panel">
            <Skeleton className="aspect-video w-full rounded-none" />
            <div className="flex flex-col gap-2 p-3.5">
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
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
    if (error) {
      return (
        <Card>
          <EmptyState icon={<TriangleAlert size={32} strokeWidth={1.5} />} title="목록을 불러오지 못했어요" description={error} action={<Button onClick={reload}>다시 시도</Button>} />
        </Card>
      )
    }
    return <ListSkeleton />
  }

  const active = jobs.filter((j) => j.status !== 'confirmed')
  const done = jobs.filter((j) => j.status === 'confirmed')

  return (
    <div className="flex flex-col gap-8">
      {error ? (
        <p role="status" className="flex items-center gap-2 rounded-control bg-warn-soft px-3 py-2 text-[13px] text-warn">
          <TriangleAlert size={16} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
          목록을 새로 읽지 못했어요. 계속 다시 시도하고 있어요. ({error})
        </p>
      ) : null}

      {jobs.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Film size={32} strokeWidth={1.5} />}
            title="아직 만든 영상이 없어요"
            description="영상을 하나 올리면, 레퍼런스처럼 컷·자막·구도를 맞춰 자동으로 편집하고 검수까지 해 드려요."
            action={
              <Link href="/new" className={buttonClass('primary')}>
                <Plus size={18} strokeWidth={1.75} aria-hidden="true" />
                새 영상 만들기
              </Link>
            }
          />
        </Card>
      ) : (
        <>
          {active.length > 0 ? (
            <section aria-labelledby="active-title">
              <SectionTitle id="active-title" count={active.length}>
                진행 중
              </SectionTitle>
              <ul className="flex flex-col gap-2">
                {active.map((job) => (
                  <JobRow key={job.id} job={job} onDelete={setTarget} />
                ))}
              </ul>
            </section>
          ) : null}

          <section aria-labelledby="done-title">
            <SectionTitle id="done-title" count={done.length}>
              확정한 영상
            </SectionTitle>
            {done.length > 0 ? (
              <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {done.map((job) => (
                  <JobCard key={job.id} job={job} onDelete={setTarget} />
                ))}
              </ul>
            ) : (
              <p className="rounded-panel border border-dashed border-line-strong px-5 py-8 text-center text-[15px] text-ink-2">결과를 확인하고 확정하면 여기에 모여요.</p>
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
