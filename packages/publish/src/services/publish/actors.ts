import { ActorRefFrom, EventObject, fromCallback, fromPromise, } from 'xstate'
import { ArweaveTransactionInfo, } from '~/types/types'
import {
  ZERO_ADDRESS,
} from '@ethereum-attestation-service/eas-sdk'
import { client, } from '../../helpers/thirdweb'
import { getContract, parseEventLogs, sendTransaction, waitForReceipt, } from 'thirdweb'
import {
  optimismSepolia,
} from 'thirdweb/chains'
import {
  createdAttestationEvent,
  getEas,
  multiPublish,
  seedPublishedEvent,
  setEas,
} from '~/helpers/thirdweb/11155420/0xcd8c945872df8e664e55cf8885c85ea3ea8f2148'
import { decodeAbiParameters, } from 'viem'
import { publishMachine, } from './index'
// import { getModelInstance, getPublishAttempt, } from '~/helpers'
import Transaction from 'arweave/web/lib/transaction'
import { ReimbursementResponse, } from '~/services/upload'
import { signTransaction } from '~/helpers/arweaveClient'
import { Item, PublishUpload, } from '@seedprotocol/sdk'
import { writeAppState } from '~/helpers/appState'
import { persistSeedUidFromPublishResult } from './actors/persistSeedUid'
import { ensureEasSchemasForItem } from './helpers/ensureEasSchemas'
import { UPLOAD_API_BASE_URL, EAS_CONTRACT_ADDRESS } from '~/helpers/constants'
import { postUploadArweaveStart, uploadNetworkErrorMessage, uploadServerErrorMessage } from '~/helpers/uploadApi'
import debug from 'debug'


const logger = debug('seedProtocol:services:publish:actors')

const ZERO_BYTES32 = '0x' + '0'.repeat(64)

const BYTES32_LEN = 64
function toHex32Normalized(v: string | undefined): string {
  if (v == null || v === '') return ZERO_BYTES32
  const raw = v.startsWith('0x') ? v.slice(2) : v
  const hex = raw.replace(/[^0-9a-fA-F]/g, '0').padStart(BYTES32_LEN, '0').slice(-BYTES32_LEN)
  return ('0x' + hex).toLowerCase()
}

/**
 * Extract the seed attestation UID by matching the request's seedSchemaUid to a CreatedAttestation
 * event. The payload links each request to a schema (seedSchemaUid); the contract emits
 * CreatedAttestation(schemaUid, attestationUid) for each attestation, so we find the event whose
 * schemaUid matches and use its attestationUid. No index guessing.
 */
function seedUidFromCreatedAttestationEvents(
  receipt: { logs?: Array<{ address?: string; data?: string; topics?: unknown[] }> },
  seedSchemaUid: string | undefined,
): string | undefined {
  if (!seedSchemaUid || !receipt.logs?.length) return undefined
  const wantSchema = toHex32Normalized(seedSchemaUid)
  if (wantSchema === ZERO_BYTES32) return undefined
  try {
    const parsed = parseEventLogs({
      logs: receipt.logs as import('viem').Log[],
      events: [createdAttestationEvent()],
      strict: false,
    })
    for (const ev of parsed) {
      const result = ev?.args?.result as { schemaUid?: string; attestationUid?: string } | undefined
      if (!result?.attestationUid) continue
      if (toHex32Normalized(result.schemaUid) === wantSchema) {
        const uid = result.attestationUid
        if (uid && toHex32Normalized(uid) !== ZERO_BYTES32) return uid
        return undefined
      }
    }
  } catch {
    // ignore
  }
  return undefined
}

/**
 * Fallback: extract seed UID from SeedPublished(bytes) when CreatedAttestation events are not
 * available or don't match. Uses index listOfAttestations.length for the seed (property
 * attestations first, then seed).
 */
function seedUidFromSeedPublished(
  receipt: { logs?: Array<{ address?: string; data?: string; topics?: unknown[] }> },
  contractAddress: string,
  listOfAttestationsCount: number,
): string | undefined {
  const want = contractAddress.toLowerCase()
  const logs = receipt.logs?.filter(
    (l) => l.address && l.address.toLowerCase() === want,
  )
  if (!logs?.length) return undefined
  try {
    const parsed = parseEventLogs({
      logs: logs as import('viem').Log[],
      events: [seedPublishedEvent()],
      strict: false,
    })
    const first = parsed[0]
    const data = first?.args?.returnedDataFromEAS as `0x${string}` | undefined
    if (!data || data === '0x') return undefined
    const decoded = decodeAbiParameters([{ type: 'bytes32[]' }], data)
    const uids = decoded[0] as readonly `0x${string}`[]
    if (!uids?.length) return undefined
    const seedIndex = listOfAttestationsCount
    const atIndex = uids[seedIndex]
    if (atIndex && atIndex !== ZERO_BYTES32) return atIndex as string
    if (uids.length === 1 && uids[0] && uids[0] !== ZERO_BYTES32) return uids[0] as string
    return undefined
  } catch {
    return undefined
  }
}


