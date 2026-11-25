import { useEffect, useState } from 'react'
import { getSponsorStatus, type SponsorStatus } from '../services/sponsorStatus/sponsorStatus'

export type UseSponsorStatusResult = {
  /** `null` without `payment.sponsorPaymaster`, or until the first read finishes or when it fails. */
  status: SponsorStatus | null
  isLoading: boolean
}

/** The sponsoring paymaster's EntryPoint v0.8 deposit ({@link getSponsorStatus}), read on mount. */
export function useSponsorStatus(): UseSponsorStatusResult {
  const [status, setStatus] = useState<SponsorStatus | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  useEffect(() => {
    let cancelled = false
    getSponsorStatus()
      .catch(() => null)
      .then((next) => {
        if (cancelled) return
        setStatus(next)
        setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])
  return { status, isLoading }
}
