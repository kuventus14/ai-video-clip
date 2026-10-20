import type { JobDto } from '../shared/types.ts'
import { ApiError } from './api.ts'
import { pollIntervalMs } from './format.ts'

export interface PollerDeps {
  fetchJob: (id: string, signal: AbortSignal) => Promise<JobDto>
  onJob: (job: JobDto) => void
  /** message 는 화면에 보여 줘도 되는 한국어, error 는 원래 오류(상태 코드를 보고 싶을 때) */
  onError: (message: string, error: unknown) => void
}

const RETRY_MS = 5000

/**
 * 작업을 바로 한 번 읽고, 상태에 맞는 간격(pollIntervalMs)으로 계속 읽는다. 확정·실패에 닿거나 작업이 없으면(404·400) 멈추고,
 * 읽기에 실패하면 알린 뒤 5초 뒤 다시 읽는다. stop() 이후에는 읽지도 알리지도 않는다(늦게 도착한 응답은 버린다).
 */
export function startJobPolling(id: string, deps: PollerDeps): { stop: () => void } {
  const ctrl = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined

  const tick = async () => {
    let nextMs: number | null = RETRY_MS
    try {
      const job = await deps.fetchJob(id, ctrl.signal)
      if (ctrl.signal.aborted) return
      deps.onJob(job)
      nextMs = pollIntervalMs(job.status)
    } catch (e) {
      if (ctrl.signal.aborted) return
      deps.onError(e instanceof Error ? e.message : String(e), e)
      if (e instanceof ApiError && (e.status === 404 || e.status === 400)) nextMs = null
    }
    if (nextMs !== null) timer = setTimeout(tick, nextMs)
  }
  void tick()

  return {
    stop() {
      ctrl.abort()
      clearTimeout(timer)
    },
  }
}
