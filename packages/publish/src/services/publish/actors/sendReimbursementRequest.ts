import { fromPromise } from 'xstate'
import type { PublishMachineContext } from '../../../types'
import type { ArweaveTransactionInfo } from '../../../types'
import type { ReimbursementResponse } from '../../../types'
import { getPublishConfig } from '~/config'
import {
  postUploadArweaveStart,
  uploadNetworkErrorMessage,
  uploadServerErrorMessage,
} from '~/helpers/uploadApi'

type PublishInput = { input: { context: PublishMachineContext; event: unknown } }

export const sendReimbursementRequest = fromPromise(
  async ({ input: { context, event } }: PublishInput): Promise<ReimbursementResponse> => {
    const { arweaveTransactions = [], transactionKeys, reimbursementTransactionId } = context

    if (reimbursementTransactionId) {
      return {
        transactionId: reimbursementTransactionId,
      }
    }

    const transactions = arweaveTransactions.map(({ transaction }: ArweaveTransactionInfo) => transaction)

    const formData = new FormData()

    type ArweaveTx = { id: string; data?: unknown; chunks?: unknown; [key: string]: unknown }
    for (const transaction of transactions as ArweaveTx[]) {
      let { data, chunks, ...json } = transaction
      const dataBlob = data instanceof Blob ? data : new Blob([data as BlobPart])
      formData.append(`${transaction.id}-data`, dataBlob, `${transaction.id}-data`)
      const chunksBlob = new Blob([JSON.stringify(chunks)], { type: 'application/json' })
      formData.append(`${transaction.id}-chunks`, chunksBlob, `${transaction.id}-chunks`)
      const jsonBlob = new Blob([JSON.stringify(json)], { type: 'application/json' })
      formData.append(`${transaction.id}-json`, jsonBlob, `${transaction.id}-json`)
    }

    const { uploadApiBaseUrl } = getPublishConfig()
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
