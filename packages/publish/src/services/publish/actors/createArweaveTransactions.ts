import type { GetPublishUploadsOptions } from '@seedprotocol/sdk'
import { fromPromise } from 'xstate'
import type { PublishMachineContext } from '../../../types'
import type { ArweaveTransactionInfo } from '../../../types'
import type { PublishUpload } from '../../../types'
import Transaction from 'arweave/web/lib/transaction'
import { getArweave } from '~/helpers/blockchain'
import { getPublishConfig } from '~/config'
import { waitForItem, deserializeChunks, serializeChunks } from './utils'

export type CreateArweaveTransactionsResult = {
  arweaveTransactions: ArweaveTransactionInfo[]
  publishUploads: PublishUpload[]
}

type PublishInput = { input: { context: PublishMachineContext; event: unknown } }

export const createArweaveTransactions = fromPromise(
  async ({ input: { context } }: PublishInput): Promise<CreateArweaveTransactionsResult> => {
    let { item } = context

    if (!item.getPublishUploads) {
      item = await waitForItem(item.seedLocalId)
    }

    let publishOpts: GetPublishUploadsOptions | undefined
    if (context.arweaveUploadTags?.length) {
      publishOpts = { arweaveUploadTags: context.arweaveUploadTags }
    }
    const publishUploads = await item.getPublishUploads(publishOpts)

    const config = getPublishConfig()
    const signArweaveTransactions = context.signArweaveTransactions ?? config.signArweaveTransactions
    const arweaveJwk = context.arweaveJwk ?? config.arweaveJwk
    const uploads = publishUploads.map((u: PublishUpload) => ({
      versionLocalId: u.versionLocalId,
      itemPropertyName: u.itemPropertyName,
      transactionJson: (u.transactionToSign as Transaction).toJSON(),
    }))

    let results: Array<{ transaction: Record<string, unknown>; versionId?: string; modelName?: string }>
    if (signArweaveTransactions) {
      results = await signArweaveTransactions(uploads)
    } else if (arweaveJwk) {
      const arweave = getArweave()
      const jwk = arweaveJwk
      results = []
      for (const upload of uploads) {
        const tx = arweave.transactions.fromRaw(upload.transactionJson)
        if (tx.data && tx.data.byteLength > 0 && !tx.chunks) {
          await tx.prepareChunks(tx.data)
        }
        await arweave.transactions.sign(tx, jwk)
        const json = tx.toJSON() as Record<string, unknown>
        results.push({
          transaction: {
            ...json,
            chunks: tx.chunks ? serializeChunks(tx.chunks) : undefined,
          },
          versionId: upload.versionLocalId,
          modelName: upload.itemPropertyName,
        })
      }
    } else {
      throw new Error(
        'Arweave signing not configured. Provide signArweaveTransactions or arweaveJwk at createPublish or in PublishProvider config.'
      )
    }

    const arweave = getArweave()
    const arweaveTransactions: ArweaveTransactionInfo[] = (
      results as Array<{ transaction: Record<string, unknown>; versionId?: string; modelName?: string }>
    ).map((r) => {
      const { chunks: serializedChunks, ...rest } = r.transaction as Record<string, unknown>
      const attrs = { ...rest }
      const chunks = deserializeChunks(serializedChunks)
      if (chunks) (attrs as Record<string, unknown>).chunks = chunks
      const tx = arweave.transactions.fromRaw(attrs)
      return {
        transaction: tx,
        versionId: r.versionId,
        modelName: r.modelName,
      }
    })

    return {
      arweaveTransactions,
      publishUploads,
    }
  }
)