const waitForItem = async ( seedLocalId: string, ): Promise<Item<any>> => {
  let item

  try {
    item = await Item.find({seedLocalId,})
  } catch ( error ) {
    // No-op: Error is intentionally ignored
  }

  if ( item ) {
    return item
  }


  return new Promise<Item<any>>( ( resolve, reject, ) => {
    const interval = setInterval(() => {
      try {
        Item.find({seedLocalId,})
          .then(( item: Item<any> | undefined ) => {
            if ( item ) {
              clearInterval(interval,)
              resolve(item)
            }
          })
      } catch ( error ) {
        // No-op: Error is intentionally ignored
      }

    }, 200)
  },)
}

const activePublishProcesses = new Set<string>()

type CreateArweaveTransactionsResult = {
  arweaveTransactions: ArweaveTransactionInfo[]
  publishUploads: /* `PublishUpload` seems to be a type or interface used in the codebase to represent
  data related to uploading content for publishing. It likely contains information
  such as the transaction to sign, version local ID, item property name, and
  possibly other relevant details needed for the publishing process. It is used in
  functions like `createArweaveTransactions` and `createAttestations` to handle the
  upload data and transactions associated with publishing content. */
  PublishUpload[]
}

export type PublishActor = ActorRefFrom<typeof publishMachine>

export const createArweaveTransactions = fromPromise(async ( {
  input: {
    context,
    event,
  },
}, ): Promise<CreateArweaveTransactionsResult> => {

  let {item} = context

  if (!item.getPublishUploads) {
    item = await waitForItem(item.seedLocalId)
  }

  // const adapter = await import('@pianity/arsnap-adapter')

  const publishUploads = await item.getPublishUploads()

  const arweaveTransactions: ArweaveTransactionInfo[] = []

  for ( const uploadData of publishUploads ) {
    const transaction = uploadData.transactionToSign as Transaction
    await signTransaction(transaction)
    arweaveTransactions.push({
      transaction,
      versionId: uploadData.versionLocalId,
      modelName: uploadData.itemPropertyName,
    },)
  }

  return {
    arweaveTransactions,
    publishUploads,
  }


},)

