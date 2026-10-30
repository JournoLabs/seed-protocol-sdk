import { decodeEasNumber, isEasEmptyValue, isNumericEasType } from '@seedprotocol/eas'
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

/** A seed's assembled record and the property attestations it was assembled from. */
export type SeedAttestations = {
  /** Assembled with `relations: 'uids'` and no storage hydration. */
  readonly record: SeedRecord
  readonly properties: readonly SeedPropertyAttestation[]
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
  const value = valueOf(type, raw)
  if (value === undefined) return null
  return {
    attestationUid: property.id,
    schemaUid: property.schemaId,
    easName: name,
    easType: type,
    value,
    isRelation: isRelationProperty(name, type),
    attester: property.attester,
    timeCreated: property.timeCreated,
  }
}
