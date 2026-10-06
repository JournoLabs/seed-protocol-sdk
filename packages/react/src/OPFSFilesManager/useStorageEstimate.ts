import { useEffect, useState } from 'react'

export interface StorageEstimate {
  /** Bytes this origin uses across OPFS, IndexedDB, Cache Storage, etc. */
  usage: number
  /** Bytes this origin may use. */
  quota: number
}

/**
 * Read `navigator.storage.estimate()`, re-reading whenever `revision` changes.
 * Returns null where the API is unavailable. Browsers round and pad these numbers.
 */
export function useStorageEstimate(revision: unknown): StorageEstimate | null {
  const [estimate, setEstimate] = useState<StorageEstimate | null>(null)

  useEffect(() => {
    if (typeof navigator === 'undefined' || typeof navigator.storage?.estimate !== 'function') return
    let cancelled = false
    navigator.storage.estimate().then(
      ({ usage, quota }) => {
        if (!cancelled && usage != null && quota != null) setEstimate({ usage, quota })
      },
      () => {},
    )
    return () => {
      cancelled = true
    }
  }, [revision])

  return estimate
}
