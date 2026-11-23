import { fromPromise } from 'xstate'
import type { PublishMachineContext } from '../../../types'
import type { ArweaveTransactionInfo } from '../../../types'
import type { PublishUpload, UnrecordedAttestation } from '../../../types'
import { findOpenPublishAttempts, type IItem } from '@seedprotocol/sdk'
import { recordMultiPublishReceipt } from './recordMultiPublishReceipt'
import { sendAttested, waitForAttemptReceipt } from './sendAttested'
import {
  isContractDeployed,
} from '~/helpers/chainClient'
import { encodeExecutorMultiPublish, encodeMultiPublish, type MultiPublishRequest } from '~/helpers/contracts'
import {
  assertExecutorModuleReadyForAccount,
  simulateCallFromAccount,
} from '~/helpers/executorModuleReadiness'
import { AttestationRecordError, ManagedAccountPublishError } from '~/errors'
import { explainUserOpError } from '~/helpers/describeRevert'
import { estimatePublishGas, publishGasCeiling, publishGasLimit, type PublishGasEstimate } from '~/helpers/publishGas'
import { fitPublishPart, partRequests, publishUnits } from '~/helpers/publishParts'
import { partsSentUnderNonceKey } from '~/helpers/nonceKeyParts'
import { assertPublishFits, localPublishGas } from '~/helpers/publishSize'
import { assertMultiPublishRouted } from '~/helpers/multiPublishRoute'
import { waitForPublishReceipt } from '~/helpers/chainClient'
import { resolvePublishWallet } from '~/helpers/resolvePublishWallet'
import { sendsAsManagedAccount, type PublishWallet, type SeedTxSender } from '~/helpers/seedSigner'
import type { Address, Hash, TransactionReceipt } from 'viem'
import { persistSeedUidFromPublishResult, persistSeedUidSafely } from './persistSeedUid'
import { getBlobStore } from '~/blobStore'
import { getPublishConfig } from '~/config'
import { waitForItem } from './utils'
import { ZERO_BYTES32 } from './utils'
import { attestationMsFromReceipt } from '../helpers/receiptAttestationMs'
import { normalizePublishRequest } from './publishRequestNormalize'
import { enqueueArweaveL1FinalizeJobsFromPublishContext } from '../../arweaveL1Finalize/enqueue'
import { ensureManagedAccountEasConfigured } from '~/helpers/ensureManagedAccountEasConfigured'
import { licenseOfferAttestation } from '../../licenseOffer'
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
  /**
   * The requests of the parts this call recorded, in the order they were sent. A call that went on
   * from parts recorded earlier (a retry, a restore, a replaced run) leaves those out.
   */
  easPayload: unknown
  /** The uids of the parts this call recorded, as {@link easPayload}. */
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

type SendTx = (nonceKey?: bigint, onNonceKeyIgnored?: () => void) => Promise<{ transactionHash: Hash }>

/**
 * Checks and sends a `multiPublish`. `through` gets the send once every preflight has passed, and
 * the sender, so a caller can wrap only the send (sendAttested).
 */
type SendMultiPublish = <T>(
  requests: any[],
  through: (send: SendTx, sender: SeedTxSender) => Promise<T>,
) => Promise<T>

/**
 * Works out how `address` attests through `multiPublish`, the executor module or the account
 * itself, and returns the function that sends it. Used by publish and by `anchorArchive`.
 */
