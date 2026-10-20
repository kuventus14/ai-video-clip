'use client'

import { useCallback, useEffect, useState } from 'react'
import type { JobDto } from '../shared/types.ts'
import { getJob } from './api.ts'
import { startJobPolling } from './poller.ts'

/**
 * 작업 하나를 읽어 와 상태에 맞는 간격으로 계속 갱신한다. 언마운트하거나 확정·실패에 닿으면 멈춘다.
 * 동작(시작·승인 등)을 보낸 뒤에는 refresh(응답) 로 응답을 바로 반영하고 다시 읽기 시작한다.
 * 읽기에 실패해도 마지막으로 받은 job 은 그대로 둔다(error 만 채운다).
 */
export function useJob(id: string): { job: JobDto | null; error: string | null; refresh: (next?: JobDto) => void } {
  const [job, setJob] = useState<JobDto | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [round, setRound] = useState(0)

  useEffect(() => {
    const poller = startJobPolling(id, {
      fetchJob: getJob,
      onJob: (j) => {
        setJob(j)
        setError(null)
      },
      onError: setError,
    })
    return poller.stop
  }, [id, round])

  const refresh = useCallback((next?: JobDto) => {
    if (next) setJob(next)
    setRound((n) => n + 1)
  }, [])

  return { job, error, refresh }
}
