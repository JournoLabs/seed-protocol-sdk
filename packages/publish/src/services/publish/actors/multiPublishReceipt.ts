import { getAttestedUidsFromReceipt } from '~/helpers/easDirect'
import { toHex32Normalized } from './seedUidHelpers'
import { ZERO_BYTES32 } from './utils'

type ReceiptLike = {
  logs?: Array<{ address?: string; data?: string; topics?: unknown[] }>
}

/** The fields of a normalized multiPublish request this module reads. */
export type MultiPublishRequestLike = {
  localId?: string
  /** The version row a Version attestation this request creates is recorded on. */
  versionLocalId?: string
  seedUid?: string
  seedSchemaUid?: string
  versionUid?: string
  versionSchemaUid?: string
  listOfAttestations?: Array<{
    schema?: string
    data?: unknown[]
    _propertyName?: string
    _metadataLocalId?: string
    _attestedValue?: string
  }>
}

export type AttributedPropertyPair = {
  schemaUid: string
  attestationUid: string
  propertyName?: string
  /** The metadata row whose value was attested. */
  metadataLocalId?: string
  /** A value the attestation carries that the row doesn't hold yet. */
  value?: string
}

/** What one request of a multiPublish transaction created. */
export type RequestAttestations = {
  /** Seed attestation created for the request (only when it had no seed uid). */
  seedUid?: string
  /** Version attestation created for the request (only when it had no version uid). */
  versionUid?: string
  propertyPairs: AttributedPropertyPair[]
}

const isZero = (uid: string | undefined): boolean =>
  !uid || toHex32Normalized(uid) === ZERO_BYTES32

const sameSchema = (a: string | undefined, b: string | undefined): boolean =>
  !!a && !!b && toHex32Normalized(a) === toHex32Normalized(b)

/** Property attestations EAS creates for one request: one per data entry of each list entry. */
type PropertySlot = { schema?: string; propertyName?: string; metadataLocalId?: string; value?: string }

function expandPropertySlots(req: MultiPublishRequestLike): PropertySlot[] {
  const out: PropertySlot[] = []
  for (const att of req.listOfAttestations ?? []) {
    const count = Array.isArray(att?.data) ? att.data.length : 1
    const propertyName =
      typeof att?._propertyName === 'string' && att._propertyName !== '' ? att._propertyName : undefined
    const metadataLocalId =
      typeof att?._metadataLocalId === 'string' && att._metadataLocalId !== ''
        ? att._metadataLocalId
        : undefined
    const value = typeof att?._attestedValue === 'string' ? att._attestedValue : undefined
    for (let k = 0; k < count; k++) out.push({ schema: att?.schema, propertyName, metadataLocalId, value })
  }
  return out
}

/**
 * Splits a multiPublish receipt into what each request created, in request order, from the
 * `Attested` events of `attester` on the configured EAS. Those are the record: the receipt of a
 * bundle transaction can hold other senders' UserOps, and any contract can call the shared executor
 * as an account and have it emit `CreatedAttestation` and `SeedPublished` with UIDs of its choosing.
 *
 * `Attested` names no request, but the contract works in a fixed order (SeedProtocolExecutor /
 * SeedProtocolExtension `multiPublish`): every request's seed and version, then every request's
 * properties. So the events are walked in that order, each one matched to its slot by schema.
 */
export function attributeMultiPublishReceipt(params: {
  receipt: ReceiptLike
  requests: MultiPublishRequestLike[]
  easContractAddress: string
  attester: string
}): RequestAttestations[] {
  const { receipt, requests, easContractAddress, attester } = params
  const attested = getAttestedUidsFromReceipt(receipt, easContractAddress, attester)

  let next = 0
  const take = (schemaUid: string | undefined): string | undefined => {
    for (let i = next; i < attested.length; i++) {
      if (sameSchema(attested[i]!.schemaUid, schemaUid)) {
        next = i + 1
        return attested[i]!.uid
      }
    }
    return undefined
  }

  const out = requests.map((req): RequestAttestations => {
    const created: RequestAttestations = { propertyPairs: [] }
    if (isZero(req.seedUid)) created.seedUid = take(req.seedSchemaUid)
    if (isZero(req.versionUid)) created.versionUid = take(req.versionSchemaUid)
    return created
  })

  requests.forEach((req, i) => {
    for (const slot of expandPropertySlots(req)) {
      const attestationUid = take(slot.schema)
      if (!attestationUid || !slot.schema) continue
      out[i]!.propertyPairs.push({
        schemaUid: slot.schema,
        attestationUid,
        ...(slot.propertyName ? { propertyName: slot.propertyName } : {}),
        ...(slot.metadataLocalId ? { metadataLocalId: slot.metadataLocalId } : {}),
        ...(slot.value !== undefined ? { value: slot.value } : {}),
      })
    }
  })
  return out
}