export async function resolveMultiPublishSender(source: {
  address: Address
  wallet?: unknown
  account?: unknown
}): Promise<{
  sendMultiPublish: SendMultiPublish
  attesterAddress: string
  /** The gas `requests` need on this route, with headroom; `undefined` when it can't be estimated. */
  estimateMultiPublish: (requests: MultiPublishRequest[]) => Promise<PublishGasEstimate>
}> {
  const { address } = source
  const { modularAccountModuleContract, useModularExecutor } = getPublishConfig()
  let routing = resolvePublishRouting({ useModularExecutor: false, publisherAddress: address })
  let activeWallet: PublishWallet = resolvePublishWallet(source)
  let routeToExecutorModule = false

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
      // nonceKeySender (helpers/hostNonceKey.ts) mirrors this swap for checking: keep them in step.
      const { fromThirdwebAccount } = await import('~/helpers/adapters/thirdwebAccount')
      activeWallet = fromThirdwebAccount(
        await ensureModularPublishBootstrap(prep.managedAddress),
        { pinsNonce: true },
      )
    }
  } else {
    await ensureManagedAccountEasConfigured(address, activeWallet)
  }

  // Every publish is simulated from the sending account first, so a call that would revert is
  // never sent and its decoded reason is reported. Automation also refuses to send when the
  // simulation cannot run; other routes go ahead. The gas limit is estimated from the same account.
  const to = routing.txTargetAddress as Address
  const from = routeToExecutorModule ? address : activeWallet.txSender.address
  const encode = (requests: MultiPublishRequest[]) =>
    routeToExecutorModule ? encodeExecutorMultiPublish(to, requests) : encodeMultiPublish(to, requests)

  const sendPublishTx: SendMultiPublish = async (requests, through) => {
    const unsized = encode(requests)
    if (routeToExecutorModule && unsized.value) {
      throw new ManagedAccountPublishError(
        `This publish needs ${unsized.value} wei with its attestations, but session keys are granted no native value; nothing was sent.`,
        'AUTOMATION_PREFLIGHT_FAILED',
        address,
      )
    }
    assertPublishFits(from, requests, { calldata: unsized.data })
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
    const tx = { ...unsized, gas: await publishGasLimit(from, unsized, localPublishGas(requests)) }
    const send: SendTx = async (nonceKey, onNonceKeyIgnored) => {
      try {
        return await activeWallet.txSender.sendTransaction(
          nonceKey === undefined ? tx : { ...tx, nonceKey, onNonceKeyIgnored },
        )
      } catch (err) {
        throw explainUserOpError(err, activeWallet.txSender.address)
      }
    }
    return through(send, activeWallet.txSender)
  }

  return {
    sendMultiPublish: sendPublishTx,
    attesterAddress: routing.attesterAddress,
    estimateMultiPublish: (requests) => estimatePublishGas(from, encode(requests)),
  }
}

/** A `multiPublish` of this run, recorded. */
type RecordedPart = {
  receipt: TransactionReceipt
  /** The part's requests with the seed and version uids it created filled in. */
  requests: any[]
  attributed: Awaited<ReturnType<typeof recordMultiPublishReceipt>>['attributed']
}

const heldRoot = (requests: unknown[], seedLocalId: string) =>
  requests.some((r) => (r as { localId?: string } | undefined)?.localId === seedLocalId)

/**
 * Sends the publish as one `multiPublish` per part (ADR 0036): rebuild the payload from the rows,
 * cut the longest prefix of units that fits, send it, record it, and repeat until the part that
 * held the root is recorded. Recorded seeds are published, so each rebuilt payload holds only what
 * is left and references earlier parts by uid.
 */
