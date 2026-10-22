import { fromPromise } from 'xstate'
import type { PublishMachineContext } from '../../../types'
import { ZERO_ADDRESS } from '@ethereum-attestation-service/eas-sdk'
import {
  Item,
  updateVersionUid,
  applyPropertyAttestationUidsFromPublish,
  resolvePublishPayloadValues,
  type IItem,
} from '@seedprotocol/sdk'
import type { PublishUpload } from '../../../types'
import { persistSeedUidFromPublishResult, persistSeedUidSafely } from './persistSeedUid'
import { recordRelatedSeedUid } from './recordMultiPublishReceipt'
import { verifyAttestations } from '../helpers/verifyAttestations'
import { AttestationVerificationError, ManagedAccountPublishError } from '../../../errors'
import { findPropertiesToUpdateTargetingEarlierRequest } from './publishRequestNormalize'
import { ensureEasSchemasForItem } from '../helpers/ensureEasSchemas'
import { verifyArweaveTransactionsExist } from '../helpers/verifyArweaveTransactionsExist'
import { enqueueArweaveL1FinalizeJobsFromPublishContext } from '../../arweaveL1Finalize/enqueue'
import { getPublishConfig } from '~/config'
import { attestationMsFromReceipt } from '../helpers/receiptAttestationMs'
import { waitForPublishReceipt } from '~/helpers/chainClient'
import { resolvePublishWallet } from '~/helpers/resolvePublishWallet'
import {
  prepareEasAttest,
  prepareEasMultiAttest,
  encodeBytes32,
  ZERO_BYTES32,
  getAttestationUidFromReceipt,
  getAttestedUidsFromReceipt,
  type MultiAttestationRequest,
} from '~/helpers/easDirect'
import type { ArweaveTransactionInfo } from '../../../types'
import debug from 'debug'

const logger = debug('seedProtocol:services:publish:createAttestationsDirectToEas')

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

const waitForItem = async (seedLocalId: string): Promise<IItem<any>> => {
  let item: IItem<any> | undefined
  try {
    item = await Item.find({ seedLocalId } as Parameters<typeof Item.find>[0])
  } catch {
    // No-op
  }
  if (item) return item
  return new Promise<IItem<any>>((resolve) => {
    const interval = setInterval(() => {
      try {
        Item.find({ seedLocalId } as Parameters<typeof Item.find>[0])
          .then((found: IItem<any> | undefined) => {
            if (found) {
              clearInterval(interval)
              resolve(found)
            }
          })
      } catch {
        // No-op
      }
    }, 200)
  })
}

type RawAttestation = {
  data?: Array<{ data?: unknown }> | { data?: unknown }
  _rawListIdsForResolve?: string[]
  _unresolvedValue?: string
  _easDataType?: string
  _schemaDef?: string
}

const isListAttestation = (att: RawAttestation | undefined): boolean =>
  Array.isArray(att?._rawListIdsForResolve) ||
  att?._easDataType === 'bytes32[]' ||
  (typeof att?._schemaDef === 'string' && att._schemaDef.startsWith('bytes32[]'))

const hasUnresolvedRef = (att: RawAttestation | undefined): boolean =>
  (Array.isArray(att?._rawListIdsForResolve) && att._rawListIdsForResolve.length > 0) ||
  !!att?._unresolvedValue

/**
 * Re-encodes the attestations of `rawReq` (the getPublishPayload request) whose relation/list value
 * names seeds by localId once every one has a uid in `resolvedUids` (resolvePublishPayloadValues: a
 * list keeps its slot order, published members their uid), writing the result into `request`.
 */
async function applyResolvedRefs(
  rawReq: { listOfAttestations?: RawAttestation[] } | undefined,
  request: NormalizedRequest,
  resolvedUids: Record<string, string>,
): Promise<void> {
  const rawAtts = rawReq?.listOfAttestations ?? []
  if (!rawAtts.some(hasUnresolvedRef)) return
  const [resolved] = (await resolvePublishPayloadValues([rawReq] as any, resolvedUids)) as unknown as Array<{
    listOfAttestations: RawAttestation[]
  }>
  rawAtts.forEach((raw, j) => {
    const out = resolved?.listOfAttestations?.[j]
    if (!hasUnresolvedRef(raw) || !out || hasUnresolvedRef(out)) return
    const outData = Array.isArray(out.data) ? out.data[0]?.data : out.data?.data
    const target = request.listOfAttestations[j]?.data?.[0]
    if (target && outData != null) target.data = toBytesHex(outData)
  })
}

