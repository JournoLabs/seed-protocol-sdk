/** Same rules as getCorrectId in helpers/index (avoid barrel circular import). */
function parseLocalIdOrUid(localIdOrUid: string): { localId?: string; uid?: string } {
  const id = { localId: undefined as string | undefined, uid: undefined as string | undefined }
  if (!localIdOrUid) return id
  if (localIdOrUid.length === 10) {
    id.localId = localIdOrUid
  }
  if (localIdOrUid.startsWith('0x') && localIdOrUid.length === 66) {
    id.uid = localIdOrUid
  }
  return id
}

/** Relation/image refs may be string ids or `{ seedLocalId?, seedUid? }`. */
export function normalizeRelationPropertyValue(value: unknown): string | undefined {
  if (value == null) return undefined
  if (typeof value === 'string') {
    const t = value.trim()
    return t !== '' ? t : undefined
  }
  if (typeof value === 'object' && value !== null) {
    const o = value as { seedLocalId?: string; seedUid?: string }
    if (typeof o.seedLocalId === 'string' && o.seedLocalId.trim() !== '') {
      return o.seedLocalId.trim()
    }
    if (typeof o.seedUid === 'string' && o.seedUid.trim() !== '') {
      return o.seedUid.trim()
    }
  }
  return undefined
}

/** getCorrectId only accepts 10-char local ids and 0x66 uids; local seed refs can be up to 21 chars. */
const LOCAL_SEED_REF = /^[a-zA-Z0-9_-]{10,21}$/

/** Resolve seed ids from a single string (context propertyValue or DB row). */
export function resolveSeedIdsFromRefString(s: string): { seedLocalId?: string; seedUid?: string } {
  const fromCorrect = parseLocalIdOrUid(s)
  if (fromCorrect.localId || fromCorrect.uid) {
    return { seedLocalId: fromCorrect.localId, seedUid: fromCorrect.uid }
  }
  if (LOCAL_SEED_REF.test(s) && !s.startsWith('0x')) {
    return { seedLocalId: s }
  }
  return {}
}

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
