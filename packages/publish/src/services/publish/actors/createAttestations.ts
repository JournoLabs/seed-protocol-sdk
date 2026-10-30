import { fromPromise } from 'xstate'
import type { PublishMachineContext } from '../../../types'
import type { ArweaveTransactionInfo } from '../../../types'
import type { PublishUpload, UnrecordedAttestation } from '../../../types'
import type { IItem } from '@seedprotocol/sdk'
import { recordMultiPublishReceipt } from './recordMultiPublishReceipt'
import {
  isContractDeployed,
} from '~/helpers/chainClient'
import { encodeExecutorMultiPublish, encodeMultiPublish } from '~/helpers/contracts'
import {
  assertExecutorModuleReadyForAccount,
  simulateCallFromAccount,
} from '~/helpers/executorModuleReadiness'
import { AttestationRecordError, ManagedAccountPublishError } from '~/errors'
import { explainUserOpError } from '~/helpers/describeRevert'
import { publishGasLimit } from '~/helpers/publishGas'
import { assertMultiPublishRouted } from '~/helpers/multiPublishRoute'
import { waitForPublishReceipt } from '~/helpers/chainClient'
import { resolvePublishWallet } from '~/helpers/resolvePublishWallet'
import { sendsAsManagedAccount, type PublishWallet } from '~/helpers/seedSigner'
import type { Address, TransactionReceipt } from 'viem'
import { persistSeedUidFromPublishResult, persistSeedUidSafely } from './persistSeedUid'
import { verifyArweaveTransactionsExist } from '../helpers/verifyArweaveTransactionsExist'
import { getPublishConfig } from '~/config'
import { waitForItem } from './utils'
import { ZERO_BYTES32 } from './utils'
import { attestationMsFromReceipt } from '../helpers/receiptAttestationMs'
import { normalizePublishRequest } from './publishRequestNormalize'
import { enqueueArweaveL1FinalizeJobsFromPublishContext } from '../../arweaveL1Finalize/enqueue'
import { ensureManagedAccountEasConfigured } from '~/helpers/ensureManagedAccountEasConfigured'
import debug from 'debug'

const logger = debug('seedProtocol:services:publish:actors')

type PublishInput = { input: { context: PublishMachineContext; event: unknown } }

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
  /** The account EAS records as attester: the one the extension runs in or the executor acts for. */
  attesterAddress: string
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
        attesterAddress: managedAddress,
      }
    }
    return {
      txTargetAddress: managedAddress,
      attesterAddress: managedAddress,
    }
  }
  return {
    txTargetAddress: publisherAddress,
    attesterAddress: publisherAddress,
  }
}

type CreateAttestationsResult = {
  easPayload: unknown
  publishedBatch: PublishMachineContext['publishedBatch']
}

export const createAttestations = fromPromise(
  async ({ input: { context } }: PublishInput): Promise<CreateAttestationsResult> => {
    // Items this actor loads itself (a restored publish record carries the item as plain data)
    const loaded: IItem<any>[] = []
    try {
      return await executeCreateAttestations(context, loaded)
    } finally {
      for (const item of loaded) item.unload()
    }
  },
)