type PublishInput = { input: { context: PublishMachineContext; event: unknown } }

type NormalizedRequest = {
  localId: string
  /** The version row this request's Version attestation is recorded on. */
  versionLocalId?: string
  seedUid: string
  seedSchemaUid: string
  versionUid: string
  versionSchemaUid: string
  seedIsRevocable: boolean
  listOfAttestations: Array<{
    schema: string
    data: Array<{
      recipient: string
      expirationTime: bigint
      revocable: boolean
      refUID: string
      data: string
      value: bigint
    }>
    _propertyName?: string
    /** Metadata row the attested value was read from; the uid is recorded on it. */
    _metadataLocalId?: string
    /** A value the attestation carries that the row doesn't hold yet; recorded with the uid. */
    _attestedValue?: string
    _propertyNameForSchema?: string
    /** A List (bytes32[]) attestation: filled by resolving its slots, never by propertiesToUpdate. */
    _isList?: boolean
  }>
  propertiesToUpdate: Array<{ publishLocalId: string; propertySchemaUid: string }>
}

type CreateAttestationsDirectToEasResult = {
  easPayload: unknown
  publishedBatch: PublishMachineContext['publishedBatch']
}

export const createAttestationsDirectToEas = fromPromise(
  async ({ input: { context } }: PublishInput): Promise<CreateAttestationsDirectToEasResult> => {
    // Items this actor loads itself (a restored publish record carries the item as plain data)
    const loaded: IItem<any>[] = []
    try {
      return await executeCreateAttestationsDirectToEas(context, loaded)
    } finally {
      for (const item of loaded) item.unload()
    }
  },
)