export const sendReimbursementRequest = fromPromise(async ( {
                                                              input: {
                                                                context,
                                                                event,
                                                              },
                                                            }, ): Promise<ReimbursementResponse> => {


  const {arweaveTransactions, transactionKeys, reimbursementTransactionId,} = context

  if ( reimbursementTransactionId ) {
    return {
      transactionId: reimbursementTransactionId,
    }
  }

  const transactions = arweaveTransactions.map(( {transaction,}, ) => transaction,)

  const formData = new FormData()


  for ( const transaction of transactions ) {
    let {data, chunks, ...json} = transaction
    if ( !(data instanceof Blob) ) {
      data = new Blob([ data, ],)
    }
    formData.append(`${transaction.id}-data`, data, `${transaction.id}-data`,)
    const chunksBlob = new Blob([ JSON.stringify(chunks,), ], {type: 'application/json',},)
    formData.append(`${transaction.id}-chunks`, chunksBlob, `${transaction.id}-chunks`,)
    const jsonBlob = new Blob([ JSON.stringify(json,), ], {type: 'application/json',},)
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

export const pollForConfirmation = fromPromise(async ( {input: {context, event,},}, ): Promise<void> => {

  const {requestResponse, reimbursementTransactionId} = context

  if ( !requestResponse ) {
    throw new Error('No request response',)
  }

  if ( !reimbursementTransactionId ) {
    throw new Error('No reimbursement transaction id',)
  }

  const arweave = getArweave()

  const _pollForConfirmation = new Promise<void>(( resolve, reject, ) => {
      const interval = setInterval(async () => {
        let response
        try {
          response = await arweave.transactions.getStatus(reimbursementTransactionId,)
        } catch ( error ) {
          return
        }
        if (response && response.confirmed ) {
          clearInterval(interval,)
          resolve()
        }
      }, 5000)

    })

  await _pollForConfirmation

})

export const uploadData = fromCallback<EventObject, any>(( {
                                                             sendBack,
                                                             input,
                                                           }, ) => {

  const {arweaveTransactions,} = input.context
  const transactions           = arweaveTransactions.map(( {transaction,}, ) => transaction,)
  const arweave                = getArweave()

  const processTransactions = async (): Promise<string> => {

    for ( const rawTransaction of transactions ) {

      const transaction = arweave.transactions.fromRaw(rawTransaction,)

      const verified = await arweave.transactions.verify(transaction,)

      if ( !verified ) {
        throw new Error('Transaction verification failed',)
      }

      const uploader = await arweave.transactions.getUploader(transaction, transaction.data,)
      while ( !uploader.isComplete ) {
        logger('uploading chunk',)
        logger(`uploader.pctComplete: ${uploader.pctComplete}`,)
        logger(`uploader.uploadedChunks: ${uploader.uploadedChunks}`,)
        logger(`uploader.totalChunks: ${uploader.totalChunks}`,)
        logger(uploader.lastResponseError,)
        logger(uploader.lastResponseStatus,)
        try {
          await uploader.uploadChunk()
          sendBack({type: 'updatePercentage', completionPercentage: uploader.pctComplete,},)
          logger(`${uploader.pctComplete}% complete, ${uploader.uploadedChunks}/${uploader.totalChunks}`,)

        } catch ( error ) {
          logger(error,)
        }
      }
    }

    return 'done'
  }

  processTransactions().then(( result, ) => {
    sendBack({type: 'uploadComplete', result,},)
  },).catch(( error, ) => {
    sendBack({type: 'uploadError', error,},)
  },)
},)

export const createAttestations = fromPromise(async ( {input: {context, event,},}, ): Promise<void> => {

  const { address, account } = context
  const arweaveTransactions = context.arweaveTransactions ?? []
  const publishUploads = context.publishUploads ?? []
  let { item } = context

  if (!address || typeof address !== 'string' || !address.trim()) {
    throw new Error('No wallet address for publish. Connect a wallet and try again.')
  }

  if (!account) {
    throw new Error('Wallet session is missing. Reconnect your wallet and retry the publish.')
  }

  if (!item.getPublishUploads) {
    item = await waitForItem(item.seedLocalId)
  }

  const smartWalletContract = getContract({
    client,
    chain: optimismSepolia,
    address,
  },)

  let easAddress: string
  try {
    easAddress = await getEas({
      contract: smartWalletContract,
    },) as string
  } catch (getEasErr: unknown) {
    const err = getEasErr instanceof Error ? getEasErr : new Error(String(getEasErr))
    const msg = err.message
    // Contract returned "0x" (e.g. EOA or not deployed). Treat as EAS not set so we attempt setEas; if address has no code, sendTransaction will fail with a clear error.
    if (err.name === 'AbiDecodingZeroDataError' || /Cannot decode zero data/i.test(msg)) {
      easAddress = ZERO_ADDRESS
    } else {
      throw getEasErr
    }
  }

  // We send setEas and multiPublish using the smart wallet (in-app) account.
  // This assumes the contract allows the smart account as tx sender for these calls.
  // If the contract only allows an EOA owner, revisit: fall back to EOA connection or update the contract.
  if ( easAddress === ZERO_ADDRESS ) {
    if (!EAS_CONTRACT_ADDRESS) {
      throw new Error('EAS contract address is not set. Add VITE_EAS_CONTRACT_ADDRESS to your .env file for publishing with this wallet.')
    }
    const tx = setEas({
      contract: smartWalletContract,
      eas: EAS_CONTRACT_ADDRESS,
    },)

    const result = await sendTransaction({
      account,
      transaction: tx,
    },)

    const receipt = await waitForReceipt({
      client,
      chain: optimismSepolia,
      transactionHash: result.transactionHash,
    },)

    if ( !receipt ) {
      throw new Error('Failed to set EAS address',)
    }
  }

  await ensureEasSchemasForItem(item, account, client, optimismSepolia)

  const uploadDataWithTxIds: Array<PublishUpload & { txId: string }> = []

  for (const arweaveTransaction of arweaveTransactions) {
    const upload = publishUploads.find((upload) => (
      upload.versionLocalId === arweaveTransaction.versionId &&
      upload.itemPropertyName === arweaveTransaction.modelName
    ),)
    if (upload) {
      uploadDataWithTxIds.push({
        ...upload,
        txId: arweaveTransaction.transaction.id,
      },)
    }
  }

  const requestData = await item.getPublishPayload(uploadDataWithTxIds)

  // Normalize bytes32 fields to 0x-prefixed 32-byte (64 hex char) strings so ABI encoding accepts them.
  const BYTES32_LEN = 64
  const toHex32 = (v: unknown): string => {
    if (v == null) return '0x' + '0'.repeat(BYTES32_LEN)
    if (typeof v === 'string') {
      const raw = v.startsWith('0x') ? v.slice(2) : v
      const hex = raw.replace(/[^0-9a-fA-F]/g, '0').padStart(BYTES32_LEN, '0').slice(-BYTES32_LEN)
      return '0x' + hex
    }
    if (v instanceof Uint8Array || (typeof ArrayBuffer !== 'undefined' && v instanceof ArrayBuffer)) {
      const arr = v instanceof Uint8Array ? v : new Uint8Array(v)
      const hex = Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('')
      return '0x' + hex.padStart(BYTES32_LEN, '0').slice(-BYTES32_LEN)
    }
    return '0x' + '0'.repeat(BYTES32_LEN)
  }
  const toBytesHex = (v: unknown): string => {
    if (v == null || (typeof v === 'string' && (v === '' || v === '0x'))) return '0x'
    if (typeof v === 'string') {
      const raw = v.startsWith('0x') ? v.slice(2) : v
      const hex = raw.replace(/[^0-9a-fA-F]/g, '0')
      return '0x' + (hex.length % 2 === 1 ? '0' + hex : hex)
    }
    if (v instanceof Uint8Array || (typeof ArrayBuffer !== 'undefined' && v instanceof ArrayBuffer)) {
      const arr = v instanceof Uint8Array ? v : new Uint8Array(v)
      return '0x' + Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('')
    }
    return '0x'
  }
  const reqs = Array.isArray(requestData) ? requestData : [requestData]
  const normalizedRequests = reqs.map((req: any) => {
    const listOfAttestations = (req?.listOfAttestations ?? []).map((att: any) => {
      const dataArr = Array.isArray(att?.data) ? att.data : (att?.data != null && typeof att?.data === 'object' ? [att.data] : [])
      return {
      ...att,
      schema: toHex32(att?.schema),
      data: dataArr.map((d: any) => ({
        ...d,
        refUID: toHex32(d?.refUID),
        data: toBytesHex(d?.data),
      })),
    }
    })
    const propertiesToUpdate = (req?.propertiesToUpdate ?? []).map((p: any) => ({
      ...p,
      propertySchemaUid: toHex32(p?.propertySchemaUid),
    }))
    return {
      ...req,
      seedUid: toHex32(req?.seedUid),
      seedSchemaUid: toHex32(req?.seedSchemaUid),
      versionUid: toHex32(req?.versionUid),
      versionSchemaUid: toHex32(req?.versionSchemaUid),
      listOfAttestations,
      propertiesToUpdate,
    }
  })
  const payloadForContract = Array.isArray(requestData) ? normalizedRequests : normalizedRequests[0]

  const requestDataString = JSON.stringify(requestData, ( key, value, ) =>
    typeof value === 'bigint' ? value.toString() : value,
  )
  await writeAppState(`publishRequestData_${item.seedLocalId}_${Date.now()}`, requestDataString,)

  const tx = multiPublish({
    contract: smartWalletContract,
    requests: payloadForContract,
  },)

  // TODO: Save this tx in appState so we can recover it later if necessary

  const result = await sendTransaction({
    account,
    transaction: tx,
  },)

  const receipt = await waitForReceipt({
    client,
    chain: optimismSepolia,
    transactionHash: result.transactionHash,
  },)
  if ( !receipt ) {
    throw new Error('Failed to send transaction',)
  }
  // await writeAppState(`publishTx_${item.seedLocalId}_${Date.now()}`, JSON.stringify(tx,),)

  const firstRequest = normalizedRequests[0]
  const firstRequestSeedUid = firstRequest?.seedUid
  const hadZeroSeedUid = firstRequestSeedUid === ZERO_BYTES32 || !firstRequestSeedUid
  const listOfAttestationsCount = firstRequest?.listOfAttestations?.length ?? 0
  const seedSchemaUid = firstRequest?.seedSchemaUid
  const seedUidFromTx = hadZeroSeedUid
    ? (seedUidFromCreatedAttestationEvents(receipt, seedSchemaUid) ??
       seedUidFromSeedPublished(receipt, address, listOfAttestationsCount))
    : undefined
  const effectiveRequests =
    seedUidFromTx && normalizedRequests.length > 0
      ? [{ ...normalizedRequests[0], seedUid: seedUidFromTx }, ...normalizedRequests.slice(1) ]
      : normalizedRequests
  persistSeedUidFromPublishResult(item as { seedUid?: string }, effectiveRequests)
  // Persist seedUid to the SDK's DB (seeds table) so useItems/useItem show it in the UI
  const itemWithPersist = item as { persistSeedUid?: () => Promise<void> }
  if (effectiveRequests[0]?.seedUid && typeof itemWithPersist.persistSeedUid === 'function') {
    await itemWithPersist.persistSeedUid()
  }

  // TODO: Get rid of the publishProcess and clean up any remaining state
  // TODO: Write tests that can ensure that the publish process is working properly
  // TODO: Perhaps as part of the tests, figure out how/why versions are getting their own versions
  // TODO: Implement protected pages based on whether Metamask is connected

  logger('result', result,)

  logger('requestData', requestData,)

  return

},)
