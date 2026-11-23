import { useEffect, useState } from 'react'

/**
 * Seconds left until an ISO deadline, re-rendering once a second. Returns null
 * when there is no deadline, so callers can fall back to plain wording.
 */
export function useCountdown(deadline: string | null | undefined): number | null {
  const [, force] = useState(0)

  useEffect(() => {
    if (!deadline) return
    const timer = window.setInterval(() => force((tick) => tick + 1), 1000)
    return () => window.clearInterval(timer)
  }, [deadline])

  if (!deadline) return null
  const remaining = Math.ceil((new Date(deadline).getTime() - Date.now()) / 1000)
  return Math.max(0, remaining)
}
