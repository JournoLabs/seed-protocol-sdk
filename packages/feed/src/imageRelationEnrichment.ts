import { getArweaveUrlForTransaction } from './utils/arweaveUrl'

/**
 * Adds `arweaveUrl` to an assembled Image seed clone when `storageTransactionId`
 * (or snake_case) is present, so RSS/JSON feeds can expose both tx id and gateway URL.
 */
export function enrichImageSeedCloneForFeed(clone: Record<string, unknown>): void {
  const txId = (clone.storageTransactionId ?? clone.storage_transaction_id) as string | undefined
  if (txId && typeof txId === 'string' && txId.trim()) {
    try {
      clone.arweaveUrl = getArweaveUrlForTransaction(txId.trim())
    } catch {
      // keep clone without arweaveUrl
    }
  }
}
