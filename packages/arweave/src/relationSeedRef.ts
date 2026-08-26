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

const LOCAL_SEED_REF = /^[a-zA-Z0-9_-]{10,21}$/

export function resolveSeedIdsFromRefString(s: string): {
  seedLocalId?: string
  seedUid?: string
} {
  const fromCorrect = parseLocalIdOrUid(s)
  if (fromCorrect.localId || fromCorrect.uid) {
    return { seedLocalId: fromCorrect.localId, seedUid: fromCorrect.uid }
  }
  if (LOCAL_SEED_REF.test(s) && !s.startsWith('0x')) {
    return { seedLocalId: s }
  }
  return {}
}