async function executeCreateAttestations(
  context: PublishMachineContext,
  loaded: IItem<any>[],
): Promise<CreateAttestationsResult> {
    const parts: RecordedPart[] = []
    const { address } = context
    const arweaveTransactions = context.arweaveTransactions ?? []
    const publishUploads = context.publishUploads ?? []
    let { item } = context

    const { useModularExecutor } = getPublishConfig()

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
    // Read from the recorded attempts, so a reload between parts goes on from the right key (ADR 0036).
    const partsBefore = await partsSentUnderNonceKey(context)
    const finish = () => finishAttested(context, item, parts)

    // A part landed and recording it failed: repeat the record from its receipt. A retry that
    // reached the send would attest it a second time.
    const unrecorded = context.unrecordedAttestation
    if (unrecorded) {
      const receipt = await waitForPublishReceipt(unrecorded.transactionHash)
      parts.push(await recordPart(context, item, receipt, unrecorded))
      if (heldRoot(unrecorded.requests, item.seedLocalId)) return finish()
    }

    const txCount = arweaveTransactions.length
    const uploadCount = publishUploads.length
    if (txCount !== uploadCount) {
      throw new Error(
        'Attestation recovery failed: Arweave transaction data is missing or incomplete. Delete this publish record and try a full publish from the beginning.',
      )
    }

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

    await getBlobStore().assertStored(uploadDataWithTxIds.map((u) => u.txId))

    const { sendMultiPublish, attesterAddress, estimateMultiPublish } = await resolveMultiPublishSender({
      address: address as Address,
      wallet: context.wallet,
      account: context.account,
    })

    let resumeAttemptId = context.resumeAttemptId
    // A resumed attempt goes again with the requests it stored: sendAttested sends under its key
    // only those, and a payload cut again (by a new RPC estimate, say) can differ from them.
    let resumedPart = resumeAttemptId ? await openAttemptPart(resumeAttemptId, item.seedLocalId) : undefined
    let lastSent: string | undefined
    for (;;) {
      const { part, isWhole } = resumedPart
        ? { part: resumedPart, isWhole: false }
        : await nextPart(item, uploadDataWithTxIds, context, estimateMultiPublish)
      resumedPart = undefined
      const serialized = JSON.stringify(part, (_key, v) => (typeof v === 'bigint' ? v.toString() : v))
      if (serialized === lastSent) {
        // Recording a part publishes its seeds, so the rebuilt payload can't hold the same part.
        throw new Error(
          'The rebuilt publish payload repeats the part just recorded; nothing more was sent. Retry the publish.',
        )
      }
      lastSent = serialized

      const result = await sendMultiPublish(part, (send, sender) =>
        sendAttested({
          publishRunId: context.publishRunId,
          seedLocalId: item.seedLocalId,
          requests: part,
          sender,
          attester: attesterAddress,
          send,
          resumeAttemptId,
          hostNonceKey: context.nonceKey,
          part: partsBefore + parts.length + 1,
        }),
      )
      // Reconcile's resume names the first send only.
      resumeAttemptId = undefined

      const receipt = await waitForAttemptReceipt(result.attemptId, result.transactionHash)
      if (!receipt) {
        throw new Error('Failed to send transaction')
      }

      const landed: UnrecordedAttestation = {
        attemptId: result.attemptId,
        transactionHash: result.transactionHash,
        requests: part,
        attester: attesterAddress,
      }
      parts.push(await recordPart(context, item, receipt, landed))
      if (heldRoot(part, item.seedLocalId) || isWhole) return finish()
    }
}

/** Fields a publish request holds as bigints, which an attempt row stores as decimal strings. */
const BIGINT_REQUEST_FIELDS = new Set(['expirationTime', 'value', 'elementIndex'])

/**
 * The requests open attempt `attemptId` claimed, as they were sent; undefined when it is no longer
 * open or isn't a multiPublish. Bigints come back from their strings, so the requests serialize to
 * the stored text again, which is what sendAttested checks a resume against.
 */
async function openAttemptPart(attemptId: string, seedLocalId: string): Promise<MultiPublishRequest[] | undefined> {
  const attempt = (await findOpenPublishAttempts([seedLocalId])).find((a) => a.id === attemptId)
  if (!attempt || attempt.step !== 'multiPublish') return undefined
  return JSON.parse(attempt.requests, (key, v) =>
    BIGINT_REQUEST_FIELDS.has(key) && typeof v === 'string' ? BigInt(v) : v,
  ) as MultiPublishRequest[]
}

/**
 * The next part of the publish: the payload rebuilt from the rows, cut to the longest prefix of
 * units that fits. `isWhole` when that is every unit left.
 */
async function nextPart(
  item: IItem<any>,
  uploads: Array<PublishUpload & { txId: string }>,
  context: PublishMachineContext,
  estimateMultiPublish: (requests: MultiPublishRequest[]) => Promise<PublishGasEstimate>,
): Promise<{ part: MultiPublishRequest[]; isWhole: boolean }> {
  // The contract creates every seed of a part before it attests any property, so a relation
  // back to an item in the same part is filled now rather than left for a later publish.
  const requestData = await (
    item.getPublishPayload as (
      uploads: Array<PublishUpload & { txId: string }>,
      opts?: { publishMode?: 'patch' | 'new_version'; backReferences?: 'link' | 'defer' },
    ) => ReturnType<typeof item.getPublishPayload>
  )(uploads, { publishMode: context.publishMode ?? 'patch', backReferences: 'link' })
  const reqs = Array.isArray(requestData) ? requestData : [requestData]
  const normalized = reqs.map((req: any) => normalizePublishRequest(req))
  // The offer goes with the root's properties (ADR 0037); a zero refUID is the root's Version.
  const root = context.licenseOffer ? normalized.find((r: any) => r?.localId === item.seedLocalId) : undefined
  if (root) root.listOfAttestations.push(licenseOfferAttestation(context.licenseOffer!))
  const units = publishUnits(normalized)
  if (units.length === 0) {
    // Every rebuilt payload holds at least the root until its part records.
    throw new Error('The publish payload is empty; nothing was sent.')
  }

  const count = await fitPublishPart(units, estimateMultiPublish, await publishGasCeiling())
  return { part: partRequests(units, count), isWhole: count === units.length }
}

