'use client'

import { CircleAlert, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import type { JobDto } from '../../src/shared/types.ts'
import { retry } from '../../src/ui/api.ts'
import { STEPS, stepForJob } from '../../src/ui/format.ts'
import { Button } from '../ui/Button.tsx'

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
    <div className="flex flex-col gap-5">
      {/* 멈춘 화면: 신호가 끊긴 모니터처럼 붉은 뷰파인더 */}
      <div className="vf relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-panel bg-stage" aria-hidden="true">
        {job.media.thumb ? <img src={job.media.thumb} alt="" className="absolute inset-0 size-full object-contain opacity-25 grayscale" /> : null}
        <span className="vf-c !border-bad" data-p="tl" />
        <span className="vf-c !border-bad" data-p="tr" />
        <span className="vf-c !border-bad" data-p="bl" />
        <span className="vf-c !border-bad" data-p="br" />
        <div className="relative flex items-center gap-3 text-bad">
          <CircleAlert size={30} strokeWidth={1.75} />
          <span className="text-[22px] font-bold tracking-[-0.02em]">{STEPS[stepForJob(job)]} 단계에서 멈췄어요</span>
        </div>
      </div>

      <div className="rounded-panel bg-panel p-6">
        <h2 className="sr-only">{STEPS[stepForJob(job)]} 단계에서 멈췄어요</h2>
        <p role="alert" className="break-words text-[17px] leading-relaxed text-ink">
          {job.error ?? '이유를 알 수 없는 오류가 났어요.'}
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button variant="primary" loading={busy} onClick={onRetry} icon={<RotateCcw size={18} strokeWidth={2} aria-hidden="true" />}>
            다시 시도
          </Button>
          {job.failedPhase === 'plan' && onEditReference ? <Button onClick={onEditReference}>다른 레퍼런스로 다시 요청</Button> : null}
        </div>
        {error ? (
          <p role="alert" className="mt-3 text-[13px] font-medium text-bad">
            {error}
          </p>
        ) : null}

        {lines.length > 0 ? (
          <details className="mt-6 text-[13px] text-ink-2">
            <summary className="cursor-pointer rounded-chip py-1 font-semibold text-ink-2 hover:text-ink">진행 기록 보기</summary>
            <ol className="mt-2 flex flex-col gap-1.5 rounded-control bg-raised px-4 py-3">
              {lines.map((l, i) => (
                <li key={`${l.t}-${i}`} className="break-words">
                  {l.message}
                </li>
              ))}
            </ol>
          </details>
        ) : null}
      </div>
    </div>
  )
}
