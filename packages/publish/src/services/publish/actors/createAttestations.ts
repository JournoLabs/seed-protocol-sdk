import { fromPromise } from 'xstate'
import type { PublishMachineContext } from '../../../types'
import type { ArweaveTransactionInfo } from '../../../types'
import type { PublishUpload } from '../../../types'
import {
  applyPropertyAttestationUidsFromPublish,
  resolvePublishPayloadValues,
  updateVersionUid,
} from '@seedprotocol/sdk'
import { getContract, sendTransaction, waitForReceipt } from 'thirdweb'
import { optimismSepolia } from 'thirdweb/chains'
import { getClient, getModularAccountWallet, isSmartWalletDeployed } from '~/helpers/thirdweb'
import { runModularExecutorPublishPrep } from '~/helpers/ensureManagedAccountReady'
import {
  multiPublish,
} from '~/helpers/thirdweb/11155420/0xcd8c945872df8e664e55cf8885c85ea3ea8f2148'
import { persistSeedUidFromPublishResult, persistSeedUidSafely } from './persistSeedUid'
import { ensureEasSchemasForItem } from '../helpers/ensureEasSchemas'
import { verifyArweaveTransactionsExist } from '../helpers/verifyArweaveTransactionsExist'
import { getPublishConfig } from '~/config'
import { waitForItem } from './utils'
import { ZERO_BYTES32 } from './utils'
import {
  seedUidFromCreatedAttestationEvents,
  seedUidFromSeedPublished,
  versionUidFromCreatedAttestationEvents,
  uidsFromSeedPublished,
  listCreatedAttestationPairsFromReceipt,
  type CreatedAttestationPair,
} from './seedUidHelpers'
import { attestationMsFromReceipt } from '../helpers/receiptAttestationMs'
import {
  normalizePublishRequest,
  applyPropertiesToUpdatePlaceholders,
  hasCrossPayloadUnresolved,
  filterPropertiesToUpdateForBatch,
  toHex32,
} from './publishRequestNormalize'
import { enqueueArweaveL1FinalizeJobsFromPublishContext } from '../../arweaveL1Finalize/enqueue'
import { ensureEip7702ModularAccountReady } from '~/helpers/ensureEip7702ModularAccountReady'
import { ensureManagedAccountEasConfigured } from '~/helpers/ensureManagedAccountEasConfigured'
import debug from 'debug'

const logger = debug('seedProtocol:services:publish:actors')

type PublishInput = { input: { context: PublishMachineContext; event: unknown } }

type ReceiptLike = {
  blockNumber?: bigint
  logs?: Array<{ address?: string; data?: string; topics?: unknown[] }>
}

type PublishRoutingInput = {
  useModularExecutor: boolean
  publisherAddress: string
  modularAccountModuleContract?: string
  managedAddress?: string
}

type PublishRouting = {
  txTargetAddress: string
  contractAddressForEvents: string
}

export function resolvePublishRouting(input: PublishRoutingInput): PublishRouting {
  const {
    useModularExecutor,
    publisherAddress,
    modularAccountModuleContract,
    managedAddress,
  } = input
  if (useModularExecutor) {
    if (!managedAddress) {
      throw new Error('resolvePublishRouting: managedAddress is required when useModularExecutor is true')
    }
    return {
      txTargetAddress: managedAddress,
      contractAddressForEvents: modularAccountModuleContract || managedAddress,
    }
  }
  return {
    txTargetAddress: publisherAddress,
    contractAddressForEvents: publisherAddress,
  }
}

async function persistVersionUidFromPublishReceipt(params: {
  receipt: ReceiptLike
  seedLocalId: string | undefined
  versionSchemaUid: string | undefined
  contractAddressForEvents: string
  listOfAttestationsCount: number
  useModularExecutor: boolean
  publisherAddress: string
}): Promise<void> {
  const {
    receipt,
    seedLocalId,
    versionSchemaUid,
    contractAddressForEvents,
    listOfAttestationsCount,
    useModularExecutor,
    publisherAddress,
  } = params
  if (!seedLocalId) return
  const raw =
    versionUidFromCreatedAttestationEvents(
      receipt,
      versionSchemaUid,
      useModularExecutor,
    ) ??
    uidsFromSeedPublished(
      receipt,
      contractAddressForEvents,
      listOfAttestationsCount,
      useModularExecutor,
    ).versionUid
  const versionUid = raw ? toHex32(raw) : undefined
  if (!versionUid || versionUid === ZERO_BYTES32) return
  const attMs = await attestationMsFromReceipt(getClient(), optimismSepolia, receipt)
  await updateVersionUid({
    seedLocalId,
    versionUid,
    publisher: publisherAddress,
    attestationCreatedAt: attMs,
  })
}

