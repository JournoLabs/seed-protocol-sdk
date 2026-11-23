import { recordPublishRequests } from '@seedprotocol/sdk'
import { LICENSE_OFFER_SCHEMA_UID } from '@seedprotocol/eas'
import { getPublishConfig } from '~/config'
import { getAttestedUidsFromReceipt, ZERO_BYTES32 } from '~/helpers/easDirect'
import { attestationMsFromReceipt } from '../helpers/receiptAttestationMs'

/** The transactions a direct EAS publish sends for each request. */
export type DirectAttestationStep = 'seed' | 'version' | 'properties'

/** What one direct EAS transaction attests, as kept on its attempt to record it from a receipt. */
export type DirectAttestationTarget = {
  localId: string
  /** The version row a Version attestation is recorded on. */
  versionLocalId?: string
  /** The Version the properties attest under. */
  versionUid?: string
  /** Each entry of the `multiAttest`, in order. */
  properties?: Array<{ _propertyName?: string; _metadataLocalId?: string; _attestedValue?: string }>
  /** Seed uids so far, by local id, for relation and list values. */
  resolvedSeedUids?: Record<string, string>
  /** The transaction also attests a license offer (ADR 0037), after the properties. */
  licenseOffer?: boolean
}

type ReceiptLike = Parameters<typeof attestationMsFromReceipt>[0] &
  Parameters<typeof getAttestedUidsFromReceipt>[0]

/**
 * Records what one direct EAS transaction attested, from its receipt, and ends its attempt in the
 * same database transaction. Throwing leaves the attempt open, so a retry records it again without
 * sending.
 * @returns the attestation uids in log order, and the transaction's time
 */
export async function recordDirectAttestation(params: {
  step: DirectAttestationStep
  target: DirectAttestationTarget
  receipt: ReceiptLike
  attester: string
  publisher: string
  attemptId: string
}): Promise<{ uids: string[]; attestationMs: number; licenseOfferUid?: string }> {
  const { step, target, receipt, attester, publisher, attemptId } = params
  const all = getAttestedUidsFromReceipt(receipt, getPublishConfig().easContractAddress, attester)
  const isOffer = (a: { schemaUid: string }) =>
    !!target.licenseOffer && a.schemaUid.toLowerCase() === LICENSE_OFFER_SCHEMA_UID.toLowerCase()
  const licenseOfferUid = all.find(isOffer)?.uid
  // The offer is not a property: the rest are matched to the properties.
  const attested = all.filter((a) => !isOffer(a))
  const attestationMs = await attestationMsFromReceipt(receipt)
  const uids = all.map((a) => a.uid)
  const first = uids[0]
  if (step !== 'properties' && (!first || first === ZERO_BYTES32)) {
    throw new Error(`Failed to get ${step === 'seed' ? 'Seed' : 'Version'} UID from attestation receipt`)
  }

  const { localId: seedLocalId, versionLocalId, versionUid, properties: list = [], resolvedSeedUids = {} } = target
  const sameLen = attested.length === list.length
  await recordPublishRequests(
    [
      step === 'seed'
        ? { seed: { seedLocalId, seedUid: first!, publisher, attestationCreatedAt: attestationMs } }
        : step === 'version'
          ? {
              version: {
                seedLocalId,
                versionUid: first!,
                ...(versionLocalId ? { versionLocalId } : {}),
                publisher,
                attestationCreatedAt: attestationMs,
              },
            }
          : {
              properties: {
                seedLocalId,
                attestationCreatedAtMs: attestationMs,
                versionUid: versionUid && versionUid !== ZERO_BYTES32 ? versionUid : null,
                // Relation and list values are recorded as the seed uids they attested.
                resolvedSeedUids,
                publisher,
                pairs: attested.map((a, j) => ({
                  schemaUid: a.schemaUid,
                  attestationUid: a.uid,
                  propertyName: (sameLen && list[j]?._propertyName) || undefined,
                  metadataLocalId: sameLen ? list[j]?._metadataLocalId : undefined,
                  value: sameLen ? list[j]?._attestedValue : undefined,
                })),
              },
            },
    ],
    { attemptId },
  )
  return { uids, attestationMs, ...(licenseOfferUid ? { licenseOfferUid } : {}) }
}
