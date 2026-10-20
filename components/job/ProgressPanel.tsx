'use client'

import { Spinner } from '../ui/Spinner.tsx'
import { Card } from '../ui/Card.tsx'
import { isQueued } from '../../src/db/status.ts'
import type { JobDto } from '../../src/shared/types.ts'
import { estimateProduce, formatDuration, STATUS_LABEL } from '../../src/ui/format.ts'
import { useNow } from '../../src/ui/useNow.ts'

/** 단계별로 "지금 무엇을 하는지"와 얼마나 걸릴지 알려 주는 문장 */
function expectation(job: JobDto): string {
  switch (job.status) {
    case 'queued_probe':
    case 'probing':
      return '영상 정보를 확인하고 있어요. 보통 몇 초면 끝나요.'
    case 'queued_analysis':
    case 'analyzing':
      return '음성을 글로 옮기고 영상 내용을 파악하고 있어요. 영상이 길수록 오래 걸려요.'
    case 'queued_plan':
    case 'planning':
      return '레퍼런스를 분석하고 편집 계획을 세우고 있어요. 링크에 따라 시간이 걸릴 수 있어요.'
    case 'queued_produce':
    case 'producing': {
      const est = job.sourceInfo ? estimateProduce(job.sourceInfo.durationSec) : ''
      return `제작은 영상 길이의 2~3배쯤 걸려요${est ? ` — 이 영상은 ${est} 정도예요` : ''}.`
    }
    default:
      return ''
  }
}

const clock = (iso: string) => {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return Number.isNaN(d.getTime()) ? '' : `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** 순서를 기다리는 시간이 이만큼 넘으면 처리 프로그램이 꺼져 있을 수도 있다고 알려 준다 */
const QUEUE_HINT_SEC = 20
const RECENT_LOG = 6

/** 워커가 하는 중이거나 순서를 기다리는 동안 보이는 패널. 상태가 바뀌면 부모(JobView)가 다른 패널로 바꾼다. */
export function ProgressPanel({ job }: { job: JobDto }) {
  const now = useNow(1000)
  const queued = isQueued(job.status)
  const elapsedSec = Math.max(0, (now - Date.parse(job.statusSince)) / 1000)
  const title = queued ? '순서를 기다리는 중이에요' : (job.stage ?? STATUS_LABEL[job.status])
  const lines = job.log.slice(-RECENT_LOG)

  return (
    <Card>
      <div className="flex flex-col gap-5">
        <div className="flex items-start justify-between gap-4">
          <div role="status" className="flex min-w-0 items-center gap-3">
            <Spinner size={22} className="text-accent-ink" />
            <div className="min-w-0">
              <p className="text-[17px] font-semibold leading-snug text-ink">{title}</p>
              <p className="text-[13px] text-ink-3">{STATUS_LABEL[job.status]}</p>
            </div>
          </div>
          <p className="shrink-0 text-[15px] tabular-nums text-ink-2">
            <span className="text-[13px] text-ink-3">경과 </span>
            {formatDuration(elapsedSec)}
          </p>
        </div>

        <p className="text-[15px] text-ink-2">{expectation(job)}</p>
        <p className="text-[13px] text-ink-3">이 화면을 닫아도 작업은 계속돼요. 기록에서 다시 열 수 있어요.</p>
        {queued && elapsedSec > QUEUE_HINT_SEC ? <p className="rounded-control bg-warn-soft px-3 py-2 text-[13px] text-warn">오래 기다리고 있어요. 앞의 작업이 길거나, 처리 프로그램이 꺼져 있을 수 있어요.</p> : null}

        {lines.length > 0 ? (
          <div>
            <h3 className="mb-1.5 text-[13px] font-medium text-ink">진행 기록</h3>
            <ol className="flex flex-col gap-1 rounded-control bg-sunken px-3 py-2.5 text-[13px] text-ink-2">
              {lines.map((l, i) => (
                <li key={`${l.t}-${i}`} className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-2">
                  <time dateTime={l.t} className="tabular-nums text-ink-3">
                    {clock(l.t)}
                  </time>
                  <span className="min-w-0 break-words">{l.message}</span>
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </div>
    </Card>
  )
}
