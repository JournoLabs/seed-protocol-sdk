import type { IItem } from '@seedprotocol/sdk'
import { combinePublishCostEstimate } from './estimatePublishCost'
import { estimatePublishCost } from './estimatePublishCost'
import { getCachedMarketRates } from './marketRates'
import type { EstimatePublishCostOptions, PublishCostEstimate } from './types'

export type WatchPublishCostSnapshot = {
  estimate: PublishCostEstimate | null
  isEstimating: boolean
  isStale: boolean
  error: Error | null
}

export type WatchPublishCostOptions = EstimatePublishCostOptions & {
  priceRefreshMs?: number
  /** Trailing idle before re-summarizing the item. 0 = re-estimate on every fingerprint change. */
  itemIdleMs?: number
  estimate?: (item: IItem<any>) => Promise<PublishCostEstimate>
  reprice?: (estimate: PublishCostEstimate) => Promise<PublishCostEstimate>
}

export type WatchPublishCostHandle = {
  dispose: () => void
  refresh: () => void
}

const DEFAULT_PRICE_REFRESH_MS = 60_000
const DEFAULT_ITEM_IDLE_MS = 15_000

function propertyFingerprintValue(prop: { propertyName: string; uid?: string; value?: unknown; getService: () => { getSnapshot: () => unknown } }): string {
  const snapshot = prop.getService().getSnapshot()
  const context =
    snapshot && typeof snapshot === 'object' && 'context' in snapshot
      ? (snapshot as { context?: Record<string, unknown> }).context
      : undefined
  const value = context?.propertyValue ?? (prop as { value?: unknown }).value
  return `${prop.propertyName}:${prop.uid ?? ''}:${String(value ?? '')}`
}

export function itemPublishFingerprint(item: IItem<any>): string {
  const props = item.properties ?? []
  const parts = [
    item.seedLocalId,
    item.seedUid ?? '',
    item.latestVersionLocalId ?? '',
    ...props.map(propertyFingerprintValue),
  ]
  return parts.join('|')
}

function asError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err))
}

/**
 * Watches an item and emits USD publish-cost estimates.
 * First estimate is immediate. Later item edits restart a 15s idle timer.
 * Market rates refresh every 60s and reprice the last work without re-summarizing.
 */
export function watchPublishCost(
  item: IItem<any>,
  onChange: (snapshot: WatchPublishCostSnapshot & { refresh: () => void }) => void,
  options?: WatchPublishCostOptions,
): WatchPublishCostHandle {
  const priceRefreshMs = options?.priceRefreshMs ?? DEFAULT_PRICE_REFRESH_MS
  const itemIdleMs = options?.itemIdleMs ?? DEFAULT_ITEM_IDLE_MS
  const estimateFn =
    options?.estimate ??
    ((target: IItem<any>) => estimatePublishCost(target, options))
  const repriceFn =
    options?.reprice ??
    (async (prev: PublishCostEstimate) => {
      const rates = await getCachedMarketRates({ forceRefresh: true })
      return combinePublishCostEstimate(prev.work, rates, {
        evmUserPays: prev.evm.userPays,
        arweavePath: prev.arweave.path,
      })
    })

  let disposed = false
  let lastFingerprint = itemPublishFingerprint(item)
  let lastEstimate: PublishCostEstimate | null = null
  let isEstimating = false
  let isStale = false
  let error: Error | null = null
  let runId = 0
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  let priceTimer: ReturnType<typeof setInterval> | null = null

  const emit = () => {
    if (disposed) return
    onChange({
      estimate: lastEstimate,
      isEstimating,
      isStale,
      error,
      refresh,
    })
  }

  const runEstimate = async () => {
    const id = ++runId
    isEstimating = true
    error = null
    emit()
    try {
      const next = await estimateFn(item)
      if (disposed || id !== runId) return
      lastEstimate = next
      lastFingerprint = itemPublishFingerprint(item)
      isStale = false
      isEstimating = false
      error = null
      emit()
    } catch (err) {
      if (disposed || id !== runId) return
      isEstimating = false
      error = asError(err)
      emit()
    }
  }

  const scheduleItemEstimate = () => {
    if (lastEstimate) isStale = true
    if (itemIdleMs <= 0) {
      void runEstimate()
      return
    }
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      idleTimer = null
      void runEstimate()
    }, itemIdleMs)
    emit()
  }

  const refresh = () => {
    if (idleTimer) {
      clearTimeout(idleTimer)
      idleTimer = null
    }
    void runEstimate()
  }

  void runEstimate()

  const subscription = item.subscribe(() => {
    if (disposed) return
    const fingerprint = itemPublishFingerprint(item)
    if (fingerprint === lastFingerprint) return
    lastFingerprint = fingerprint
    scheduleItemEstimate()
  })

  if (priceRefreshMs > 0) {
    priceTimer = setInterval(() => {
      if (disposed || !lastEstimate || isEstimating) return
      void (async () => {
        try {
          const next = await repriceFn(lastEstimate!)
          if (disposed) return
          lastEstimate = next
          emit()
        } catch (err) {
          if (disposed) return
          error = asError(err)
          emit()
        }
      })()
    }, priceRefreshMs)
  }

  return {
    refresh,
    dispose: () => {
      disposed = true
      subscription.unsubscribe()
      if (idleTimer) clearTimeout(idleTimer)
      if (priceTimer) clearInterval(priceTimer)
    },
  }
}
