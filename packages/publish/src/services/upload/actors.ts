import { ActorRefFrom, EventObject, fromCallback, fromPromise } from 'xstate'
import debug from 'debug'
import { getArweave } from '../../helpers/blockchain'
import { getPublishConfig } from '../../config'
import {
  postUploadArweaveStart,
  uploadNetworkErrorMessage,
  uploadServerErrorMessage,
} from '../../helpers/uploadApi'
import type { ReimbursementResponse, UploadMachineContext } from './uploadMachine'

const logger = debug('seedProtocol:services:upload:actors')

export type UploadActor = ActorRefFrom<typeof import('./uploadMachine').uploadMachine>

export const sendReimbursementRequest = fromPromise(
  async ({
    input: { context, event },
  }: {
    input: { context: UploadMachineContext; event?: unknown }
  }): Promise<ReimbursementResponse> => {
    const { uploadTransactions, transactionKeys, reimbursementTransactionId } = context

    if (reimbursementTransactionId) {
      return {
        transactionId: reimbursementTransactionId,
      }
    }

    const transactions = uploadTransactions.map(({ transaction }) => transaction)
    const formData = new FormData()

    for (const transaction of transactions) {
      let { data, chunks, ...json } = transaction as { id: string; data?: unknown; chunks?: unknown; [k: string]: unknown }
      if (!(data instanceof Blob)) {
        data = new Blob([data as BlobPart])
      }
      formData.append(`${(transaction as { id: string }).id}-data`, data as Blob, `${(transaction as { id: string }).id}-data`)
      const chunksBlob = new Blob([JSON.stringify(chunks)], { type: 'application/json' })
      formData.append(`${(transaction as { id: string }).id}-chunks`, chunksBlob, `${(transaction as { id: string }).id}-chunks`)
      const jsonBlob = new Blob([JSON.stringify(json)], { type: 'application/json' })
      formData.append(`${(transaction as { id: string }).id}-json`, jsonBlob, `${(transaction as { id: string }).id}-json`)
    }

    const uploadApiBaseUrl = getPublishConfig().uploadApiBaseUrl
    const url = `${uploadApiBaseUrl}/api/upload/arweave/start`
    const { status, body, message: serverMessage } = await postUploadArweaveStart(
      url,
      formData,
      uploadApiBaseUrl
    )

    if (status >= 300 || status < 200) {
      const technicalMsg = status === 0 ? serverMessage : null
      if (technicalMsg) console.error('[upload]', technicalMsg)
      const errMsg =
        status === 0
          ? uploadNetworkErrorMessage(technicalMsg as string | undefined)
          : uploadServerErrorMessage(status, body, transactionKeys)
      throw new Error(errMsg)
    }

    return body as ReimbursementResponse
  }
)

export const uploadData = fromCallback<EventObject, { context: UploadMachineContext }>(
  ({ sendBack, input }) => {
    const { uploadTransactions } = input.context
    const transactions = uploadTransactions.map(({ transaction }) => transaction)
    const arweave = getArweave()

    const processTransactions = async (): Promise<string> => {
      for (const rawTransaction of transactions) {
        const transaction = arweave.transactions.fromRaw(rawTransaction as import('arweave/web/lib/transaction').default)

        const verified = await arweave.transactions.verify(transaction)
        if (!verified) {
          throw new Error('Transaction verification failed')
        }

        const uploader = await arweave.transactions.getUploader(transaction, transaction.data)
        while (!uploader.isComplete) {
          logger('uploading chunk')
          try {
            await uploader.uploadChunk()
            sendBack({ type: 'updatePercentage', completionPercentage: uploader.pctComplete })
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
        sendBack({ type: 'uploadFailed', error })
      })

    return () => {}
  }
)
