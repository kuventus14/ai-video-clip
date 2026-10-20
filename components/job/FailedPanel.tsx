'use client'

import { CircleAlert, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import type { JobDto } from '../../src/shared/types.ts'
import { retry } from '../../src/ui/api.ts'
import { STEPS, stepForJob } from '../../src/ui/format.ts'
import { Button } from '../ui/Button.tsx'
import { Card } from '../ui/Card.tsx'

/**
 * 실패한 작업: 어느 단계에서 멈췄는지, 이유(한국어), 다음 행동. 다시 시도는 실패한 단계부터 이어서 한다.
 * onEditReference 가 있고 계획 단계에서 실패했으면 레퍼런스를 바꿔 다시 요청하는 길도 보인다.
 */
export function FailedPanel({ job, onChanged, onEditReference }: { job: JobDto; onChanged: (next: JobDto) => void; onEditReference?: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onRetry() {
    setBusy(true)
    setError(null)
    try {
      onChanged(await retry(job.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  const lines = job.log.slice(-10)
  return (
    <Card>
      <div className="flex flex-col gap-5">
        <div className="flex items-start gap-3">
          <CircleAlert size={22} strokeWidth={1.75} className="mt-0.5 shrink-0 text-bad" aria-hidden="true" />
          <div className="min-w-0">
            <h2 className="text-[17px] font-semibold leading-snug text-ink">{STEPS[stepForJob(job)]} 단계에서 멈췄어요</h2>
            <p role="alert" className="mt-1 break-words text-[15px] text-ink-2">
              {job.error ?? '이유를 알 수 없는 오류가 났어요.'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" loading={busy} onClick={onRetry} icon={<RotateCcw size={18} strokeWidth={1.75} aria-hidden="true" />}>
            다시 시도
          </Button>
          {job.failedPhase === 'plan' && onEditReference ? <Button onClick={onEditReference}>다른 레퍼런스로 다시 요청</Button> : null}
        </div>
        {error ? (
          <p role="alert" className="text-[13px] font-medium text-bad">
            {error}
          </p>
        ) : null}

        {lines.length > 0 ? (
          <details className="text-[13px] text-ink-2">
            <summary className="cursor-pointer rounded-chip py-1 font-medium text-ink">진행 기록 보기</summary>
            <ol className="mt-2 flex flex-col gap-1 rounded-control bg-sunken px-3 py-2.5">
              {lines.map((l, i) => (
                <li key={`${l.t}-${i}`} className="break-words">
                  {l.message}
                </li>
              ))}
            </ol>
          </details>
        ) : null}
      </div>
    </Card>
  )
}
