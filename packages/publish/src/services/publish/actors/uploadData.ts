import { EventObject, fromCallback } from 'xstate'
import type { PublishMachineContext } from '../../../types'
import type { ArweaveTransactionInfo } from '../../../types'
import { getArweave } from '~/helpers/blockchain'
import debug from 'debug'

const logger = debug('seedProtocol:services:publish:actors')

function ensureUint8Array(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  throw new Error('Transaction data must be Uint8Array or ArrayBuffer for upload resume')
}

export const uploadData = fromCallback<EventObject, { context: PublishMachineContext }>(
  ({ sendBack, input }) => {
    const ctx = input.context
    const arweaveTransactions = ctx.arweaveTransactions ?? []
    const transactions = arweaveTransactions.map(({ transaction }: ArweaveTransactionInfo) => transaction)
    const arweave = getArweave()

    const resumeState = ctx.uploaderState && typeof ctx.currentTransactionIndex === 'number'
    const startIndex = resumeState ? ctx.currentTransactionIndex! : 0

    const processTransactions = async (): Promise<string> => {
      const total = transactions.length
      for (let i = startIndex; i < total; i++) {
        const rawTransaction = transactions[i]
        if (!rawTransaction) continue
        const transaction = arweave.transactions.fromRaw(rawTransaction as object)

        const verified = await arweave.transactions.verify(transaction)
        if (!verified) {
          throw new Error('Transaction verification failed')
        }

        let uploader: Awaited<ReturnType<typeof arweave.transactions.getUploader>>
        const uploaderState = ctx.uploaderState
        if (resumeState && i === startIndex && uploaderState) {
          const data = transaction.data
          const dataBytes = data instanceof Uint8Array ? data : ensureUint8Array(data)
          uploader = await arweave.transactions.getUploader(uploaderState as unknown as Parameters<typeof arweave.transactions.getUploader>[0], dataBytes)
        } else {
          uploader = await arweave.transactions.getUploader(transaction, transaction.data)
        }

        while (!uploader.isComplete) {
          logger('uploading chunk')
          logger(`uploader.pctComplete: ${uploader.pctComplete}`)
          logger(`uploader.uploadedChunks: ${uploader.uploadedChunks}`)
          logger(`uploader.totalChunks: ${uploader.totalChunks}`)
          logger(uploader.lastResponseError)
          logger(uploader.lastResponseStatus)
          try {
            await uploader.uploadChunk()
            const pct = Math.trunc(((i + uploader.pctComplete / 100) / total) * 100)
            sendBack({
              type: 'updatePercentage',
              completionPercentage: pct,
              uploaderState: uploader.toJSON(),
              currentTransactionIndex: i,
            })
            logger(`${uploader.pctComplete}% complete, ${uploader.uploadedChunks}/${uploader.totalChunks}`)
          } catch (error) {
            logger(error)
          }
        }
      }

      return 'done'
    }

    processTransactions()
      .then((result) => {
        sendBack({ type: 'uploadComplete', result })
      })
      .catch((error) => {
        sendBack({ type: 'uploadError', error })
      })
  }
)
