import { getArweaveUrlForTransaction } from './arweaveUrl.js'

/**
 * Adds `arweaveUrl` to an assembled Image seed clone when `storageTransactionId`
 * (or snake_case) is present.
 */
export function enrichImageSeedClone(clone: Record<string, unknown>): void {
  const txId = (clone.storageTransactionId ?? clone.storage_transaction_id) as
    | string
    | undefined
  if (txId && typeof txId === 'string' && txId.trim()) {
    try {
      clone.arweaveUrl = getArweaveUrlForTransaction(txId.trim())
    } catch {
      // keep clone without arweaveUrl
    }
  }
}

/** @deprecated Use {@link enrichImageSeedClone} */
export const enrichImageSeedCloneForFeed = enrichImageSeedClone
