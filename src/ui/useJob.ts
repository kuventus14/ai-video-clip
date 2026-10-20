'use client'

import { useCallback, useEffect, useState } from 'react'
import type { JobDto } from '../shared/types.ts'
import { ApiError, getJob } from './api.ts'
import { startJobPolling } from './poller.ts'

interface Snapshot {
  id: string | null
  job: JobDto | null
  error: string | null
  /** 서버가 이 작업을 모른다(404) 또는 주소가 잘못됐다(400) */
  notFound: boolean
}

/**
 * 작업 하나를 읽어 와 상태에 맞는 간격으로 계속 갱신한다. 언마운트하거나 확정·실패에 닿으면 멈춘다. id 가 null 이면 아무것도 읽지 않는다.
 * 동작(시작·승인 등)을 보낸 뒤에는 refresh(응답) 로 응답을 바로 반영하고 다시 읽기 시작한다.
 * 읽기에 실패해도 마지막으로 받은 job 은 그대로 둔다(error 만 채운다). id 가 바뀌면 이전 작업의 값은 보이지 않는다.
 */
export function useJob(id: string | null): { job: JobDto | null; error: string | null; notFound: boolean; refresh: (next?: JobDto) => void } {
  const [snapshot, setSnapshot] = useState<Snapshot>({ id, job: null, error: null, notFound: false })
  const [round, setRound] = useState(0)

  useEffect(() => {
    if (!id) return
    const poller = startJobPolling(id, {
      fetchJob: getJob,
      onJob: (job) => setSnapshot({ id, job, error: null, notFound: false }),
      onError: (error, cause) => setSnapshot((s) => ({ id, job: s.id === id ? s.job : null, error, notFound: cause instanceof ApiError && (cause.status === 404 || cause.status === 400) })),
    })
    return poller.stop
  }, [id, round])

  const refresh = useCallback((next?: JobDto) => {
    if (next) setSnapshot({ id: next.id, job: next, error: null, notFound: false })
    setRound((n) => n + 1)
  }, [])

  const current = snapshot.id === id ? snapshot : null
  return { job: current?.job ?? null, error: current?.error ?? null, notFound: current?.notFound ?? false, refresh }
}
