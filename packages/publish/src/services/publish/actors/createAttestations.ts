import { fromPromise } from 'xstate'
import type { PublishMachineContext } from '../../../types'
import type { ArweaveTransactionInfo } from '../../../types'
import type { PublishUpload } from '../../../types'
import { resolvePublishPayloadValues } from '@seedprotocol/sdk'
import { getContract, sendTransaction, waitForReceipt } from 'thirdweb'
import { optimismSepolia } from 'thirdweb/chains'
import { getClient, getModularAccountWallet } from '~/helpers/thirdweb'
import { runModularExecutorPublishPrep } from '~/helpers/ensureManagedAccountReady'
import { multiPublish } from '~/helpers/thirdweb/11155420/0xcd8c945872df8e664e55cf8885c85ea3ea8f2148'
import { persistSeedUidFromPublishResult, persistSeedUidSafely } from './persistSeedUid'
import { ensureEasSchemasForItem } from '../helpers/ensureEasSchemas'
import { verifyArweaveTransactionsExist } from '../helpers/verifyArweaveTransactionsExist'
import { getPublishConfig } from '~/config'
import { SEED_PROTOCOL_CONTRACT_ADDRESS_OP_SEPOLIA } from '~/helpers/constants'
import { waitForItem } from './utils'
import { ZERO_BYTES32 } from './utils'
import { seedUidFromCreatedAttestationEvents, seedUidFromSeedPublished } from './seedUidHelpers'
import {
  normalizePublishRequest,
  applyPropertiesToUpdatePlaceholders,
  hasCrossPayloadUnresolved,
  filterPropertiesToUpdateForBatch,
  toHex32,
} from './publishRequestNormalize'
import { enqueueArweaveL1FinalizeJobsFromPublishContext } from '../../arweaveL1Finalize/enqueue'
import debug from 'debug'

