import { applyPropertyAttestationUidsFromPublish, Item, updateVersionUid } from '@seedprotocol/sdk'
import debug from 'debug'
import { getPublishConfig } from '~/config'
import { attestationMsFromReceipt } from '../helpers/receiptAttestationMs'
import {
  attributeMultiPublishReceipt,
  type MultiPublishRequestLike,
  type RequestAttestations,
} from './multiPublishReceipt'
import { persistSeedUidSafely } from './persistSeedUid'
import { toHex32 } from './publishRequestNormalize'
import { ZERO_BYTES32 } from './utils'

const logger = debug('seedProtocol:services:publish:actors:recordMultiPublishReceipt')

type ReceiptLike = {
  blockNumber?: bigint
  logs?: Array<{ address?: string; data?: string; topics?: unknown[] }>
}

const isZero = (uid: string | undefined): boolean => !uid || toHex32(uid) === ZERO_BYTES32
const nonZero = (uid: string | undefined): string | undefined => (isZero(uid) ? undefined : toHex32(uid))

/**
 * Records locally what one multiPublish transaction attested, for every request in it (the item
 * being published and the related items published with it), each matched to its own events:
 * - the Version attestation it created (updateVersionUid). A request that carried a version uid (a
 *   patch publish) created none: the executor's SeedPublished still reports that existing version,
 *   which must not be recorded as a new one.
 * - its property attestation uids, on that version (applyPropertyAttestationUidsFromPublish).
 * - the Seed attestation it created, for related items (the item being published, `rootSeedLocalId`,
 *   is left to the caller: createAttestations assigns it to the publishing item and persists it).
 *
 * Returns the requests with the seed and version uids this transaction created filled in.
 */
export async function recordMultiPublishReceipt<R extends MultiPublishRequestLike>(params: {
  receipt: ReceiptLike
  /** The normalized requests, in the order they were sent. */
  requests: R[]
  rootSeedLocalId: string | undefined
  useModularExecutor: boolean
  contractAddressForEvents: string
  publisherAddress: string
}): Promise<{ requests: R[]; attributed: RequestAttestations[] }> {
  const { receipt, requests, rootSeedLocalId, useModularExecutor, contractAddressForEvents, publisherAddress } =
    params
  const { easContractAddress } = getPublishConfig()
  const attributed = attributeMultiPublishReceipt({
    receipt,
    requests,
    useModularExecutor,
    easContractAddress,
    contractAddressForEvents,
  })
  const attMs = await attestationMsFromReceipt(receipt)

  for (let i = 0; i < requests.length; i++) {
    const req = requests[i]!
    const versionUid = attributed[i]!.versionUid
    if (!req.localId || !isZero(req.versionUid) || isZero(versionUid)) continue
    await updateVersionUid({
      seedLocalId: req.localId,
      versionUid: toHex32(versionUid),
      publisher: publisherAddress,
      attestationCreatedAt: attMs,
    })
  }

  // Each request's property uids, against the version it attested under: its own version uid (a
  // patch publish), or the version this transaction created for it.
  for (let i = 0; i < requests.length; i++) {
    const req = requests[i]!
    const { propertyPairs, versionUid } = attributed[i]!
    if (!req.localId || !propertyPairs.length) continue
    await applyPropertyAttestationUidsFromPublish({
      seedLocalId: req.localId,
      attestationCreatedAtMs: attMs ?? null,
      versionUid: nonZero(req.versionUid) ?? nonZero(versionUid) ?? null,
      pairs: propertyPairs,
    })
  }

  for (let i = 0; i < requests.length; i++) {
    const req = requests[i]!
    const seedUid = attributed[i]!.seedUid
    if (!req.localId || req.localId === rootSeedLocalId || !isZero(req.seedUid) || isZero(seedUid)) {
      continue
    }
    await recordRelatedSeedUid({
      seedLocalId: req.localId,
      seedUid: seedUid!,
      publisherAddress,
      attestationCreatedAtMs: attMs,
    })
  }

  return {
    attributed,
    requests: requests.map((req, i) => {
      const { seedUid, versionUid } = attributed[i]!
      return {
        ...req,
        ...(isZero(req.seedUid) && !isZero(seedUid) ? { seedUid } : {}),
        ...(isZero(req.versionUid) && !isZero(versionUid) ? { versionUid } : {}),
      }
    }),
  }
}

/**
 * Records the Seed attestation a publish created for a related item (one published together with the
 * item being published) on that item. Best-effort: the attestation is already on-chain.
 */
export async function recordRelatedSeedUid(params: {
  seedLocalId: string
  seedUid: string
  publisherAddress: string
  attestationCreatedAtMs?: number
}): Promise<void> {
  const { seedLocalId, seedUid, publisherAddress, attestationCreatedAtMs } = params
  try {
    const related = await Item.find({ seedLocalId } as Parameters<typeof Item.find>[0])
    if (!related) {
      logger('related item %s not found; its seed uid is not recorded', seedLocalId)
      return
    }
    ;(related as { seedUid?: string }).seedUid = seedUid
    await persistSeedUidSafely(related, publisherAddress, attestationCreatedAtMs)
  } catch (err) {
    logger('recording seed uid of related item %s failed: %O', seedLocalId, err)
  }
}
