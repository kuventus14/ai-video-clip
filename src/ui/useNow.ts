'use client'

import { useEffect, useState } from 'react'

/** 지금 시각(ms)을 intervalMs 마다 다시 읽는다. 경과 시간 표시용. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return now
}
