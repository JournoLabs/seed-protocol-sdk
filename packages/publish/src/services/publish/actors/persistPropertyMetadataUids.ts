import { applyPropertyAttestationUidsFromPublish } from '@seedprotocol/sdk'
import debug from 'debug'
import { getPublishConfig } from '~/config'
import { attestationMsFromReceipt } from '../helpers/receiptAttestationMs'
import { attributeMultiPublishReceipt, type MultiPublishRequestLike } from './multiPublishReceipt'
import { toHex32 } from './publishRequestNormalize'
import { ZERO_BYTES32 } from './utils'

const logger = debug('seedProtocol:services:publish:actors:persistPropertyMetadataUids')

type ReceiptLike = {
  blockNumber?: bigint
  logs?: Array<{ address?: string; data?: string; topics?: unknown[] }>
}

const nonZero = (uid: string | undefined): string | undefined =>
  uid && toHex32(uid) !== ZERO_BYTES32 ? toHex32(uid) : undefined

/**
 * Records each request's property attestation uids on its metadata rows, against the version the
 * request attested under (its own version uid, or the version this transaction created for it).
 * Every request is matched to its own events (attributeMultiPublishReceipt), so a batch of several
 * items never gives one item another's version or property uids.
 */
export async function persistPropertyMetadataUidsFromContractReceipt(params: {
  receipt: ReceiptLike
  normalizedRequests: Array<MultiPublishRequestLike & { localId?: string }>
  useModularExecutor: boolean
  contractAddressForEvents: string
}): Promise<void> {
  const { receipt, normalizedRequests, useModularExecutor, contractAddressForEvents } = params
  const { easContractAddress } = getPublishConfig()
  const perRequest = attributeMultiPublishReceipt({
    receipt,
    requests: normalizedRequests,
    useModularExecutor,
    easContractAddress,
    contractAddressForEvents,
  })
  if (!perRequest.some((r) => r.propertyPairs.length)) {
    logger('no property attestation pairs')
    return
  }
  const attMs = await attestationMsFromReceipt(receipt)
  for (let i = 0; i < normalizedRequests.length; i++) {
    const req = normalizedRequests[i]!
    const { propertyPairs, versionUid } = perRequest[i]!
    if (!req.localId || !propertyPairs.length) continue
    await applyPropertyAttestationUidsFromPublish({
      seedLocalId: req.localId,
      attestationCreatedAtMs: attMs ?? null,
      versionUid: nonZero(req.versionUid) ?? nonZero(versionUid) ?? null,
      pairs: propertyPairs,
    })
  }
}
