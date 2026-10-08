import { fromPromise } from 'xstate'
import type { PublishMachineContext } from '../../../types'
import type { ArweaveTransactionInfo } from '../../../types'
import type { PublishUpload } from '../../../types'
import { resolvePublishPayloadValues } from '@seedprotocol/sdk'
import { recordMultiPublishReceipt } from './recordMultiPublishReceipt'
import {
  isContractDeployed,
} from '~/helpers/chainClient'
import { runModularExecutorPublishPrep } from '~/helpers/ensureManagedAccountReady'
import { encodeExecutorMultiPublish, encodeMultiPublish } from '~/helpers/contracts'
import {
  assertExecutorModuleReadyForAccount,
  simulateCallFromAccount,
} from '~/helpers/executorModuleReadiness'
import { explainUserOpError } from '~/helpers/describeRevert'
import { waitForPublishReceipt } from '~/helpers/chainClient'
import { resolvePublishWallet } from '~/helpers/resolvePublishWallet'
import type { PublishWallet } from '~/helpers/seedSigner'
import type { Address } from 'viem'
import { persistSeedUidFromPublishResult, persistSeedUidSafely } from './persistSeedUid'
import { ensureEasSchemasForItem } from '../helpers/ensureEasSchemas'
import { verifyArweaveTransactionsExist } from '../helpers/verifyArweaveTransactionsExist'
import { getPublishConfig } from '~/config'
import { waitForItem } from './utils'
import { ZERO_BYTES32 } from './utils'
import { listCreatedAttestationPairsFromReceipt } from './seedUidHelpers'
import { attestationMsFromReceipt } from '../helpers/receiptAttestationMs'
import {
  normalizePublishRequest,
  applyPropertiesToUpdatePlaceholders,
  hasCrossPayloadUnresolved,
  filterPropertiesToUpdateForBatch,
  toHex32,
} from './publishRequestNormalize'
import { enqueueArweaveL1FinalizeJobsFromPublishContext } from '../../arweaveL1Finalize/enqueue'
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
  /**
   * When true (automation session keys), send `multiPublish` to the executor module
   * so module-only `approvedTargets` can execute. Interactive modular publish keeps
   * the ManagedAccount as `txTargetAddress`.
   */
  routeToExecutorModule?: boolean
}

type PublishRouting = {
  txTargetAddress: string
  contractAddressForEvents: string
}

function isExecutorModuleAddress(value: string | undefined): value is string {
  return !!value && /^0x[0-9a-fA-F]{40}$/.test(value.trim())
}

export function resolvePublishRouting(input: PublishRoutingInput): PublishRouting {
  const {
    useModularExecutor,
    publisherAddress,
    modularAccountModuleContract,
    managedAddress,
    routeToExecutorModule,
  } = input
  if (useModularExecutor) {
    if (!managedAddress) {
      throw new Error('resolvePublishRouting: managedAddress is required when useModularExecutor is true')
    }
    const module = modularAccountModuleContract?.trim()
    if (routeToExecutorModule) {
      if (!isExecutorModuleAddress(module)) {
        throw new Error(
          'resolvePublishRouting: modularAccountModuleContract is required when routeToExecutorModule is true',
        )
      }
      return {
        txTargetAddress: module,
        contractAddressForEvents: module,
      }
    }
    return {
      txTargetAddress: managedAddress,
      contractAddressForEvents: module || managedAddress,
    }
  }
  return {
    txTargetAddress: publisherAddress,
    contractAddressForEvents: publisherAddress,
  }
}

