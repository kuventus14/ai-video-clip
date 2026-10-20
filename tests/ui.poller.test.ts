import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { JobDto, JobStatus } from '../src/shared/types.ts'
import { ApiError } from '../src/ui/api.ts'
import { startJobPolling } from '../src/ui/poller.ts'

const job = (status: JobStatus): JobDto => ({ id: 'abc1234567', status }) as JobDto

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

function harness(statuses: (JobStatus | Error)[]) {
  const seen: JobStatus[] = []
  const errors: string[] = []
  let calls = 0
  const fetchJob = vi.fn(async () => {
    const next = statuses[Math.min(calls++, statuses.length - 1)]!
    if (next instanceof Error) throw next
    return job(next)
  })
  const poller = startJobPolling('abc1234567', { fetchJob, onJob: (j) => seen.push(j.status), onError: (m) => errors.push(m) })
  return { seen, errors, fetchJob, poller }
}

describe('startJobPolling', () => {
  it('바로 한 번 읽고, 바쁠 땐 1.5초마다 다시 읽는다', async () => {
    const h = harness(['analyzing', 'analyzing', 'awaiting_reference'])
    await vi.advanceTimersByTimeAsync(0)
    expect(h.seen).toEqual(['analyzing'])
    await vi.advanceTimersByTimeAsync(1499)
    expect(h.fetchJob).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(h.seen).toEqual(['analyzing', 'analyzing'])
    h.poller.stop()
  })

  it('사용자 입력을 기다리는 동안은 5초마다 읽는다', async () => {
    const h = harness(['awaiting_plan'])
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(4999)
    expect(h.fetchJob).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(h.fetchJob).toHaveBeenCalledTimes(2)
    h.poller.stop()
  })

  it('확정·실패에 닿으면 더 읽지 않는다', async () => {
    const h = harness(['producing', 'confirmed'])
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1500)
    expect(h.seen).toEqual(['producing', 'confirmed'])
    await vi.advanceTimersByTimeAsync(60_000)
    expect(h.fetchJob).toHaveBeenCalledTimes(2)
  })

  it('stop 하면 그 뒤로는 읽지도 알리지도 않는다', async () => {
    const h = harness(['producing'])
    await vi.advanceTimersByTimeAsync(0)
    h.poller.stop()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(h.fetchJob).toHaveBeenCalledTimes(1)
  })

  it('읽다가 stop 하면 늦게 도착한 응답은 버린다', async () => {
    let resolve!: (j: JobDto) => void
    const seen: JobStatus[] = []
    const fetchJob = vi.fn(() => new Promise<JobDto>((r) => (resolve = r)))
    const poller = startJobPolling('abc1234567', { fetchJob, onJob: (j) => seen.push(j.status), onError: () => {} })
    poller.stop()
    resolve(job('producing'))
    await vi.advanceTimersByTimeAsync(10_000)
    expect(seen).toEqual([])
    expect(fetchJob).toHaveBeenCalledTimes(1)
  })

  it('읽기에 실패하면 알리고 5초 뒤 다시 시도하며, 마지막 값은 지우지 않는다', async () => {
    const h = harness(['producing', new ApiError(0, '서버에 연결할 수 없어요'), 'awaiting_confirm'])
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1500)
    expect(h.errors).toEqual(['서버에 연결할 수 없어요'])
    await vi.advanceTimersByTimeAsync(5000)
    expect(h.seen).toEqual(['producing', 'awaiting_confirm'])
    h.poller.stop()
  })

  it('작업이 없으면(404) 알리고 멈춘다', async () => {
    const h = harness([new ApiError(404, '작업을 찾을 수 없어요')])
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(h.errors).toEqual(['작업을 찾을 수 없어요'])
    expect(h.fetchJob).toHaveBeenCalledTimes(1)
  })
})