function schemaMatchesAttestationPair(
  pairSchema: string | undefined,
  requestSchema: string | undefined,
): boolean {
  if (!pairSchema || !requestSchema) return false
  return toHex32(pairSchema).toLowerCase() === toHex32(requestSchema).toLowerCase()
}

function consumeIfSchemaMatches(
  all: CreatedAttestationPair[],
  offset: number,
  schemaUid: string | undefined,
): number {
  if (!schemaUid || offset >= all.length) return offset
  if (schemaMatchesAttestationPair(all[offset]?.schemaUid, schemaUid)) return offset + 1
  return offset
}

/**
 * Walk CreatedAttestation event order (per request: optional seed, version, then property schemas)
 * and persist property attestation UIDs onto metadata rows.
 */
async function persistPropertyMetadataUidsFromContractReceipt(params: {
  receipt: ReceiptLike
  normalizedRequests: any[]
  useModularExecutor: boolean
}): Promise<void> {
  const { receipt, normalizedRequests, useModularExecutor } = params
  const allPairs = listCreatedAttestationPairsFromReceipt(receipt, useModularExecutor)
  if (!allPairs.length) return
  const attMs = await attestationMsFromReceipt(getClient(), optimismSepolia, receipt)
  let offset = 0
  for (const req of normalizedRequests) {
    const list = req.listOfAttestations ?? []
    if (!list.length) continue
    const hadNewSeed = !req.seedUid || toHex32(req.seedUid) === ZERO_BYTES32
    if (hadNewSeed) {
      offset = consumeIfSchemaMatches(allPairs, offset, req.seedSchemaUid)
    }
    offset = consumeIfSchemaMatches(allPairs, offset, req.versionSchemaUid)
    const n = list.length
    const slice = allPairs.slice(offset, offset + n)
    offset += n
    if (!slice.length) continue
    const nApply = Math.min(slice.length, n)
    let versionUidRow =
      req.versionUid && toHex32(req.versionUid) !== ZERO_BYTES32
        ? toHex32(req.versionUid)
        : undefined
    if (!versionUidRow) {
      versionUidRow = versionUidFromCreatedAttestationEvents(
        receipt,
        req.versionSchemaUid,
        useModularExecutor,
      )
    }
    await applyPropertyAttestationUidsFromPublish({
      seedLocalId: req.localId,
      attestationCreatedAtMs: attMs ?? null,
      versionUid:
        versionUidRow && toHex32(versionUidRow) !== ZERO_BYTES32 ? toHex32(versionUidRow) : null,
      pairs: slice.slice(0, nApply).map((p, j) => ({
        schemaUid: p.schemaUid,
        attestationUid: p.attestationUid,
        propertyName:
          typeof list[j]?._propertyName === 'string' && list[j]._propertyName !== ''
            ? list[j]._propertyName
            : undefined,
      })),
    })
  }
}

