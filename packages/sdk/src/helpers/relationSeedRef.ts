import { normalizeRelationPropertyValue, resolveSeedIdsFromRefString } from '@seedprotocol/arweave'

/**
 * True when a relation ref is an attested seed uid (0x…) rather than a local id. A uid only exists once
 * the seed is on EAS, so publish can attest the uid as-is when no local copy exists (e.g. a server
 * publishing on someone's behalf that only holds the uids it was given). Callers must not walk into it.
 */
export function isPublishedSeedRef(value: unknown): boolean {
  const ref = normalizeRelationPropertyValue(value)
  if (!ref) return false
  const { seedLocalId, seedUid } = resolveSeedIdsFromRefString(ref)
  return !!seedUid && !seedLocalId
}

/**
 * Storage seed local id (nanoid) or 0x uid. Stricter than resolveSeedIdsFromRefString, which accepts
 * any 10-char string (so a 10-char html snippet like "<p>raw</p>" would pass as a local id).
 */
const STORAGE_SEED_REF = /^(?:[A-Za-z0-9_-]{10,21}|0x[0-9a-fA-F]{64})$/

/** True when a File/Image/Html value is already a storage seed reference rather than raw content. */
export function isStorageSeedRef(value: unknown): boolean {
  return typeof value === 'string' && STORAGE_SEED_REF.test(value.trim())
}