async function executeCreateAttestationsDirectToEas(
  context: PublishMachineContext,
  loaded: IItem<any>[],
): Promise<CreateAttestationsDirectToEasResult> {
    const { address, account, wallet } = context
    const arweaveTransactions = context.arweaveTransactions ?? []
    const publishUploads = context.publishUploads ?? []
    let { item } = context

    if (!address || typeof address !== 'string' || !address.trim()) {
      throw new Error('No wallet address for publish. Connect a wallet and try again.')
    }

    if (!wallet && !account) {
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
      loaded.push(item)
    }

    const txCount = arweaveTransactions.length
    const uploadCount = publishUploads.length
    if (txCount !== uploadCount) {
      throw new Error(
        'Attestation recovery failed: Arweave transaction data is missing or incomplete. Delete this publish record and try a full publish from the beginning.',
      )
    }

    const publishWallet = resolvePublishWallet(context)
    const txSender = publishWallet.txSender

    await ensureEasSchemasForItem(item, publishWallet, { managedAddress: address })

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

    const normalizedRequests: NormalizedRequest[] = reqs.map((req: any) => {
      const listOfAttestations = (req?.listOfAttestations ?? []).map((att: any) => {
        const dataArr = Array.isArray(att?.data) ? att.data : []
        return {
          schema: toHex32(att?.schema),
          data: dataArr.map((d: any) => ({
            ...d,
            refUID: toHex32(d?.refUID),
            data: toBytesHex(d?.data),
          })),
          ...(typeof att?._propertyName === 'string' && att._propertyName !== ''
            ? { _propertyName: att._propertyName }
            : {}),
          ...(typeof att?._metadataLocalId === 'string' && att._metadataLocalId !== ''
            ? { _metadataLocalId: att._metadataLocalId }
            : {}),
          ...(typeof att?._attestedValue === 'string' ? { _attestedValue: att._attestedValue } : {}),
          ...(typeof att?._propertyNameForSchema === 'string' && att._propertyNameForSchema !== ''
            ? { _propertyNameForSchema: att._propertyNameForSchema }
            : {}),
          ...(isListAttestation(att) ? { _isList: true } : {}),
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

    // Requests are attested in order, each before the next: an update aimed at an earlier request
    // would never reach it (the relation stays unlinked). The publish contract reverts with
    // PublishTargetAlreadyAttested in that case (SeedPublishLib.setSeedReference); fail the same
    // way, before any attestation is sent.
    const backwards = findPropertiesToUpdateTargetingEarlierRequest(normalizedRequests)
    if (backwards) {
      const { requestIndex, targetIndex, requestLocalId, targetLocalId, propertySchemaUid } = backwards
      throw new ManagedAccountPublishError(
        `Direct EAS publish from ${address} reverted with PublishTargetAlreadyAttested(${requestIndex}, ${targetIndex}): ` +
          `request ${requestIndex} (${requestLocalId}) updates property ${propertySchemaUid} of request ${targetIndex} ` +
          `(${targetLocalId}), which is attested before it; nothing was sent.`,
        'PUBLISH_PREFLIGHT_FAILED',
        address,
      )
    }

    const byLocalId = new Map(normalizedRequests.map((r) => [r.localId, r]))
    const placeholderData = {
      recipient: ZERO_ADDRESS,
      expirationTime: BigInt(0),
      revocable: true,
      refUID: ZERO_BYTES32,
      data: ZERO_BYTES32 as `0x${string}`,
      value: BigInt(0),
    }
    for (const req of normalizedRequests) {
      for (const pu of req.propertiesToUpdate ?? []) {
        const targetId = pu.publishLocalId
        const schemaUid = toHex32(pu.propertySchemaUid)
        if (!targetId || !schemaUid) continue
        const targetReq = byLocalId.get(targetId)
        if (!targetReq?.listOfAttestations) continue
        const att = targetReq.listOfAttestations.find(
          (a) => toHex32(a?.schema)?.toLowerCase() === schemaUid?.toLowerCase(),
        )
        if (!att || att._isList) continue
        if (!Array.isArray(att.data) || att.data.length === 0) {
          att.data = [{ ...placeholderData, refUID: ZERO_BYTES32 }]
        }
      }
    }

    let lastAttestationMs = Date.now()
    const batchExtraUids: string[] = []
    /** Seed attestations this publish created, by request localId, with their attestation time. */
    const createdSeeds = new Map<string, { seedUid: string; attestationMs: number }>()
    /** Seed uid of every request with one so far, by localId: what relation/list refs resolve to. */
    const resolvedUids: Record<string, string> = {}
    for (const r of normalizedRequests) {
      if (r.localId && r.seedUid !== ZERO_BYTES32) resolvedUids[r.localId] = r.seedUid
    }

    const itemWithPersist = item as {
      seedUid?: string
      seedLocalId?: string
      persistSeedUid?: (publisher?: string, attestationCreatedAtMs?: number) => Promise<void>
    }
    const persistCreatedSeed = async (seedLocalId: string, seedUid: string, attestationMs: number) => {
      if (seedLocalId === item.seedLocalId) {
        itemWithPersist.seedUid = seedUid
        await persistSeedUidSafely(itemWithPersist, address, attestationMs)
      } else {
        await recordRelatedSeedUid({ seedLocalId, seedUid, publisherAddress: address, attestationCreatedAtMs: attestationMs })
      }
    }

    for (let i = 0; i < normalizedRequests.length; i++) {
      const request = normalizedRequests[i] as NormalizedRequest
      let newSeedUid = request.seedUid
      let newVersionUid = request.versionUid

      if (newSeedUid === ZERO_BYTES32) {
        const attestTx = prepareEasAttest({
          schema: request.seedSchemaUid as `0x${string}`,
          data: {
            refUID: ZERO_BYTES32,
            data: encodeBytes32(request.seedSchemaUid as `0x${string}`),
            revocable: request.seedIsRevocable,
          },
        })
        const result = await txSender.sendTransaction(attestTx)
        const receipt = await waitForPublishReceipt(result.transactionHash)
        if (!receipt) throw new Error('Failed to create Seed attestation')
        lastAttestationMs = await attestationMsFromReceipt(receipt)
        const { easContractAddress } = getPublishConfig()
        const seedUidFromReceipt = getAttestationUidFromReceipt(receipt, easContractAddress)
        if (!seedUidFromReceipt || seedUidFromReceipt === ZERO_BYTES32) {
          throw new Error('Failed to get Seed UID from attestation receipt')
        }
        newSeedUid = seedUidFromReceipt
        request.seedUid = seedUidFromReceipt
        if (request.localId) {
          createdSeeds.set(request.localId, { seedUid: seedUidFromReceipt, attestationMs: lastAttestationMs })
          resolvedUids[request.localId] = seedUidFromReceipt
          // Record the seed now: each attestation is its own transaction, so a later one failing
          // must not leave this seed on chain with no local row pointing at it (a retry would
          // attest a second seed for the same item).
          await persistCreatedSeed(request.localId, seedUidFromReceipt, lastAttestationMs)
        }
        batchExtraUids.push(seedUidFromReceipt)
        logger('created Seed attestation', newSeedUid)
      } else if (newSeedUid !== ZERO_BYTES32) {
        batchExtraUids.push(newSeedUid)
      }

      if (newSeedUid !== ZERO_BYTES32 && newVersionUid === ZERO_BYTES32) {
        const attestTx = prepareEasAttest({
          schema: request.versionSchemaUid as `0x${string}`,
          data: {
            refUID: newSeedUid as `0x${string}`,
            data: encodeBytes32(request.versionSchemaUid as `0x${string}`),
            revocable: true,
          },
        })
        const result = await txSender.sendTransaction(attestTx)
        const receipt = await waitForPublishReceipt(result.transactionHash)
        if (!receipt) throw new Error('Failed to create Version attestation')
        lastAttestationMs = await attestationMsFromReceipt(receipt)
        const { easContractAddress } = getPublishConfig()
        const versionUidFromReceipt = getAttestationUidFromReceipt(receipt, easContractAddress)
        if (!versionUidFromReceipt || versionUidFromReceipt === ZERO_BYTES32) {
          throw new Error('Failed to get Version UID from attestation receipt')
        }
        newVersionUid = versionUidFromReceipt
        request.versionUid = versionUidFromReceipt
        batchExtraUids.push(versionUidFromReceipt)
        await updateVersionUid({
          seedLocalId: request.localId,
          versionUid: versionUidFromReceipt,
          ...(request.versionLocalId ? { versionLocalId: request.versionLocalId } : {}),
          publisher: address,
          attestationCreatedAt: lastAttestationMs,
        })
        logger('created Version attestation', newVersionUid)
      } else if (newVersionUid !== ZERO_BYTES32) {
        batchExtraUids.push(newVersionUid)
      }

      for (const att of request.listOfAttestations) {
        for (const d of att.data) {
          d.refUID = newVersionUid
        }
      }

      // Relation and list values that name a seed of this publish by localId get its uid, as on the
      // contract path (createAttestations): requests come referenced-first, so those seeds exist.
      await applyResolvedRefs(reqs[i], request, resolvedUids)

      for (const pu of request.propertiesToUpdate ?? []) {
        const targetReq = byLocalId.get(pu.publishLocalId)
        if (!targetReq?.listOfAttestations) continue
        const schemaUid = toHex32(pu.propertySchemaUid)
        const att = targetReq.listOfAttestations.find(
          (a) => toHex32(a?.schema)?.toLowerCase() === schemaUid?.toLowerCase(),
        )
        // A list is re-encoded whole from its resolved slots (applyResolvedRefs), as the contract
        // leaves lists to the client (SeedPublishLib.setSeedReference fills single values only).
        if (!att?.data?.[0] || att._isList) continue
        att.data[0].data = encodeBytes32(newSeedUid as `0x${string}`)
      }

      const multiRequests: MultiAttestationRequest[] = request.listOfAttestations.map((att) => ({
        schema: att.schema as `0x${string}`,
        data: att.data.map((d) => ({
          recipient: (d.recipient ?? ZERO_ADDRESS) as `0x${string}`,
          expirationTime: d.expirationTime ?? 0n,
          revocable: d.revocable ?? true,
          refUID: (d.refUID ?? ZERO_BYTES32) as `0x${string}`,
          data: (d.data ?? '0x') as `0x${string}`,
          value: d.value ?? 0n,
        })),
      }))

      if (multiRequests.length > 0) {
        const multiTx = prepareEasMultiAttest(multiRequests)
        const result = await txSender.sendTransaction(multiTx)
        const receipt = await waitForPublishReceipt(result.transactionHash)
        if (!receipt) throw new Error('Failed to create property attestations')
        lastAttestationMs = await attestationMsFromReceipt(receipt)
        logger('created property attestations for request', i)
        const { easContractAddress } = getPublishConfig()
        const attested = getAttestedUidsFromReceipt(receipt, easContractAddress)
        for (const a of attested) {
          if (a.uid) batchExtraUids.push(a.uid)
        }
        const list = request.listOfAttestations
        const sameLen = attested.length === list.length
        // Relation and list values are recorded as the seed uids they attested (resolvedUids: the
        // seeds created so far, recorded on their own rows only after the loop).
        await applyPropertyAttestationUidsFromPublish({
          seedLocalId: request.localId,
          attestationCreatedAtMs: lastAttestationMs ?? null,
          versionUid: newVersionUid !== ZERO_BYTES32 ? newVersionUid : null,
          resolvedSeedUids: { ...resolvedUids },
          pairs: attested.map((a, j) => ({
            schemaUid: a.schemaUid,
            attestationUid: a.uid,
            propertyName:
              sameLen && typeof list[j]?._propertyName === 'string' && list[j]!._propertyName !== ''
                ? list[j]!._propertyName
                : undefined,
            metadataLocalId: sameLen ? list[j]?._metadataLocalId : undefined,
            value: sameLen ? list[j]?._attestedValue : undefined,
          })),
        })
      }
    }

    // The publishing item gets its own request's seed (requests are not ordered root-first: a
    // related item can be request [0]); every related item records the seed created for it.
    // Seeds created above were recorded as they were attested. An item whose seed already existed
    // still gets its seed uid set and persisted here.
    persistSeedUidFromPublishResult(itemWithPersist, normalizedRequests)
    const rootRequest =
      normalizedRequests.find((r) => r.localId === item.seedLocalId) ?? normalizedRequests[0]
    if (
      rootRequest?.seedUid &&
      rootRequest.seedUid !== ZERO_BYTES32 &&
      !(item.seedLocalId && createdSeeds.has(item.seedLocalId))
    ) {
      const rootSeedMs = createdSeeds.get(rootRequest.localId)?.attestationMs ?? lastAttestationMs
      await persistSeedUidSafely(itemWithPersist, address, rootSeedMs)
    }

    try {
      await verifyAttestations({ normalizedRequests, item })
    } catch (err) {
      if (err instanceof AttestationVerificationError) {
        throw err
      }
      logger('verifyAttestations failed (non-verification error):', err)
      throw err
    }

    logger('direct EAS publish complete')

    void enqueueArweaveL1FinalizeJobsFromPublishContext(context)

    try {
      // The item's co-publish rows and those of the related drafts published with it.
      const { clearHtmlEmbeddedImageCoPublishRows } = await import('@seedprotocol/sdk')
      const published = new Set<string>([item.seedLocalId])
      for (const r of normalizedRequests) if (r?.localId) published.add(r.localId)
      for (const seedLocalId of published) await clearHtmlEmbeddedImageCoPublishRows(seedLocalId)
    } catch {
      /* best-effort cleanup */
    }

    const { collectPublishedBatch } = await import('../../publishedBy/collectBatchUids')
    const rootReq = rootRequest
    const publishedBatch = rootReq?.seedUid
      ? collectPublishedBatch({
          seedUid: String(rootReq.seedUid),
          versionUid: rootReq.versionUid ? String(rootReq.versionUid) : undefined,
          extraUids: batchExtraUids,
        })
      : null

    return { easPayload: requestData, publishedBatch }
}
