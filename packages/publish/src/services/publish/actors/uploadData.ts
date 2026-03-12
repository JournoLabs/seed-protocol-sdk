import { EventObject, fromCallback } from 'xstate'
import type { PublishMachineContext } from '../../../types'
import type { ArweaveTransactionInfo } from '../../../types'
import { getArweave } from '~/helpers/blockchain'
import debug from 'debug'

const logger = debug('seedProtocol:services:publish:actors')

export const uploadData = fromCallback<EventObject, { context: PublishMachineContext }>(
  ({ sendBack, input }) => {
    const arweaveTransactions = input.context.arweaveTransactions ?? []
    const transactions = arweaveTransactions.map(({ transaction }: ArweaveTransactionInfo) => transaction)
    const arweave = getArweave()

    const processTransactions = async (): Promise<string> => {
      for (const rawTransaction of transactions) {
        const transaction = arweave.transactions.fromRaw(rawTransaction)

        const verified = await arweave.transactions.verify(transaction)

        if (!verified) {
          throw new Error('Transaction verification failed')
        }

        const uploader = await arweave.transactions.getUploader(transaction, transaction.data)
        while (!uploader.isComplete) {
          logger('uploading chunk')
          logger(`uploader.pctComplete: ${uploader.pctComplete}`)
          logger(`uploader.uploadedChunks: ${uploader.uploadedChunks}`)
          logger(`uploader.totalChunks: ${uploader.totalChunks}`)
          logger(uploader.lastResponseError)
          logger(uploader.lastResponseStatus)
          try {
            await uploader.uploadChunk()
            sendBack({ type: 'updatePercentage', completionPercentage: uploader.pctComplete })
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
