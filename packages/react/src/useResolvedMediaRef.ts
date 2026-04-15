import { useCallback, useEffect, useState } from 'react'
import {
  resolveMediaRef,
  type ResolveMediaRefOptions,
  type ResolveMediaRefResult,
} from '@seedprotocol/sdk'

export type UseResolvedMediaRefParams = {
  value: string | undefined | null
  enabled?: boolean
} & ResolveMediaRefOptions

export type UseResolvedMediaRefReturn = {
  href: string | undefined
  status: 'idle' | 'loading' | 'ready' | 'empty' | 'unresolved' | 'error'
  source: 'direct' | 'gateway' | 'localBlob' | undefined
  error: Error | null
  result: ResolveMediaRefResult | null
  refetch: () => void
}

/**
 * Resolve a feed/XML media string (URL, Arweave tx id, seed UID, etc.) to a display URL.
 * Use `SeedImage` when you have a synced item property from the local database.
 */
export function useResolvedMediaRef(params: UseResolvedMediaRefParams): UseResolvedMediaRefReturn {
  const { value, enabled = true, treatAs } = params
  const [tick, setTick] = useState(0)
  const [result, setResult] = useState<ResolveMediaRefResult | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [status, setStatus] = useState<UseResolvedMediaRefReturn['status']>('idle')

  useEffect(() => {
    let cancelled = false
    const go = async () => {
      if (!enabled || value == null || String(value).trim() === '') {
        if (!cancelled) {
          setResult(null)
          setError(null)
          setStatus('idle')
        }
        return
      }
      if (!cancelled) {
        setStatus('loading')
        setError(null)
      }
      try {
        const r = await resolveMediaRef(String(value), { treatAs })
        if (cancelled) return
        setResult(r)
        if (r.status === 'empty') {
          setStatus('empty')
        } else if (r.status === 'ready') {
          setStatus('ready')
        } else {
          setStatus('unresolved')
        }
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e : new Error(String(e)))
        setResult(null)
        setStatus('error')
      }
    }
    void go()
    return () => {
      cancelled = true
    }
  }, [enabled, value, treatAs, tick])

  const refetch = useCallback(() => {
    setTick((t) => t + 1)
  }, [])

  const href =
    result && result.status === 'ready' ? result.href : undefined
  const source =
    result && result.status === 'ready' ? result.source : undefined

  return {
    href,
    status,
    source,
    error,
    result,
    refetch,
  }
}
