import { useEffect, useMemo, useState } from 'react'
import {
  BaseArweaveClient,
  ensureImageLocal,
  normalizeArweaveTxIdForEnsure,
  type EnsureImageLocalResult,
  type ItemProperty,
} from '@seedprotocol/sdk'

export type UseEnsureLocalImageParams = {
  imageProperty: ItemProperty<any>
  filename?: string
  width?: number
  /** When false, skip ensure. Default true. */
  enabled?: boolean
}

export type UseEnsureLocalImageReturn = {
  status: 'idle' | 'loading' | EnsureImageLocalResult['status']
  gatewayHref: string | undefined
  result: EnsureImageLocalResult | null
}

const readStorageTransactionId = (property: ItemProperty<any>): string | undefined => {
  try {
    const ctx = property.getService?.()?.getSnapshot?.()?.context as
      | { storageTransactionId?: string }
      | undefined
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

  const gatewayHref = useMemo(() => {
    if (!transactionId) return undefined
    try {
      return BaseArweaveClient.getRawUrl(transactionId)
    } catch {
      return undefined
    }
  }, [transactionId])

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

  return { status, gatewayHref, result }
}
