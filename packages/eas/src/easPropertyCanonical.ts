/**
 * When multiple property attestations exist for the same Version (refUID) and schema
 * (e.g. after a same-Version patch publish), the canonical value is the **newest**
 * non-revoked attestation: greatest `timeCreated` per `(refUID, schemaId)`.
 * Revoked attestations are ignored, even when they are newer. On equal `timeCreated`
 * the first one in input order wins; a missing `timeCreated` counts as 0.
 *
 * Use this after `getItemPropertiesFromEas` (or any flat list) before displaying
 * values or writing to DB so duplicate schemas resolve to one row.
 */
export type AttestationLikeForCanonical = {
  schemaId?: string | null
  timeCreated?: number | null
  refUID?: string | null
  revoked?: boolean | null
}

export type PickLatestPropertyAttestationsOptions = {
  /**
   * What to return for a `(refUID, schemaId)` whose attestations are **all** revoked.
   * - `'omit'` (default): nothing; the property has no canonical attestation.
   * - `'newestRevoked'`: the newest revoked attestation. Sync uses this so a fully
   *   revoked (unpublished) item keeps its last values locally, alongside the seed row
   *   that records `revokedAt`.
   */
  ifAllRevoked?: 'omit' | 'newestRevoked'
}

const pickNewestPerKey = <T extends AttestationLikeForCanonical>(
  attestations: T[],
): Map<string, T> => {
  const byKey = new Map<string, T>()
  for (const att of attestations) {
    const sid = att.schemaId
    if (!sid) continue
    const key = `${att.refUID ?? ''}:${sid}`
    const existing = byKey.get(key)
    const t = att.timeCreated ?? 0
    const t0 = existing?.timeCreated ?? 0
    if (!existing || t > t0) {
      byKey.set(key, att)
    }
  }
  return byKey
}

export function pickLatestPropertyAttestationsByRefAndSchema<
  T extends AttestationLikeForCanonical,
>(attestations: T[], options?: PickLatestPropertyAttestationsOptions): T[] {
  const live = pickNewestPerKey(attestations.filter((att) => !att.revoked))
  if (options?.ifAllRevoked !== 'newestRevoked') {
    return [...live.values()]
  }
  const revoked = pickNewestPerKey(attestations.filter((att) => att.revoked))
  for (const [key, att] of revoked) {
    if (!live.has(key)) live.set(key, att)
  }
  return [...live.values()]
}
