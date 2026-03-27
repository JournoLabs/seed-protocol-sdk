import { getUploadPipelineTransactionStatus } from '@seedprotocol/sdk'
import { getPublishConfig } from '~/config'

/**
 * Verifies each id is available via the upload API (`/api/upload/arweave/data/:id`)
 * before creating storageTransactionId attestations. Prevents attestations when
 * the upload pipeline has not indexed the transaction or data item yet.
 *
 * @param txIds - Arweave L1 transaction ids and/or bundler data item ids
 * @throws Error if any id is not found (404) or not yet available
 */
export async function verifyArweaveTransactionsExist(txIds: string[]): Promise<void> {
  if (txIds.length === 0) return

  const { arweaveUploadVerificationBaseUrl } = getPublishConfig()

  const results = await Promise.all(
    txIds.map((txId) =>
      getUploadPipelineTransactionStatus(arweaveUploadVerificationBaseUrl, txId),
    ),
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

    if (status.status !== 200) {
      throw new Error(
        `Arweave transaction ${txId} is not yet available from the upload service (status: ${status.status}). Wait and retry.`
      )
    }
  }
}
