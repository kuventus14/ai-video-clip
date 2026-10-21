import { Film } from 'lucide-react'
import type { ReactNode } from 'react'
import type { JobDto } from '../../src/shared/types.ts'
import { formatDuration, formatKoreanDate, purposeLabel, shownPurpose, thumbAspect } from '../../src/ui/format.ts'

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 py-3 first:pt-0 last:pb-0">
      <dt className="text-[13px] text-ink-3">{label}</dt>
      <dd className="min-w-0 break-words text-[15px] text-ink">{children}</dd>
    </div>
  )
}

/** 작업의 보조 정보 — 영상 파일, 용도, 입력한 설명·레퍼런스·요청. 값이 없는 줄은 보이지 않는다. */
export function JobInfo({ job }: { job: JobDto }) {
  const purpose = shownPurpose(job)
  const aspect = thumbAspect(job)
  return (
    <aside aria-label="영상 정보" className="rounded-panel bg-panel p-5">
      {/* 원래 비율 그대로의 프레임(세로 영상은 세로로 선다) */}
      <div className="mb-5 flex max-h-[280px] justify-center overflow-hidden rounded-control bg-stage">
        {job.media.thumb ? (
          <img src={job.media.thumb} alt="" decoding="async" className="max-h-[280px] w-auto max-w-full object-contain" style={{ aspectRatio: aspect }} />
        ) : (
          <div className="flex aspect-video w-full items-center justify-center text-ink-3">
            <Film size={26} strokeWidth={1.5} aria-hidden="true" />
          </div>
        )}
      </div>
      <dl className="divide-y divide-line">
        {job.sourceName ? <Row label="파일">{job.sourceName}</Row> : null}
        {job.sourceInfo ? (
          <Row label="길이·크기">
            <span className="tnum">
              {formatDuration(job.sourceInfo.durationSec)} · {job.sourceInfo.width}×{job.sourceInfo.height}
            </span>
          </Row>
        ) : null}
        {purpose ? <Row label="용도">{purposeLabel(purpose)}</Row> : null}
        {job.description ? <Row label="설명">{job.description}</Row> : null}
        {job.referenceSource ? <Row label="레퍼런스">{job.referenceSource}</Row> : null}
        {job.requestText ? <Row label="요청">{job.requestText}</Row> : null}
        <Row label="만든 때">{formatKoreanDate(job.createdAt)}</Row>
      </dl>
    </aside>
  )
}
