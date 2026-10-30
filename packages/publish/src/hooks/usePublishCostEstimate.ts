import { useCallback, useEffect, useRef, useState } from 'react'
import type { IItem } from '@seedprotocol/sdk'
import {
  watchPublishCost,
  type WatchPublishCostOptions,
} from '../services/publishCost/watchPublishCost'
import type { PublishCostEstimate } from '../services/publishCost/types'

export type UsePublishCostEstimateResult = {
  estimate: PublishCostEstimate | null
  isEstimating: boolean
  isStale: boolean
  error: Error | null
  refresh: () => void
}

export function usePublishCostEstimate(
  item: IItem<any> | null | undefined,
  options?: WatchPublishCostOptions,
): UsePublishCostEstimateResult {
  const [estimate, setEstimate] = useState<PublishCostEstimate | null>(null)
  const [isEstimating, setIsEstimating] = useState(false)
  const [isStale, setIsStale] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const refreshRef = useRef<() => void>(() => {})
  /** The last estimate and what it was for, handed to a watcher that replaces one for the same item. */
  const lastEstimateRef = useRef<{
    seedLocalId: string | undefined
    publishMode: WatchPublishCostOptions['publishMode']
    estimate: PublishCostEstimate | null
  } | null>(null)

  const publishMode = options?.publishMode
  const priceRefreshMs = options?.priceRefreshMs
  const itemIdleMs = options?.itemIdleMs

  useEffect(() => {
    if (!item) {
      setEstimate(null)
      setIsEstimating(false)
      setIsStale(false)
      setError(null)
      refreshRef.current = () => {}
      lastEstimateRef.current = null
      return
    }

    // A new Item instance for the same record (e.g. after the old one was evicted) keeps showing
    // the last estimate while the new watcher's first one runs.
    const seedLocalId = item.seedLocalId
    const last = lastEstimateRef.current
    const previousEstimate =
      (last && last.seedLocalId === seedLocalId && last.publishMode === publishMode ? last.estimate : null) ??
      options?.previousEstimate ??
      null

    const handle = watchPublishCost(
      item,
      (snapshot) => {
        lastEstimateRef.current = { seedLocalId, publishMode, estimate: snapshot.estimate }
        setEstimate(snapshot.estimate)
        setIsEstimating(snapshot.isEstimating)
        setIsStale(snapshot.isStale)
        setError(snapshot.error)
        refreshRef.current = snapshot.refresh
      },
      { ...options, previousEstimate },
    )

    return () => {
      handle.dispose()
    }
    // Primitive option fields only — avoid resubscribing on a new options object each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item, item?.seedLocalId, publishMode, priceRefreshMs, itemIdleMs])

  const refresh = useCallback(() => {
    refreshRef.current()
  }, [])

  return { estimate, isEstimating, isStale, error, refresh }
}
