import { updateVersionUid } from '@seedprotocol/sdk'
import { attestationMsFromReceipt } from '../helpers/receiptAttestationMs'
import { uidsFromSeedPublished, versionUidFromCreatedAttestationEvents } from './seedUidHelpers'
import { toHex32 } from './publishRequestNormalize'
import { ZERO_BYTES32 } from './utils'

type ReceiptLike = {
  blockNumber?: bigint
  logs?: Array<{ address?: string; data?: string; topics?: unknown[] }>
}

/**
 * Records the Version attestation a publish created. A request that already carried a version uid
 * (a patch publish) created none: the modular executor's SeedPublished event still reports that
 * existing version, which must not be recorded as a new one (see updateVersionUid).
 */
export async function persistVersionUidFromPublishReceipt(params: {
  receipt: ReceiptLike
  seedLocalId: string | undefined
  /** The request's versionUid; non-zero when the publish attached to an existing version. */
  requestVersionUid?: string
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
    requestVersionUid,
  } = params
  if (!seedLocalId) return
  if (requestVersionUid && toHex32(requestVersionUid) !== ZERO_BYTES32) return
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
  const attMs = await attestationMsFromReceipt(receipt)
  await updateVersionUid({
    seedLocalId,
    versionUid,
    publisher: publisherAddress,
    attestationCreatedAt: attMs,
  })
}