async function executeCreateAttestations(
  context: PublishMachineContext,
  loaded: IItem<any>[],
): Promise<CreateAttestationsResult> {
    const { address } = context
    const arweaveTransactions = context.arweaveTransactions ?? []
    const publishUploads = context.publishUploads ?? []
    let { item } = context

    const { modularAccountModuleContract, useModularExecutor } = getPublishConfig()

    if (!address || typeof address !== 'string' || !address.trim()) {
      throw new Error('No wallet address for publish. Connect a wallet and try again.')
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
      loaded.push(item)
    }

    // The transaction landed and recording it failed: repeat the record from its receipt. A retry
    // that reached the send would attest everything a second time.
    const unrecorded = context.unrecordedAttestation
    if (unrecorded) {
      const receipt = await waitForPublishReceipt(unrecorded.transactionHash)
      return recordAttested(context, item, receipt, unrecorded, unrecorded.requests)
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

    // The contract creates every seed before it attests any property, so a relation back to an item
    // this publish creates is filled now rather than left for a later publish.
    const requestData = await (
      item.getPublishPayload as (
        uploads: typeof uploadDataWithTxIds,
        opts?: { publishMode?: 'patch' | 'new_version'; backReferences?: 'link' | 'defer' },
      ) => ReturnType<typeof item.getPublishPayload>
    )(uploadDataWithTxIds, { publishMode: context.publishMode ?? 'patch', backReferences: 'link' })

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
        const { assertSessionKeyApprovesExecutor } = await import('~/helpers/ensureAutomationSessionKey')
        await assertSessionKeyApprovesExecutor(address, sessionKeyAddress, module)
        const { warnOnAutomationExposure } = await import('~/helpers/automationExposure')
        await warnOnAutomationExposure(address)
      } else if (sendsAsManagedAccount(activeWallet, address)) {
        // A wallet that already sends as the ManagedAccount (e.g. createManagedAccountTxSender)
        // publishes as it is: no Thirdweb in-app wallet to connect.
        routing = resolvePublishRouting({
          useModularExecutor,
          publisherAddress: address,
          modularAccountModuleContract,
          managedAddress: address,
        })
        await ensureManagedAccountEasConfigured(address, activeWallet)
      } else {
        const { runModularExecutorPublishPrep } = await import('~/helpers/ensureManagedAccountReady')
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

    // Every publish is simulated from the sending account first, so a call that would revert is
    // never sent and its decoded reason is reported. Automation also refuses to send when the
    // simulation cannot run; other routes go ahead. The gas limit is estimated from the same account.
    const sendPublishTx = async (requests: any[]) => {
      const to = routing.txTargetAddress as Address
      const unsized = routeToExecutorModule
        ? encodeExecutorMultiPublish(to, requests)
        : encodeMultiPublish(to, requests)
      const from = routeToExecutorModule ? address : activeWallet.txSender.address
      if (routeToExecutorModule && unsized.value) {
        throw new ManagedAccountPublishError(
          `This publish needs ${unsized.value} wei with its attestations, but session keys are granted no native value; nothing was sent.`,
          'AUTOMATION_PREFLIGHT_FAILED',
          address,
        )
      }
      // Contracts of another version answer with a Router revert; name the mismatch instead.
      await assertMultiPublishRouted(to, { executorModule: routeToExecutorModule })
      await simulateCallFromAccount(
        routeToExecutorModule
          ? { managedAddress: from, tx: unsized, action: 'multiPublish via the executor module' }
          : {
              managedAddress: from,
              tx: unsized,
              action: 'multiPublish',
              code: 'PUBLISH_PREFLIGHT_FAILED',
              requireSimulation: false,
            },
      )
      const tx = { ...unsized, gas: await publishGasLimit(from, unsized) }
      try {
        return await activeWallet.txSender.sendTransaction(tx)
      } catch (err) {
        throw explainUserOpError(err, activeWallet.txSender.address)
      }
    }

    // One transaction for the whole graph: the contract creates every seed before it attests any
    // property, so a reference in any direction is filled with its seed uid (encodeMultiPublish).
    const normalizedRequests = reqs.map((req: any) => normalizePublishRequest(req))
    const payloadForContract = Array.isArray(requestData) ? normalizedRequests : [normalizedRequests[0]]
    const result = await sendPublishTx(payloadForContract)

    const receipt = await waitForPublishReceipt(result.transactionHash)
    if (!receipt) {
      throw new Error('Failed to send transaction')
    }

    const landed: UnrecordedAttestation = {
      transactionHash: result.transactionHash,
      requests: payloadForContract,
      attester: routing.attesterAddress,
    }
    return recordAttested(context, item, receipt, landed, requestData)
}

/** Records a landed `multiPublish`, from its receipt, and finishes the publish. */
async function recordAttested(
  context: PublishMachineContext,
  item: IItem<any>,
  receipt: TransactionReceipt,
  landed: UnrecordedAttestation,
  easPayload: unknown,
): Promise<CreateAttestationsResult> {
    const address = context.address as string

    // Every request in the transaction (the item and the related items published with it)
    // records its own seed, version and property uids.
    const { requests: effectiveRequests, attributed } = await recordMultiPublishReceipt({
      receipt,
      requests: landed.requests as Parameters<typeof recordMultiPublishReceipt>[0]['requests'],
      rootSeedLocalId: item.seedLocalId,
      publisherAddress: address,
      attester: landed.attester,
    }).catch((err) => {
      throw new AttestationRecordError(landed, err)
    })

    persistSeedUidFromPublishResult(item as { seedUid?: string; seedLocalId?: string }, effectiveRequests)
    const itemWithPersist = item as {
      persistSeedUid?: (publisher?: string, attestationCreatedAtMs?: number) => Promise<void>
    }
    const rootRequest = effectiveRequests.find((r) => r?.localId === item.seedLocalId)
    const rootSeedUid = rootRequest?.seedUid
    if (rootSeedUid && rootSeedUid !== ZERO_BYTES32) {
      const seedAttMs = await attestationMsFromReceipt(receipt)
      await persistSeedUidSafely(itemWithPersist, address, seedAttMs)
    }

    logger('easPayload', easPayload)

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
    const batchExtraUids = attributed.flatMap((a) => a.propertyPairs.map((pair) => pair.attestationUid))
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

    return { easPayload, publishedBatch }
}
