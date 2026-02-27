import { ActorRefFrom, EventObject, fromCallback, fromPromise, } from 'xstate'
import type { ArweaveTransactionInfo, PublishMachineContext } from '../../types'
import {
  ZERO_ADDRESS,
} from '@ethereum-attestation-service/eas-sdk'
import { encode, getContract, parseEventLogs, readContract, sendTransaction, waitForReceipt, } from 'thirdweb'
import {
  optimismSepolia,
} from 'thirdweb/chains'
import { getClient, getManagedAccountWallet, getModularAccountWallet } from '~/helpers/thirdweb'
import {
  createdAttestationEvent,
  execute,
  factory,
  getEas,
  multiPublish,
  multiPublishWithIntegerIds,
  type MultiPublishWithIntegerIdsParams,
  seedPublishedEvent,
  setEas,
} from '~/helpers/thirdweb/11155420/0xcd8c945872df8e664e55cf8885c85ea3ea8f2148'
import {
  multiPublish as executorMultiPublish,
  createdAttestationEvent as executorCreatedAttestationEvent,
  seedPublishedEvent as executorSeedPublishedEvent,
} from '~/helpers/thirdweb/11155420/0x043462304114da543add6b693c686b7d98865f3e'
import { decodeAbiParameters, encodeAbiParameters, } from 'viem'
import { publishMachine, } from './index'
// import { getModelInstance, getPublishAttempt, } from '~/helpers'
import Transaction from 'arweave/web/lib/transaction'
import type { ReimbursementResponse } from '../upload'
import { Item } from '@seedprotocol/sdk'
import type { PublishUpload } from '../../types'
import { persistSeedUidFromPublishResult } from './actors/persistSeedUid'
import { ensureEasSchemasForItem } from './helpers/ensureEasSchemas'
import { getArweave } from '~/helpers/blockchain'
import { getPublishConfig } from '~/config'
import { transformPayloadForExecutor, transformPayloadToIntegerIds } from '~/helpers/transformPayloadToIntegerIds'
import { postUploadArweaveStart, uploadNetworkErrorMessage, uploadServerErrorMessage } from '~/helpers/uploadApi'
import debug from 'debug'
import { getInstalledModules, installModule } from 'thirdweb/modules'
import { EAS_CONTRACT_ADDRESS, THIRDWEB_ACCOUNT_FACTORY_ADDRESS } from '~/helpers/constants'
import { inAppWallet } from 'thirdweb/wallets'


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
  useModularExecutor: boolean,
): string | undefined {
  if (!seedSchemaUid || !receipt.logs?.length) return undefined
  const wantSchema = toHex32Normalized(seedSchemaUid)
  if (wantSchema === ZERO_BYTES32) return undefined
  const createdAttestationEvt = useModularExecutor ? executorCreatedAttestationEvent : createdAttestationEvent
  try {
    const parsed = parseEventLogs({
      logs: receipt.logs as import('viem').Log[],
      events: [createdAttestationEvt()],
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
 * Fallback: extract seed UID from SeedPublished when CreatedAttestation events are not
 * available or don't match.
 * Extension: SeedPublished(bytes returnedDataFromEAS) - decode bytes as bytes32[], use index.
 * Executor: SeedPublished(bytes32 seedUid, bytes32 versionUid) - read args.seedUid directly.
 */
function seedUidFromSeedPublished(
  receipt: { logs?: Array<{ address?: string; data?: string; topics?: unknown[] }> },
  contractAddress: string,
  listOfAttestationsCount: number,
  useModularExecutor: boolean,
): string | undefined {
  const want = contractAddress.toLowerCase()
  const logs = receipt.logs?.filter(
    (l) => l.address && l.address.toLowerCase() === want,
  )
  if (!logs?.length) return undefined
  try {
    const seedPublishedEvt = useModularExecutor ? executorSeedPublishedEvent : seedPublishedEvent
    const parsed = parseEventLogs({
      logs: logs as import('viem').Log[],
      events: [seedPublishedEvt()],
      strict: false,
    })
    const first = parsed[0]
    if (!first) return undefined
    if (useModularExecutor) {
      const args = first.args as { seedUid?: string }
      const seedUid = args?.seedUid
      return seedUid && toHex32Normalized(seedUid) !== ZERO_BYTES32 ? seedUid : undefined
    }
    const args = first.args as { returnedDataFromEAS?: `0x${string}` }
    const data = args?.returnedDataFromEAS
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


const waitForItem = async (seedLocalId: string): Promise<InstanceType<typeof Item>> => {
  let item: InstanceType<typeof Item> | undefined

  try {
    item = await Item.find({ seedLocalId } as Parameters<typeof Item.find>[0])
  } catch {
    // No-op: Error is intentionally ignored
  }

  if (item) {
    return item
  }

  return new Promise<InstanceType<typeof Item>>((resolve) => {
    const interval = setInterval(() => {
      try {
        Item.find({ seedLocalId } as Parameters<typeof Item.find>[0])
          .then((found: InstanceType<typeof Item> | undefined) => {
            if (found) {
              clearInterval(interval)
              resolve(found)
            }
          })
      } catch {
        // No-op: Error is intentionally ignored
      }
    }, 200)
  })
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

function deserializeChunks(serialized: unknown): { data_root: Uint8Array; chunks: Array<{ dataHash: Uint8Array; minByteRange: number; maxByteRange: number }>; proofs: Array<{ offset: number; proof: Uint8Array }> } | undefined {
  if (!serialized || typeof serialized !== 'object') return undefined
  const s = serialized as { data_root?: number[]; chunks?: Array<{ dataHash: number[]; minByteRange: number; maxByteRange: number }>; proofs?: Array<{ offset: number; proof: number[] }> }
  if (!Array.isArray(s.data_root)) return undefined
  return {
    data_root: new Uint8Array(s.data_root),
    chunks: (s.chunks ?? []).map((c) => ({ ...c, dataHash: new Uint8Array(c.dataHash ?? []) })),
    proofs: (s.proofs ?? []).map((p) => ({ ...p, proof: new Uint8Array(p.proof ?? []) })),
  }
}

type PublishInput = { input: { context: PublishMachineContext; event: unknown } }

export const createArweaveTransactions = fromPromise(async ({
  input: { context, event },
}: PublishInput): Promise<CreateArweaveTransactionsResult> => {
  let { item } = context

  if (!item.getPublishUploads) {
    item = await waitForItem(item.seedLocalId)
  }

  const publishUploads = await item.getPublishUploads()

  const win = typeof window !== 'undefined' ? (window as Window & { Main?: { createAndSignArweaveTransactions?: (uploads: unknown[]) => Promise<unknown[]> } }) : null
  if (!win?.Main?.createAndSignArweaveTransactions) {
    throw new Error('Arweave signing not available')
  }

  const uploads = publishUploads.map((u: PublishUpload) => ({
    versionLocalId: u.versionLocalId,
    itemPropertyName: u.itemPropertyName,
    transactionJson: (u.transactionToSign as Transaction).toJSON(),
  }))

  const results = await win.Main.createAndSignArweaveTransactions(uploads)

  const arweave = getArweave()
  const arweaveTransactions: ArweaveTransactionInfo[] = (results as Array<{ transaction: Record<string, unknown>; versionId?: string; modelName?: string }>).map((r) => {
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
},)

export const sendReimbursementRequest = fromPromise(async ({
  input: { context, event },
}: PublishInput): Promise<ReimbursementResponse> => {


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
    const chunksBlob = new Blob([ JSON.stringify(chunks,), ], {type: 'application/json',},)
    formData.append(`${transaction.id}-chunks`, chunksBlob, `${transaction.id}-chunks`,)
    const jsonBlob = new Blob([ JSON.stringify(json,), ], {type: 'application/json',},)
    formData.append(`${transaction.id}-json`, jsonBlob, `${transaction.id}-json`,)
  }

  // TODO: What if this fails but a successful one has already gone through? We don't want to crash the app

  const { uploadApiBaseUrl } = getPublishConfig()
  const url = `${uploadApiBaseUrl}/api/upload/arweave/start`
  const { status, body, message: serverMessage } = await postUploadArweaveStart(url, formData, uploadApiBaseUrl)

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

export const pollForConfirmation = fromPromise(async ({ input: { context, event } }: PublishInput): Promise<void> => {

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

export const uploadData = fromCallback<EventObject, { context: PublishMachineContext }>(({
  sendBack,
  input,
}) => {
  const arweaveTransactions = input.context.arweaveTransactions ?? []
  const transactions = arweaveTransactions.map(({ transaction }: ArweaveTransactionInfo) => transaction)
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

export const createAttestations = fromPromise(async ({ input: { context, event } }: PublishInput): Promise<void> => {
  const { address, account } = context
  const arweaveTransactions = context.arweaveTransactions ?? []
  const publishUploads = context.publishUploads ?? []
  let { item } = context

  const { modularAccountModuleContract, useIntegerLocalIds, useModularExecutor } = getPublishConfig()

  if (!address || typeof address !== 'string' || !address.trim()) {
    throw new Error('No wallet address for publish. Connect a wallet and try again.')
  }

  if (!account) {
    throw new Error('Wallet session is missing. Reconnect your wallet and retry the publish.')
  }

  if (!item?.seedLocalId) {
    throw new Error('Attestation recovery failed: Item data is missing. Delete this publish record and try a full publish from the beginning.')
  }
  if (typeof item.getPublishUploads !== 'function') {
    item = await waitForItem(item.seedLocalId)
  }

  const txCount = arweaveTransactions.length
  const uploadCount = publishUploads.length
  if (txCount !== uploadCount) {
    throw new Error(
      'Attestation recovery failed: Arweave transaction data is missing or incomplete. Delete this publish record and try a full publish from the beginning.'
    )
  }

  const smartWalletContract = getContract({
    client: getClient(),
    chain: optimismSepolia,
    address,
  },)

  let targetContract = useModularExecutor && modularAccountModuleContract
    ? getContract({
        client: getClient(),
        chain: optimismSepolia,
        address: modularAccountModuleContract,
      })
    : smartWalletContract

  // if (!useModularExecutor) {
  //   let easAddress: string
  //   try {
  //     easAddress = await getEas({
  //       contract: smartWalletContract,
  //     },) as string
  //   } catch (getEasErr: unknown) {
  //     const err = getEasErr instanceof Error ? getEasErr : new Error(String(getEasErr))
  //     const msg = err.message
  //     // Contract returned "0x" (e.g. EOA or not deployed). Treat as EAS not set so we attempt setEas; if address has no code, sendTransaction will fail with a clear error.
  //     if (err.name === 'AbiDecodingZeroDataError' || /Cannot decode zero data/i.test(msg)) {
  //       easAddress = ZERO_ADDRESS
  //     } else {
  //       throw getEasErr
  //     }
  //   }

  //   // We send setEas and multiPublish using the smart wallet (in-app) account.
  //   // This assumes the contract allows the smart account as tx sender for these calls.
  //   // If the contract only allows an EOA owner, revisit: fall back to EOA connection or update the contract.
  //   if ( easAddress === ZERO_ADDRESS ) {
  //     const { easContractAddress } = getPublishConfig()
  //     const tx = setEas({
  //       contract: smartWalletContract,
  //       eas: easContractAddress,
  //     },)

  //     try {
  //       const result = await sendTransaction({
  //         account,
  //         transaction: tx,
  //       },)

  //       const receipt = await waitForReceipt({
  //         client: getClient(),
  //         chain: optimismSepolia,
  //         transactionHash: result.transactionHash,
  //       },)

  //       if ( !receipt ) {
  //         throw new Error('Failed to set EAS address',)
  //       }

  //       // Verify getEas returns expected value after setEas
  //       try {
  //         await getEas({ contract: smartWalletContract }) as string
  //       } catch { /* noop */ }
  //     } catch (setEasErr: unknown) {
  //       throw setEasErr
  //     }
  //   }
  // }

  await ensureEasSchemasForItem(item, account, getClient(), optimismSepolia)

  // Match by index: createAndSignArweaveTransactions returns results in the same order as publishUploads.
  // Index matching is more reliable than versionLocalId+itemPropertyName, which can fail for storage seeds
  // (e.g. when versionLocalId comes from the parent's property and doesn't uniquely identify the upload).
  // After JSON round-trip (restore), transaction may be a plain object; ensure we read id safely.
  const uploadDataWithTxIds: Array<PublishUpload & { txId: string }> = arweaveTransactions.map((arweaveTransaction: ArweaveTransactionInfo, i: number) => {
    const tx = arweaveTransaction.transaction as { id?: string }
    const txId = tx?.id
    if (!txId || typeof txId !== 'string') {
      throw new Error(
        'Attestation recovery failed: Arweave transaction data did not survive restore. Delete this publish record and try a full publish from the beginning.'
      )
    }
    const upload = publishUploads[i] as PublishUpload | undefined
    if (!upload) throw new Error('Publish upload index mismatch')
    return { ...upload, txId }
  })

  const requestData = await item.getPublishPayload(uploadDataWithTxIds)

  const rawReqs = Array.isArray(requestData) ? requestData : [requestData]

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
      const dataArr = Array.isArray(att?.data) ? att.data : []
      return {
      schema: toHex32(att?.schema),
      data: dataArr.map((d: any) => ({
        ...d,
        refUID: toHex32(d?.refUID),
        data: toBytesHex(d?.data),
        expirationTime: d?.expirationTime != null ? BigInt(d.expirationTime) : BigInt(0),
        value: d?.value != null ? BigInt(d.value) : BigInt(0),
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

  // Defensive: ensure attestations referenced in propertiesToUpdate have at least one data element.
  // The contract writes the seed UID into data[0].data; empty data causes Panic 50.
  const byLocalId = new Map(normalizedRequests.map((r: any) => [r?.localId, r]))
  const placeholderData = {
    recipient: ZERO_ADDRESS,
    expirationTime: BigInt(0),
    revocable: true,
    refUID: ZERO_BYTES32,
    data: ZERO_BYTES32 as `0x${string}`,
    value: BigInt(0),
  }
  for (const req of normalizedRequests) {
    for (const pu of req?.propertiesToUpdate ?? []) {
      const targetId = pu?.publishLocalId
      const schemaUid = toHex32(pu?.propertySchemaUid)
      if (!targetId || !schemaUid) continue
      const targetReq = byLocalId.get(targetId)
      if (!targetReq?.listOfAttestations) continue
      const att = targetReq.listOfAttestations.find(
        (a: any) => toHex32(a?.schema)?.toLowerCase() === schemaUid?.toLowerCase(),
      )
      if (!att) continue
      if (!Array.isArray(att.data) || att.data.length === 0) {
        att.data = [{ ...placeholderData, refUID: ZERO_BYTES32 }]
      }
    }
  }

  const payloadForContract = Array.isArray(requestData) ? normalizedRequests : [normalizedRequests[0]]

  const executorPayload = useModularExecutor
    ? transformPayloadForExecutor(payloadForContract)
    : payloadForContract

  let managedAccountAddress: string | undefined
  let activeAccount = account

  if (useModularExecutor) {
    const managedAccountWallet = getManagedAccountWallet()
    await managedAccountWallet.autoConnect({client: getClient(), chain: optimismSepolia})
    const managedAccount = managedAccountWallet.getAccount()
    if (!managedAccount) {
      throw new Error('Failed to get managed account')
    }
    managedAccountAddress = managedAccount.address
    targetContract = getContract({
      client: getClient(),
      chain: optimismSepolia,
      address: managedAccountAddress,
    })
    const modularAccountWallet = getModularAccountWallet()
    await modularAccountWallet.autoConnect({client: getClient(), chain: optimismSepolia})
    const modularAccount = modularAccountWallet.getAccount()
    if (!modularAccount) {
      throw new Error('Failed to get modular account')
    }
    activeAccount = modularAccount
  }

  const tx = {
    ...multiPublish({
      contract: targetContract,
      requests: payloadForContract,
    }),
    gas: 5_000_000n,
  }

  // const tx = useModularExecutor
  //   ? (async () => {
  //       const multiPublishTx = executorMultiPublish({
  //         contract: targetContract,
  //         requests: executorPayload,
  //       })
  //       const calldata = await encode(multiPublishTx)
  //       return {
  //         ...execute({
  //           contract: smartWalletContract,
  //           target: modularAccountModuleContract!,
  //           value: 0n,
  //           calldata,
  //         }),
  //         gas: 5_000_000n,
  //       }
  //     })()
  //   : useIntegerLocalIds
  //     ? {
  //         ...multiPublishWithIntegerIds({
  //           contract: targetContract,
  //           requests: transformPayloadToIntegerIds(payloadForContract) as MultiPublishWithIntegerIdsParams['requests'],
  //         }),
  //         gas: 5_000_000n,
  //       }
  //     : {
  //         ...multiPublish({
  //           contract: targetContract,
  //           requests: payloadForContract,
  //         }),
  //         gas: 5_000_000n,
  //       }

  // TODO: Save this tx in appState so we can recover it later if necessary

  const txToSend = await Promise.resolve(tx)

  let result: { transactionHash: `0x${string}` }
  try {
    result = await sendTransaction({
      account: activeAccount,
      transaction: txToSend,
    },)
  } catch (sendErr: unknown) {
    throw sendErr
  }

  const receipt = await waitForReceipt({
    client: getClient(),
    chain: optimismSepolia,
    transactionHash: result.transactionHash,
  },)
  if ( !receipt ) {
    throw new Error('Failed to send transaction',)
  }

  const firstRequest = normalizedRequests[0]
  const firstRequestSeedUid = firstRequest?.seedUid
  const hadZeroSeedUid = firstRequestSeedUid === ZERO_BYTES32 || !firstRequestSeedUid
  const listOfAttestationsCount = firstRequest?.listOfAttestations?.length ?? 0
  const seedSchemaUid = firstRequest?.seedSchemaUid
  const contractAddressForEvents = useModularExecutor && modularAccountModuleContract
    ? modularAccountModuleContract
    : address
  const seedUidFromTx = hadZeroSeedUid
    ? (seedUidFromCreatedAttestationEvents(receipt, seedSchemaUid, useModularExecutor) ??
       seedUidFromSeedPublished(receipt, contractAddressForEvents, listOfAttestationsCount, useModularExecutor))
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
