import { ActorRefFrom, EventObject, fromCallback, fromPromise, }       from 'xstate'
import debug                                                          from 'debug'
import { ReimbursementResponse, uploadMachine, UploadMachineContext, } from './index'
import { getArweave, }                                                 from '~/helpers/blockchain'
import { UPLOAD_API_BASE_URL }                                         from '~/helpers/constants'
import { postUploadArweaveStart, uploadNetworkErrorMessage, uploadServerErrorMessage } from '~/helpers/uploadApi'

const logger = debug('seedProtocol:services:upload:actors',)


export type UploadActor = ActorRefFrom<typeof uploadMachine>


export const sendReimbursementRequest = fromPromise(async ( {
  input: {
    context,
    event,
  },
}, ): Promise<ReimbursementResponse> => {

  const { uploadTransactions, transactionKeys, reimbursementTransactionId, } = context as UploadMachineContext

  if ( reimbursementTransactionId ) {
    return {
      transactionId : reimbursementTransactionId,
    }
  }

  const transactions = uploadTransactions.map(( { transaction, }, ) => transaction,)

  const formData = new FormData()


  for ( const transaction of transactions ) {
    let { data, chunks, ...json } = transaction
    if ( !(data instanceof Blob) ) {
      data = new Blob([ data, ],)
    }
    formData.append(`${transaction.id}-data`, data, `${transaction.id}-data`,)
    const chunksBlob = new Blob([ JSON.stringify(chunks,), ], { type : 'application/json', },)
    formData.append(`${transaction.id}-chunks`, chunksBlob, `${transaction.id}-chunks`,)
    const jsonBlob = new Blob([ JSON.stringify(json,), ], { type : 'application/json', },)
    formData.append(`${transaction.id}-json`, jsonBlob, `${transaction.id}-json`,)
  }

  // TODO: What if this fails but a successful one has already gone through? We don't want to crash the app

  const url = `${UPLOAD_API_BASE_URL}/api/upload/arweave/start`
  const { status, body, message: serverMessage } = await postUploadArweaveStart(url, formData)

  if ( status >= 300 || status < 200 ) {
    const technicalMsg = status === 0 ? serverMessage : null
    if (technicalMsg) console.error('[upload]', technicalMsg)
    const errMsg = status === 0
      ? uploadNetworkErrorMessage(technicalMsg as string | undefined)
      : uploadServerErrorMessage(status, body, transactionKeys)
    throw new Error(errMsg)
  }

  return body as ReimbursementResponse
},)


export const uploadData = fromCallback<EventObject, { context: UploadMachineContext }>(( {
  sendBack,
  receive,
  input,
}, ) => {

  const { uploadTransactions, } = input.context as UploadMachineContext
  const transactions = uploadTransactions.map(( { transaction, }, ) => transaction,)
  const arweave = getArweave()

  const processTransactions = async (): Promise<string> => {

    for ( const rawTransaction of transactions ) {

      const transaction = arweave.transactions.fromRaw(rawTransaction,)

      const verified = await arweave.transactions.verify(transaction,)

      if ( !verified ) {
        throw new Error('Transaction verification failed',)
      }

      const uploader = await arweave.transactions.getUploader(transaction, transaction.data,)
      while ( !uploader.isComplete ) {
        logger.log('uploading chunk',)
        logger.log(`uploader.pctComplete: ${uploader.pctComplete}`,)
        logger.log(`uploader.uploadedChunks: ${uploader.uploadedChunks}`,)
        logger.log(`uploader.totalChunks: ${uploader.totalChunks}`,)
        logger.log(uploader.lastResponseError,)
        logger.log(uploader.lastResponseStatus,)
        try {
          await uploader.uploadChunk()
          sendBack({ type : 'updatePercentage', completionPercentage : uploader.pctComplete, },)
          logger.log(`${uploader.pctComplete}% complete, ${uploader.uploadedChunks}/${uploader.totalChunks}`,)

        } catch ( error ) {
          logger.log(error,)
        }
      }
    }

    return 'done'
  }

  processTransactions().then(( result, ) => {
    sendBack({ type : 'uploadComplete', result, },)
  },).catch(( error, ) => {
    sendBack({ type : 'uploadError', error, },)
  },)


  return () => {

  }
},)
