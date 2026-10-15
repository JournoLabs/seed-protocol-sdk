import { getUploadPipelineTransactionStatus } from '@seedprotocol/sdk'
import { getPublishConfig } from '~/config'
import { resolvePublishPayment } from '~/payment'
import { getTurboDataItemStatus } from '~/helpers/turbo'

/**
 * Verifies each id is available via the upload API (`/api/upload/arweave/data/:id`), or from
 * Turbo for user-paid storage,
 * before creating storageTransactionId attestations. Prevents attestations when
 * the upload pipeline has not indexed the transaction or data item yet.
 *
 * @param txIds - Arweave L1 transaction ids and/or bundler data item ids
 * @throws Error if any id is not found (404) or not yet available
 */
export async function verifyArweaveTransactionsExist(txIds: string[]): Promise<void> {
  if (txIds.length === 0) return

  const config = getPublishConfig()
  const { storage } = resolvePublishPayment(config)
  if (storage.uploadTo === 'turbo' && storage.turbo) {
    // User-paid uploads went to Turbo, not the upload API.
    const turbo = storage.turbo
    const statuses = await Promise.all(txIds.map((id) => getTurboDataItemStatus(turbo, id)))
    statuses.forEach((status, i) => {
      if (status === 404) {
        throw new Error(
          `Arweave data item ${txIds[i]} not found on Turbo. Upload may have failed. Delete this publish record and try again.`,
        )
      }
      if (status !== 200) {
        throw new Error(`Arweave data item ${txIds[i]} is not yet available from Turbo (status: ${status}). Wait and retry.`)
      }
    })
    return
  }

  const { arweaveUploadVerificationBaseUrl } = config

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
      const detail =
        status.status === 504
          ? 'request timed out (upload service did not respond in time)'
          : `status: ${status.status}`
      throw new Error(
        `Arweave transaction ${txId} is not yet available from the upload service (${detail}). Wait and retry.`
      )
    }
  }
}
