import { BaseArweaveClient } from '@seedprotocol/sdk'

/**
 * Verifies that each Arweave transaction exists and is confirmed on-chain before
 * creating storageTransactionId attestations. Prevents attestations from being
 * created when Arweave publishing has failed.
 *
 * @param txIds - Array of Arweave transaction IDs to verify
 * @throws Error if any transaction is not found (404) or not confirmed
 */
export async function verifyArweaveTransactionsExist(txIds: string[]): Promise<void> {
  if (txIds.length === 0) return

  const results = await Promise.all(
    txIds.map((txId) => BaseArweaveClient.getTransactionStatus(txId))
  )

  for (let i = 0; i < txIds.length; i++) {
    const txId = txIds[i]
    const status = results[i]
    if (!status) continue

    if (status.status === 404) {
      throw new Error(
        `Arweave transaction ${txId} not found. Upload may have failed. Delete this publish record and try again.`
      )
    }

    if (status.status !== 200 || !status.confirmed) {
      throw new Error(
        `Arweave transaction ${txId} is not yet confirmed (status: ${status.status}). Wait and retry.`
      )
    }
  }
}