const logger = debug('seedProtocol:services:publish:actors')

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
        'Attestation recovery failed: Item data is missing. Delete this publish record and try a full publish from the beginning.',
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
        'Attestation recovery failed: Arweave transaction data is missing or incomplete. Delete this publish record and try a full publish from the beginning.',
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
            'Attestation recovery failed: Arweave transaction data did not survive restore. Delete this publish record and try a full publish from the beginning.',
          )
        }
        const upload = publishUploads[i] as PublishUpload | undefined
        if (!upload) throw new Error('Publish upload index mismatch')
        return { ...upload, txId }
      },
    )

    await verifyArweaveTransactionsExist(uploadDataWithTxIds.map((u) => u.txId))

    let requestData: unknown
    try {
      requestData = await (
        item.getPublishPayload as (
          uploads: typeof uploadDataWithTxIds,
          opts?: { publishMode?: 'patch' | 'new_version' },
        ) => ReturnType<typeof item.getPublishPayload>
      )(uploadDataWithTxIds, { publishMode: context.publishMode ?? 'patch' })
    } catch (getPayloadErr) {
      throw getPayloadErr
    }

    const reqs = Array.isArray(requestData) ? requestData : [requestData]

    let activeAccount = account

    if (useModularExecutor) {
      const prep = await runModularExecutorPublishPrep()
      if (!prep.ok) {
        throw prep.error
      }
      targetContract = getContract({
        client: getClient(),
        chain: optimismSepolia,
        address: SEED_PROTOCOL_CONTRACT_ADDRESS_OP_SEPOLIA,
      })
      const modularAccountWallet = getModularAccountWallet()
      await modularAccountWallet.autoConnect({ client: getClient(), chain: optimismSepolia })
      const modularAccount = modularAccountWallet.getAccount()
      if (!modularAccount) {
        throw new Error('Failed to get modular account')
      }
      activeAccount = modularAccount
    }

    const contractAddressForEvents = useModularExecutor
      ? SEED_PROTOCOL_CONTRACT_ADDRESS_OP_SEPOLIA
      : address

    const needsSequential = reqs.length > 1 && hasCrossPayloadUnresolved(reqs)

    let effectiveRequests: any[]

    if (needsSequential) {
      let workingPayload = structuredClone(reqs) as any[]
      const resolvedUids: Record<string, string> = {}

      for (let i = 0; i < workingPayload.length; i++) {
        workingPayload = await resolvePublishPayloadValues(workingPayload as any, resolvedUids)
        const rawReq = workingPayload[i]
        const batchLocalIds = new Set([rawReq.localId])
        const reqForPublish = {
          ...rawReq,
          propertiesToUpdate: filterPropertiesToUpdateForBatch(rawReq.propertiesToUpdate, batchLocalIds),
        }
        const normalizedOne = normalizePublishRequest(reqForPublish)
        const byLocalIdSingle = new Map([[normalizedOne.localId, normalizedOne]])
        applyPropertiesToUpdatePlaceholders([normalizedOne], byLocalIdSingle)

        const tx = {
          ...multiPublish({
            contract: targetContract,
            requests: [normalizedOne],
          }),
          gas: 5_000_000n,
        }

        const result = await sendTransaction({
          account: activeAccount,
          transaction: await Promise.resolve(tx),
        })

        const receipt = await waitForReceipt({
          client: getClient(),
          chain: optimismSepolia,
          transactionHash: result.transactionHash,
        })
        if (!receipt) {
          throw new Error('Failed to send transaction')
        }

        const hadZeroSeedUid =
          !normalizedOne.seedUid || toHex32(normalizedOne.seedUid) === ZERO_BYTES32
        const listOfAttestationsCount = normalizedOne?.listOfAttestations?.length ?? 0
        const seedSchemaUid = normalizedOne?.seedSchemaUid
        if (hadZeroSeedUid) {
          const seedUidFromTx =
            seedUidFromCreatedAttestationEvents(receipt, seedSchemaUid, useModularExecutor) ??
            seedUidFromSeedPublished(
              receipt,
              contractAddressForEvents,
              listOfAttestationsCount,
              useModularExecutor,
            )
          if (seedUidFromTx) {
            resolvedUids[rawReq.localId] = seedUidFromTx
            workingPayload[i] = { ...workingPayload[i], seedUid: seedUidFromTx }
          }
        }
      }

      for (const p of workingPayload) {
        const id = p?.localId
        const su = p?.seedUid
        if (id && su && toHex32(su) !== ZERO_BYTES32) {
          resolvedUids[id] = toHex32(su)
        }
      }

      const fullyResolved = await resolvePublishPayloadValues(structuredClone(reqs), resolvedUids)
      effectiveRequests = fullyResolved.map((r: any) =>
        normalizePublishRequest({
          ...r,
          seedUid: resolvedUids[r.localId] ?? r.seedUid,
        }),
      )
    } else {
      const normalizedRequests = reqs.map((req: any) => normalizePublishRequest(req))

      const byLocalId = new Map(normalizedRequests.map((r: any) => [r?.localId, r]))
      applyPropertiesToUpdatePlaceholders(normalizedRequests, byLocalId)

      const payloadForContract = Array.isArray(requestData) ? normalizedRequests : [normalizedRequests[0]]

      const tx = {
        ...multiPublish({
          contract: targetContract,
          requests: payloadForContract,
        }),
        gas: 5_000_000n,
      }

      const result = await sendTransaction({
        account: activeAccount,
        transaction: await Promise.resolve(tx),
      })

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
      const seedUidFromTx = hadZeroSeedUid
        ? (seedUidFromCreatedAttestationEvents(receipt, seedSchemaUid, useModularExecutor) ??
          seedUidFromSeedPublished(
            receipt,
            contractAddressForEvents,
            listOfAttestationsCount,
            useModularExecutor,
          ))
        : undefined
      effectiveRequests =
        seedUidFromTx && normalizedRequests.length > 0
          ? [{ ...normalizedRequests[0], seedUid: seedUidFromTx }, ...normalizedRequests.slice(1)]
          : normalizedRequests
    }

    persistSeedUidFromPublishResult(item as { seedUid?: string; seedLocalId?: string }, effectiveRequests)
    const itemWithPersist = item as { persistSeedUid?: (publisher?: string) => Promise<void> }
    const rootRequest = effectiveRequests.find((r) => r?.localId === item.seedLocalId)
    const rootSeedUid = rootRequest?.seedUid
    if (rootSeedUid && rootSeedUid !== ZERO_BYTES32) {
      await persistSeedUidSafely(itemWithPersist, address)
    }

    logger('requestData', requestData)

    void enqueueArweaveL1FinalizeJobsFromPublishContext(context)

    return { easPayload: requestData }
  },
)