export const createAttestations = fromPromise(
  async ({
    input: { context },
  }: PublishInput): Promise<{
    easPayload: unknown
    publishedBatch: PublishMachineContext['publishedBatch']
  }> => {
    const { address, account, wallet } = context
    const arweaveTransactions = context.arweaveTransactions ?? []
    const publishUploads = context.publishUploads ?? []
    let { item } = context

    const { modularAccountModuleContract, useModularExecutor } = getPublishConfig()

    if (!address || typeof address !== 'string' || !address.trim()) {
      throw new Error('No wallet address for publish. Connect a wallet and try again.')
    }

    if (!wallet && !account) {
      throw new Error('Wallet session is missing. Reconnect your wallet and retry the publish.')
    }

    if (!useModularExecutor && !(await isContractDeployed(address))) {
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
    let activeWallet: PublishWallet = resolvePublishWallet(context)
    let routeToExecutorModule = false

    await ensureEasSchemasForItem(item, activeWallet, { managedAddress: address })

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
      // App-held automation session keys (PUBLISH_AUTOMATION.md): keep the provided
      // PublishWallet when it is an active session key on the ManagedAccount. Do not
      // require a connected modular in-app wallet on the server.
      const sessionKeyAddress = activeWallet?.signer?.address
      let automationActive = false
      if (address && sessionKeyAddress) {
        const { isAutomationSessionActive } = await import(
          '~/helpers/ensureAutomationSessionKey'
        )
        // Probe failures must not silently fall through to modular in-app bootstrap
        // (that path requires a browser wallet and hides the real RPC/error).
        automationActive = await isAutomationSessionActive(address, sessionKeyAddress)
      }

      if (automationActive) {
        const module = modularAccountModuleContract?.trim()
        if (!isExecutorModuleAddress(module)) {
          throw new Error(
            '@seedprotocol/publish: automation publish requires PublishConfig.modularAccountModuleContract ' +
              '(executor module). Session keys are module-only and cannot call the ManagedAccount directly.',
          )
        }
        routing = resolvePublishRouting({
          useModularExecutor,
          publisherAddress: address,
          modularAccountModuleContract: module,
          managedAddress: address,
          routeToExecutorModule: true,
        })
        routeToExecutorModule = true
        // Read-only: automation keys cannot set up the module or its EAS (not in approvedTargets).
        await assertExecutorModuleReadyForAccount(address)
      } else {
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
        const { ensureModularPublishBootstrap } = await import(
          '~/helpers/ensureModularPublishBootstrap'
        )
        const { fromThirdwebAccount } = await import('~/helpers/adapters/thirdwebAccount')
        activeWallet = fromThirdwebAccount(
          await ensureModularPublishBootstrap(prep.managedAddress),
        )
      }
    } else {
      await ensureManagedAccountEasConfigured(address, activeWallet)
    }

    // The executor module takes a different multiPublish struct than the ManagedAccount
    // extension. Every publish is simulated from the sending account first, so a call that would
    // revert is never sent and its decoded reason is reported. Automation also refuses to send
    // when the simulation cannot run; other routes go ahead.
    const sendPublishTx = async (requests: any[]) => {
      const to = routing.txTargetAddress as Address
      const tx = routeToExecutorModule
        ? encodeExecutorMultiPublish(to, requests, 5_000_000n)
        : encodeMultiPublish(to, requests, 5_000_000n)
      await simulateCallFromAccount(
        routeToExecutorModule
          ? { managedAddress: address, tx, action: 'multiPublish via the executor module' }
          : {
              managedAddress: activeWallet.txSender.address,
              tx,
              action: 'multiPublish',
              code: 'PUBLISH_PREFLIGHT_FAILED',
              requireSimulation: false,
            },
      )
      try {
        return await activeWallet.txSender.sendTransaction(tx)
      } catch (err) {
        throw explainUserOpError(err, activeWallet.txSender.address)
      }
    }

    const needsSequential = reqs.length > 1 && hasCrossPayloadUnresolved(reqs)

    let effectiveRequests: any[]
    let lastAttestationReceipt: ReceiptLike | null = null
    const batchExtraUids: string[] = []

    if (needsSequential) {
      let workingPayload = structuredClone(reqs) as any[]
      const resolvedUids: Record<string, string> = {}
      const resolvedVersionUids: Record<string, string> = {}

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

        const result = await sendPublishTx([normalizedOne])

        const receipt = await waitForPublishReceipt(result.transactionHash)
        if (!receipt) {
          throw new Error('Failed to send transaction')
        }

        lastAttestationReceipt = receipt
        for (const pair of listCreatedAttestationPairsFromReceipt(receipt, useModularExecutor)) {
          if (pair.attestationUid) batchExtraUids.push(pair.attestationUid)
        }
        const {
          requests: [recorded],
        } = await recordMultiPublishReceipt({
          receipt,
          requests: [normalizedOne],
          rootSeedLocalId: item.seedLocalId,
          useModularExecutor,
          contractAddressForEvents: routing.contractAddressForEvents,
          publisherAddress: address,
        })

        if (recorded?.versionUid && toHex32(recorded.versionUid) !== ZERO_BYTES32) {
          resolvedVersionUids[rawReq.localId] = recorded.versionUid
        }
        const hadZeroSeedUid =
          !normalizedOne.seedUid || toHex32(normalizedOne.seedUid) === ZERO_BYTES32
        const seedUidFromTx = hadZeroSeedUid ? recorded?.seedUid : undefined
        if (seedUidFromTx && toHex32(seedUidFromTx) !== ZERO_BYTES32) {
          resolvedUids[rawReq.localId] = seedUidFromTx
          workingPayload[i] = { ...workingPayload[i], seedUid: seedUidFromTx }
          batchExtraUids.push(seedUidFromTx)
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
          versionUid: resolvedVersionUids[r.localId] ?? r.versionUid,
        }),
      )
    } else {
      const normalizedRequests = reqs.map((req: any) => normalizePublishRequest(req))

      const byLocalId = new Map(normalizedRequests.map((r: any) => [r?.localId, r]))
      applyPropertiesToUpdatePlaceholders(normalizedRequests, byLocalId)

      const payloadForContract = Array.isArray(requestData) ? normalizedRequests : [normalizedRequests[0]]
      const result = await sendPublishTx(payloadForContract)

      const receipt = await waitForPublishReceipt(result.transactionHash)
      if (!receipt) {
        throw new Error('Failed to send transaction')
      }

      lastAttestationReceipt = receipt
      for (const pair of listCreatedAttestationPairsFromReceipt(receipt, useModularExecutor)) {
        if (pair.attestationUid) batchExtraUids.push(pair.attestationUid)
      }
      // Every request in the transaction (the item and the related items published with it)
      // records its own seed, version and property uids.
      const recorded = await recordMultiPublishReceipt({
        receipt,
        requests: payloadForContract,
        rootSeedLocalId: item.seedLocalId,
        useModularExecutor,
        contractAddressForEvents: routing.contractAddressForEvents,
        publisherAddress: address,
      })
      effectiveRequests = recorded.requests
    }

    persistSeedUidFromPublishResult(item as { seedUid?: string; seedLocalId?: string }, effectiveRequests)
    const itemWithPersist = item as {
      persistSeedUid?: (publisher?: string, attestationCreatedAtMs?: number) => Promise<void>
    }
    const rootRequest = effectiveRequests.find((r) => r?.localId === item.seedLocalId)
    const rootSeedUid = rootRequest?.seedUid
    if (rootSeedUid && rootSeedUid !== ZERO_BYTES32) {
      const seedAttMs = lastAttestationReceipt
        ? await attestationMsFromReceipt(lastAttestationReceipt)
        : undefined
      await persistSeedUidSafely(itemWithPersist, address, seedAttMs)
    }

    logger('requestData', requestData)

    void enqueueArweaveL1FinalizeJobsFromPublishContext(context)

    try {
      // The item's co-publish rows and those of the related drafts published with it.
      const { clearHtmlEmbeddedImageCoPublishRows } = await import('@seedprotocol/sdk')
      const published = new Set<string>([item.seedLocalId])
      for (const r of effectiveRequests) if (r?.localId) published.add(r.localId)
      for (const seedLocalId of published) await clearHtmlEmbeddedImageCoPublishRows(seedLocalId)
    } catch {
      /* best-effort cleanup */
    }

    const { collectPublishedBatch } = await import('../../publishedBy/collectBatchUids')
    const rootForBatch =
      effectiveRequests.find((r) => r?.localId === item.seedLocalId) ?? effectiveRequests[0]
    for (const r of effectiveRequests) {
      if (r?.seedUid) batchExtraUids.push(String(r.seedUid))
      if (r?.versionUid) batchExtraUids.push(String(r.versionUid))
    }
    const publishedBatch = rootForBatch?.seedUid
      ? collectPublishedBatch({
          seedUid: String(rootForBatch.seedUid),
          versionUid: rootForBatch.versionUid ? String(rootForBatch.versionUid) : undefined,
          extraUids: batchExtraUids,
        })
      : null

    return { easPayload: requestData, publishedBatch }
  },
)
