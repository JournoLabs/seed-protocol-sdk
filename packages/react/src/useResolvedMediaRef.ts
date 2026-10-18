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

type ResolvedState = {
  /** The request (value, options, refetch count) this state belongs to. */
  key: string
  status: UseResolvedMediaRefReturn['status']
  result: ResolveMediaRefResult | null
  error: Error | null
}

/**
 * Resolve a feed/XML media string (URL, Arweave tx id, seed UID, etc.) to a display URL.
 * Use `SeedImage` when you have a synced item property from the local database.
 */
export function useResolvedMediaRef(params: UseResolvedMediaRefParams): UseResolvedMediaRefReturn {
  const { value, enabled = true, treatAs } = params
  const [tick, setTick] = useState(0)
  const key = JSON.stringify([enabled, value ?? null, treatAs ?? null, tick])
  const [state, setState] = useState<ResolvedState | null>(null)

  useEffect(() => {
    let cancelled = false
    let blobUrl: string | undefined
    const go = async () => {
      if (!enabled || value == null || String(value).trim() === '') {
        setState({ key, status: 'idle', result: null, error: null })
        return
      }
      setState({ key, status: 'loading', result: null, error: null })
      try {
        const r = await resolveMediaRef(String(value), { treatAs })
        // A local blob URL is created for this result; nobody else revokes it.
        const createdBlobUrl = r.status === 'ready' && r.source === 'localBlob' ? r.href : undefined
        if (cancelled) {
          if (createdBlobUrl) URL.revokeObjectURL(createdBlobUrl)
          return
        }
        blobUrl = createdBlobUrl
        const status = r.status === 'empty' ? 'empty' : r.status === 'ready' ? 'ready' : 'unresolved'
        setState({ key, status, result: r, error: null })
      } catch (e) {
        if (cancelled) return
        setState({ key, status: 'error', result: null, error: e instanceof Error ? e : new Error(String(e)) })
      }
    }
    void go()
    return () => {
      cancelled = true
      // Release the blob URL this effect created (value changed, refetch, or unmount)
      if (blobUrl) URL.revokeObjectURL(blobUrl)
    }
  }, [key, enabled, value, treatAs])

  const refetch = useCallback(() => {
    setTick((t) => t + 1)
  }, [])

  // State from an earlier value (or before a refetch) is never returned: its blob URL may already
  // be revoked, and it isn't this value's media.
  const current = state?.key === key ? state : null
  const isEmpty = !enabled || value == null || String(value).trim() === ''
  const result = current?.result ?? null
  const href = result && result.status === 'ready' ? result.href : undefined
  const source = result && result.status === 'ready' ? result.source : undefined

  return {
    href,
    status: current?.status ?? (isEmpty ? 'idle' : 'loading'),
    source,
    error: current?.error ?? null,
    result,
    refetch,
  }
}