/**
 * Records one landed part from its receipt: every request in it records its own seed, version and
 * property uids. The root's seed uid and the publish's cleanup wait for {@link finishAttested}.
 */
async function recordPart(
  context: PublishMachineContext,
  item: IItem<any>,
  receipt: TransactionReceipt,
  landed: UnrecordedAttestation,
): Promise<RecordedPart> {
  const { requests, attributed } = await recordMultiPublishReceipt({
    receipt,
    requests: landed.requests as Parameters<typeof recordMultiPublishReceipt>[0]['requests'],
    rootSeedLocalId: item.seedLocalId,
    publisherAddress: context.address as string,
    attester: landed.attester,
    attemptId: landed.attemptId,
  }).catch((err) => {
    throw new AttestationRecordError(landed, err)
  })
  await clearCoPublishRows(requests)
  return { receipt, requests, attributed }
}

/**
 * Clears the co-publish rows of the seeds a recorded part published. Done per part, so a publish
 * that fails or reloads after a part has left nothing of that part behind.
 */
async function clearCoPublishRows(requests: Array<{ localId?: string } | undefined>): Promise<void> {
  try {
    const { clearHtmlEmbeddedImageCoPublishRows } = await import('@seedprotocol/sdk')
    const published = new Set(requests.flatMap((r) => (r?.localId ? [r.localId] : [])))
    for (const seedLocalId of published) await clearHtmlEmbeddedImageCoPublishRows(seedLocalId)
  } catch {
    /* best-effort cleanup */
  }
}

/** Finishes the publish once the root's part is recorded: the root's seed uid, cleanup, the batch. */
async function finishAttested(
  context: PublishMachineContext,
  item: IItem<any>,
  parts: RecordedPart[],
): Promise<CreateAttestationsResult> {
    const address = context.address as string
    const effectiveRequests = parts.flatMap((p) => p.requests)
    const attributed = parts.flatMap((p) => p.attributed)

    persistSeedUidFromPublishResult(item as { seedUid?: string; seedLocalId?: string }, effectiveRequests)
    const itemWithPersist = item as {
      persistSeedUid?: (publisher?: string, attestationCreatedAtMs?: number) => Promise<void>
    }
    const rootPart = parts.find((p) => heldRoot(p.requests, item.seedLocalId)) ?? parts[parts.length - 1]
    const rootRequest = effectiveRequests.find((r) => r?.localId === item.seedLocalId)
    const rootSeedUid = rootRequest?.seedUid
    if (rootSeedUid && rootSeedUid !== ZERO_BYTES32 && rootPart) {
      const seedAttMs = await attestationMsFromReceipt(rootPart.receipt)
      await persistSeedUidSafely(itemWithPersist, address, seedAttMs)
    }

    const easPayload = effectiveRequests
    logger('easPayload', easPayload)

    void enqueueArweaveL1FinalizeJobsFromPublishContext(context)

    // The root's rows, in case the part that recorded it didn't name it (each part cleared its own).
    await clearCoPublishRows([{ localId: item.seedLocalId }])

    const { collectPublishedBatch } = await import('../../publishedBy/collectBatchUids')
    const rootForBatch =
      effectiveRequests.find((r) => r?.localId === item.seedLocalId) ?? effectiveRequests[0]
    const batchExtraUids = attributed.flatMap((a) => a.propertyPairs.map((pair) => pair.attestationUid))
    for (const r of effectiveRequests) {
      if (r?.seedUid) batchExtraUids.push(String(r.seedUid))
      if (r?.versionUid) batchExtraUids.push(String(r.versionUid))
    }
    const licenseOfferUid = attributed.find((a) => a.licenseOfferUid)?.licenseOfferUid
    const publishedBatch = rootForBatch?.seedUid
      ? collectPublishedBatch({
          seedUid: String(rootForBatch.seedUid),
          versionUid: rootForBatch.versionUid ? String(rootForBatch.versionUid) : undefined,
          extraUids: batchExtraUids,
          licenseOfferUid,
        })
      : null

    return { easPayload, publishedBatch }
}
