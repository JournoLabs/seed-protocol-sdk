import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BaseArweaveClient,
  getArweaveReadBaseUrls,
  ensureImageLocal,
  normalizeArweaveTxIdForEnsure,
  type EnsureImageLocalResult,
  type IItemProperty,
} from '@seedprotocol/sdk'

export type UseEnsureLocalImageParams = {
  imageProperty: IItemProperty<any>
  filename?: string
  width?: number
  /** When false, skip ensure. Default true. */
  enabled?: boolean
}

export type UseEnsureLocalImageReturn = {
  status: 'idle' | 'loading' | EnsureImageLocalResult['status']
  /** Current gateway URL for progressive display; advances through {@link gatewayHrefs} on {@link onGatewayError}. */
  gatewayHref: string | undefined
  /**
   * `/raw/{id}` on every read gateway, preferred ones first (`getArweaveReadBaseUrls`): a
   * just-published image is only on the gateway it was uploaded through until it propagates.
   */
  gatewayHrefs: string[]
  /** Call when `gatewayHref` failed to load (e.g. an `<img>` onError) to move to the next gateway. */
  onGatewayError: () => void
  result: EnsureImageLocalResult | null
}

const readStorageTransactionId = (property: IItemProperty<any>): string | undefined => {
  try {
    const snapshot = property.getService?.()?.getSnapshot?.() as
      | { context?: { storageTransactionId?: string } }
      | undefined
    const ctx = snapshot?.context
    return ctx?.storageTransactionId || undefined
  } catch {
    return undefined
  }
}

/**
 * Ensure an ItemProperty image exists in OPFS (download + targeted resize).
 * Exposes a gateway URL for progressive display while ensuring.
 */
export function useEnsureLocalImage(
  params: UseEnsureLocalImageParams,
): UseEnsureLocalImageReturn {
  const { imageProperty, filename, width, enabled = true } = params
  const [result, setResult] = useState<EnsureImageLocalResult | null>(null)
  const [status, setStatus] = useState<UseEnsureLocalImageReturn['status']>('idle')

  const refResolvedValue = imageProperty?.refResolvedValue
  const rawValue = imageProperty?.value
  const stringValue = typeof rawValue === 'string' ? rawValue : undefined
  const storageTransactionId = readStorageTransactionId(imageProperty)

  const transactionId = useMemo(() => {
    return (
      normalizeArweaveTxIdForEnsure(storageTransactionId) ??
      normalizeArweaveTxIdForEnsure(filename) ??
      normalizeArweaveTxIdForEnsure(refResolvedValue) ??
      normalizeArweaveTxIdForEnsure(stringValue)
    )
  }, [storageTransactionId, filename, refResolvedValue, stringValue])

  const fileName = useMemo(() => {
    const candidate =
      filename ??
      (typeof refResolvedValue === 'string' ? refResolvedValue : undefined) ??
      stringValue
    return candidate?.trim() || undefined
  }, [filename, refResolvedValue, stringValue])

  const gatewayHrefs = useMemo(() => {
    if (!transactionId) return []
    const hrefs: string[] = []
    try {
      for (const base of getArweaveReadBaseUrls()) {
        const href = `${base.replace(/\/$/, '')}/raw/${transactionId}`
        if (!hrefs.includes(href)) hrefs.push(href)
      }
    } catch {
      /* gateway state not ready: fall back to the configured host below */
    }
    try {
      const configured = BaseArweaveClient.getRawUrl(transactionId)
      if (configured && !hrefs.includes(configured)) hrefs.push(configured)
    } catch {
      /* no configured host */
    }
    return hrefs
  }, [transactionId])

  const [gatewayIndex, setGatewayIndex] = useState(0)
  useEffect(() => {
    setGatewayIndex(0)
  }, [gatewayHrefs])
  const gatewayHref = gatewayHrefs[gatewayIndex]
  const onGatewayError = useCallback(() => {
    setGatewayIndex((i) => (i < gatewayHrefs.length ? i + 1 : i))
  }, [gatewayHrefs])

  useEffect(() => {
    let cancelled = false
    const go = async () => {
      if (!enabled) {
        if (!cancelled) {
          setResult(null)
          setStatus('idle')
        }
        return
      }
      if (!transactionId && !fileName) {
        if (!cancelled) {
          setResult(null)
          setStatus('idle')
        }
        return
      }
      if (!cancelled) {
        setStatus('loading')
      }
      try {
        const r = await ensureImageLocal({
          transactionId,
          fileName,
          widths: width != null ? [width] : undefined,
        })
        if (cancelled) return
        setResult(r)
        setStatus(r.status)
      } catch {
        if (cancelled) return
        setResult({ status: 'failed' })
        setStatus('failed')
      }
    }
    void go()
    return () => {
      cancelled = true
    }
  }, [enabled, transactionId, fileName, width])

  return { status, gatewayHref, gatewayHrefs, onGatewayError, result }
}
