import { decodeEasNumber, isEasEmptyValue, isNumericEasType, isUnfilledReference } from '@seedprotocol/eas'
import { isRelationProperty } from './listRelationKey.js'
import { parseEasPropertyMetadata } from './parseEasPropertyMetadata.js'
import type { AttestationLike, SeedRecord } from './types.js'

/** One property attestation of a seed's head Version, as attested: EAS field name, type and value. */
export type SeedPropertyAttestation = {
  readonly attestationUid: string
  /** The one-field EAS schema the attestation uses (`<easType> <easName>`). */
  readonly schemaUid: string
  /** EAS field name, e.g. `title`, `author_identity_id`. */
  readonly easName: string
  /** EAS field type, e.g. `string`, `bytes32`, `bytes32[]`, `bool`, `uint256`. */
  readonly easType: string
  /**
   * The value: a decimal string for integer types (ADR 0010), a boolean for `bool`, a string array
   * for array types, otherwise the attested string.
   */
  readonly value: string | boolean | readonly string[]
  /** Whether the value names other seeds by uid (the rule assembly uses for relations). */
  readonly isRelation: boolean
  readonly attester?: string
  readonly timeCreated: number
}

/** One of a seed's Versions. */
export type SeedVersionAttestation = {
  readonly attestationUid: string
  readonly attester?: string
  readonly timeCreated: number
}

/** A seed's assembled record, the property attestations it was assembled from, and its Versions. */
export type SeedAttestations = {
  /** Assembled with `relations: 'uids'` and no storage hydration. */
  readonly record: SeedRecord
  readonly properties: readonly SeedPropertyAttestation[]
  /**
   * The seed attester's live Versions up to the record's Version, oldest first; the last is
   * `record.versionUid`. Revoked Versions are left out.
   */
  readonly versions: readonly SeedVersionAttestation[]
}

const sameAddress = (a: string | undefined, b: string | undefined): boolean =>
  (a ?? '').toLowerCase() === (b ?? '').toLowerCase()

/** `record`'s Versions from `versions` (any seeds, revoked ones included), as SeedAttestations.versions. */
export function versionHistory(
  record: SeedRecord,
  seed: AttestationLike | undefined,
  versions: readonly AttestationLike[],
): SeedVersionAttestation[] {
  const seedUid = record.seedUid.toLowerCase()
  const live = versions.filter(
    (v) => v.refUID.toLowerCase() === seedUid && v.revoked !== true && sameAddress(v.attester, seed?.attester),
  )
  const head = live.find((v) => v.id.toLowerCase() === record.versionUid.toLowerCase())
  if (!head) return []
  return [
    ...live
      .filter((v) => v !== head && v.timeCreated <= head.timeCreated)
      .sort((a, b) => a.timeCreated - b.timeCreated || a.id.localeCompare(b.id)),
    head,
  ].map((v) => ({ attestationUid: v.id, attester: v.attester, timeCreated: v.timeCreated }))
}

function valueOf(easType: string | undefined, raw: unknown): SeedPropertyAttestation['value'] | undefined {
  if (Array.isArray(raw)) return raw.map((v) => String(v))
  if (easType === 'bool') return raw === true || raw === 'true'
  if (isNumericEasType(easType)) return decodeEasNumber(raw)
  if (typeof raw === 'string') return raw
  return raw === undefined || raw === null ? undefined : JSON.stringify(raw)
}

/**
 * The property attestation as attested, or null when it can't be read or is a removed value
 * (ADR 0021), which assembly leaves out of the record too.
 */
export function toSeedPropertyAttestation(property: AttestationLike): SeedPropertyAttestation | null {
  const parsed = parseEasPropertyMetadata(property.decodedDataJson)
  if (!parsed.ok) return null
  const { name, type, value: raw } = parsed.metadata
  if (!name || !type) return null
  if (isEasEmptyValue(type, raw)) return null
  const isRelation = isRelationProperty(name, type)
  // An unfilled reference slot names no seed: left out, as assembly leaves it out of the record
  if (isRelation && isUnfilledReference(raw)) return null
  const value = valueOf(type, isRelation && Array.isArray(raw) ? raw.filter((v) => !isUnfilledReference(v)) : raw)
  if (value === undefined) return null
  return {
    attestationUid: property.id,
    schemaUid: property.schemaId,
    easName: name,
    easType: type,
    value,
    isRelation,
    attester: property.attester,
    timeCreated: property.timeCreated,
  }
}