export const createAttestations = fromPromise(
  async ({ input: { context } }: PublishInput): Promise<{ easPayload: unknown }> => {
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

    if (!useModularExecutor && !(await isSmartWalletDeployed(address))) {
      throw new Error(
        'EOA publishing must use the direct EAS path (multiPublish requires a deployed publisher contract). If you see this, attestation routing is misconfigured.',
      )
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

    let routing = resolvePublishRouting({
      useModularExecutor: false,
      publisherAddress: address,
    })
    let activeAccount = account

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

    const requestData = await (
      item.getPublishPayload as (
        uploads: typeof uploadDataWithTxIds,
        opts?: { publishMode?: 'patch' | 'new_version' },
      ) => ReturnType<typeof item.getPublishPayload>
    )(uploadDataWithTxIds, { publishMode: context.publishMode ?? 'patch' })

    const reqs = Array.isArray(requestData) ? requestData : [requestData]

    if (useModularExecutor) {
      const prep = await runModularExecutorPublishPrep()
      if (!prep.ok) {
        throw prep.error
      }
      routing = resolvePublishRouting({
        useModularExecutor,
        publisherAddress: address,
        modularAccountModuleContract,
        managedAddress: prep.managedAddress,
      })
      const modularAccountWallet = getModularAccountWallet()
      await modularAccountWallet.autoConnect({ client: getClient(), chain: optimismSepolia })
      const modularAccount = modularAccountWallet.getAccount()
      if (!modularAccount) {
        throw new Error('Failed to get modular account')
      }
      activeAccount = modularAccount
      await ensureEip7702ModularAccountReady()
      await ensureManagedAccountEasConfigured(prep.managedAddress, modularAccount)
    }
    const targetContract = getContract({
      client: getClient(),
      chain: optimismSepolia,
      address: routing.txTargetAddress,
    })

    const needsSequential = reqs.length > 1 && hasCrossPayloadUnresolved(reqs)

    let effectiveRequests: any[]
    let lastAttestationReceipt: ReceiptLike | null = null

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

        lastAttestationReceipt = receipt
        const listOfAttestationsCount = normalizedOne?.listOfAttestations?.length ?? 0
        await persistVersionUidFromPublishReceipt({
          receipt,
          seedLocalId: rawReq.localId,
          versionSchemaUid: normalizedOne.versionSchemaUid,
          contractAddressForEvents: routing.contractAddressForEvents,
          listOfAttestationsCount,
          useModularExecutor,
          publisherAddress: address,
        })

        const hadZeroSeedUid =
          !normalizedOne.seedUid || toHex32(normalizedOne.seedUid) === ZERO_BYTES32
        const seedSchemaUid = normalizedOne?.seedSchemaUid
        if (hadZeroSeedUid) {
          const seedUidFromTx =
            seedUidFromCreatedAttestationEvents(receipt, seedSchemaUid, useModularExecutor) ??
            seedUidFromSeedPublished(
              receipt,
              routing.contractAddressForEvents,
              listOfAttestationsCount,
              useModularExecutor,
            )
          if (seedUidFromTx) {
            resolvedUids[rawReq.localId] = seedUidFromTx
            workingPayload[i] = { ...workingPayload[i], seedUid: seedUidFromTx }
          }
        }

        await persistPropertyMetadataUidsFromContractReceipt({
          receipt,
          normalizedRequests: [normalizedOne],
          useModularExecutor,
        })
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

      let result: Awaited<ReturnType<typeof sendTransaction>>
      try {
        result = await sendTransaction({
          account: activeAccount,
          transaction: await Promise.resolve(tx),
        })
      } catch (e) {
        logger('sendTransaction failed in non-sequential publish %O', e)
        throw e
      }

      const receipt = await waitForReceipt({
        client: getClient(),
        chain: optimismSepolia,
        transactionHash: result.transactionHash,
      })
      if (!receipt) {
        throw new Error('Failed to send transaction')
      }

      lastAttestationReceipt = receipt
      const rootReqSingle =
        normalizedRequests.find((r: any) => r?.localId === item.seedLocalId) ?? normalizedRequests[0]
      await persistVersionUidFromPublishReceipt({
        receipt,
        seedLocalId: rootReqSingle?.localId,
        versionSchemaUid: rootReqSingle?.versionSchemaUid,
        contractAddressForEvents: routing.contractAddressForEvents,
        listOfAttestationsCount: rootReqSingle?.listOfAttestations?.length ?? 0,
        useModularExecutor,
        publisherAddress: address,
      })

      await persistPropertyMetadataUidsFromContractReceipt({
        receipt,
        normalizedRequests: payloadForContract,
        useModularExecutor,
      })

      const firstRequest = normalizedRequests[0]
      const firstRequestSeedUid = firstRequest?.seedUid
      const hadZeroSeedUid = firstRequestSeedUid === ZERO_BYTES32 || !firstRequestSeedUid
      const listOfAttestationsCount = firstRequest?.listOfAttestations?.length ?? 0
      const seedSchemaUid = firstRequest?.seedSchemaUid
      const seedUidFromTx = hadZeroSeedUid
        ? (seedUidFromCreatedAttestationEvents(receipt, seedSchemaUid, useModularExecutor) ??
          seedUidFromSeedPublished(
            receipt,
            routing.contractAddressForEvents,
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
    const itemWithPersist = item as {
      persistSeedUid?: (publisher?: string, attestationCreatedAtMs?: number) => Promise<void>
    }
    const rootRequest = effectiveRequests.find((r) => r?.localId === item.seedLocalId)
    const rootSeedUid = rootRequest?.seedUid
    if (rootSeedUid && rootSeedUid !== ZERO_BYTES32) {
      const seedAttMs = lastAttestationReceipt
        ? await attestationMsFromReceipt(getClient(), optimismSepolia, lastAttestationReceipt)
        : undefined
      await persistSeedUidSafely(itemWithPersist, address, seedAttMs)
    }

    logger('requestData', requestData)

    void enqueueArweaveL1FinalizeJobsFromPublishContext(context)

    try {
      const { clearHtmlEmbeddedImageCoPublishRows } = await import('@seedprotocol/sdk')
      await clearHtmlEmbeddedImageCoPublishRows(item.seedLocalId)
    } catch {
      /* best-effort cleanup */
    }

    return { easPayload: requestData }
  },
)
