'use client'

import { useCallback, useEffect, useState } from 'react'
import type { JobDto } from '../shared/types.ts'
import { listJobs } from './api.ts'

const REFRESH_MS = 5000

/**
 * 작업 목록을 읽어 와 5초마다 새로 읽는다(탭이 숨겨져 있는 동안은 읽지 않고, 다시 보이면 바로 읽는다).
 * 읽기에 실패해도 마지막 목록은 그대로 둔다(error 만 채운다). remove 는 지운 작업을 목록에서 바로 뺀다.
 */
export function useJobs(): { jobs: JobDto[] | null; error: string | null; reload: () => void; remove: (id: string) => void } {
  const [jobs, setJobs] = useState<JobDto[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [round, setRound] = useState(0)

  useEffect(() => {
    const ctrl = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let inFlight = false

    const load = async () => {
      if (inFlight || ctrl.signal.aborted) return
      inFlight = true
      try {
        const next = await listJobs(undefined, ctrl.signal)
        if (ctrl.signal.aborted) return
        setJobs(next)
        setError(null)
      } catch (e) {
        if (ctrl.signal.aborted) return
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        inFlight = false
      }
    }
    const schedule = () => {
      timer = setTimeout(async () => {
        if (!document.hidden) await load()
        if (!ctrl.signal.aborted) schedule()
      }, REFRESH_MS)
    }
    const onVisible = () => {
      if (!document.hidden) void load()
    }

    void load().then(() => {
      if (!ctrl.signal.aborted) schedule()
    })
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      ctrl.abort()
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [round])

  const reload = useCallback(() => setRound((n) => n + 1), [])
  const remove = useCallback((id: string) => setJobs((cur) => (cur ? cur.filter((j) => j.id !== id) : cur)), [])
  return { jobs, error, reload, remove }
}
