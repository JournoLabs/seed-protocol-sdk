import { fromPromise } from 'xstate'
import type { PublishMachineContext } from '../../../types'
import type { ArweaveTransactionInfo } from '../../../types'
import type { PublishUpload } from '../../../types'
import { ZERO_ADDRESS } from '@ethereum-attestation-service/eas-sdk'
import { getContract, sendTransaction, waitForReceipt } from 'thirdweb'
import { optimismSepolia } from 'thirdweb/chains'
import { getClient, getConnectedManagedAccountAddress, getModularAccountWallet } from '~/helpers/thirdweb'
import { multiPublish } from '~/helpers/thirdweb/11155420/0xcd8c945872df8e664e55cf8885c85ea3ea8f2148'
import { persistSeedUidFromPublishResult, persistSeedUidSafely } from './persistSeedUid'
import { ensureEasSchemasForItem } from '../helpers/ensureEasSchemas'
import { verifyArweaveTransactionsExist } from '../helpers/verifyArweaveTransactionsExist'
import { getPublishConfig } from '~/config'
import { waitForItem } from './utils'
import { ZERO_BYTES32 } from './utils'
import { seedUidFromCreatedAttestationEvents, seedUidFromSeedPublished } from './seedUidHelpers'
import debug from 'debug'

const logger = debug('seedProtocol:services:publish:actors')

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

type PublishInput = { input: { context: PublishMachineContext; event: unknown } }

export const createAttestations = fromPromise(
  async ({ input: { context, event } }: PublishInput): Promise<{ easPayload: unknown }> => {
    const { address, account } = context
    const arweaveTransactions = context.arweaveTransactions ?? []
    const publishUploads = context.publishUploads ?? []
    let { item } = context

    const { modularAccountModuleContract, useModularExecutor } = getPublishConfig()

    if (!address || typeof address !== 'string' || !address.trim()) {
      throw new Error('No wallet address for publish. Connect a wallet and try again.')
    }

    if (!account) {
      throw new Error('Wallet session is missing. Reconnect your wallet and retry the publish.')
    }

    if (!item?.seedLocalId) {
      throw new Error(
        'Attestation recovery failed: Item data is missing. Delete this publish record and try a full publish from the beginning.'
      )
    }
    const waitForItemUsed = typeof item.getPublishUploads !== 'function'
    if (waitForItemUsed) {
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
    })

    let targetContract =
      useModularExecutor && modularAccountModuleContract
        ? getContract({
            client: getClient(),
            chain: optimismSepolia,
            address: modularAccountModuleContract,
          })
        : smartWalletContract

    await ensureEasSchemasForItem(item, account, getClient(), optimismSepolia)

    const uploadDataWithTxIds: Array<PublishUpload & { txId: string }> = arweaveTransactions.map(
      (arweaveTransaction: ArweaveTransactionInfo, i: number) => {
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
      }
    )

    await verifyArweaveTransactionsExist(uploadDataWithTxIds.map((u) => u.txId))

    let requestData: unknown
    try {
      requestData = await item.getPublishPayload(uploadDataWithTxIds)
    } catch (getPayloadErr) {
      throw getPayloadErr
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
          (a: any) => toHex32(a?.schema)?.toLowerCase() === schemaUid?.toLowerCase()
        )
        if (!att) continue
        if (!Array.isArray(att.data) || att.data.length === 0) {
          att.data = [{ ...placeholderData, refUID: ZERO_BYTES32 }]
        }
      }
    }

    const payloadForContract = Array.isArray(requestData) ? normalizedRequests : [normalizedRequests[0]]

    let managedAccountAddress: string | undefined
    let activeAccount = account

    if (useModularExecutor) {
      managedAccountAddress = await getConnectedManagedAccountAddress(optimismSepolia)
      targetContract = getContract({
        client: getClient(),
        chain: optimismSepolia,
        address: managedAccountAddress,
      })
      const modularAccountWallet = getModularAccountWallet()
      await modularAccountWallet.autoConnect({ client: getClient(), chain: optimismSepolia })
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

    const txToSend = await Promise.resolve(tx)

    let result: { transactionHash: `0x${string}` }
    try {
      result = await sendTransaction({
        account: activeAccount,
        transaction: txToSend,
      })
    } catch (sendErr: unknown) {
      throw sendErr
    }

    const receipt = await waitForReceipt({
      client: getClient(),
      chain: optimismSepolia,
      transactionHash: result.transactionHash,
    })
    if (!receipt) {
      throw new Error('Failed to send transaction')
    }

    const firstRequest = normalizedRequests[0]
    const firstRequestSeedUid = firstRequest?.seedUid
    const hadZeroSeedUid = firstRequestSeedUid === ZERO_BYTES32 || !firstRequestSeedUid
    const listOfAttestationsCount = firstRequest?.listOfAttestations?.length ?? 0
    const seedSchemaUid = firstRequest?.seedSchemaUid
    const contractAddressForEvents =
      useModularExecutor && modularAccountModuleContract ? modularAccountModuleContract : address
    const seedUidFromTx = hadZeroSeedUid
      ? (seedUidFromCreatedAttestationEvents(receipt, seedSchemaUid, useModularExecutor) ??
         seedUidFromSeedPublished(
           receipt,
           contractAddressForEvents,
           listOfAttestationsCount,
           useModularExecutor
         ))
      : undefined
    const effectiveRequests =
      seedUidFromTx && normalizedRequests.length > 0
        ? [{ ...normalizedRequests[0], seedUid: seedUidFromTx }, ...normalizedRequests.slice(1)]
        : normalizedRequests
    persistSeedUidFromPublishResult(item as { seedUid?: string }, effectiveRequests)
    const itemWithPersist = item as { persistSeedUid?: (publisher?: string) => Promise<void> }
    if (effectiveRequests[0]?.seedUid) {
      await persistSeedUidSafely(itemWithPersist, address)
    }

    logger('result', result)
    logger('requestData', requestData)

    return { easPayload: requestData }
  }
)
