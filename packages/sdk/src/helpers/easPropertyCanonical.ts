/**
 * When multiple property attestations exist for the same Version (refUID) and schema
 * (e.g. after a same-Version patch publish), the canonical value is the **newest**
 * non-revoked attestation: greatest `timeCreated` per `(refUID, schemaId)`.
 *
 * Use this after `getItemPropertiesFromEas` (or any flat list) before displaying
 * values or writing to DB so duplicate schemas resolve to one row.
 */
export type AttestationLikeForCanonical = {
  schemaId?: string | null
  timeCreated?: number | null
  refUID?: string | null
}

export function pickLatestPropertyAttestationsByRefAndSchema<
  T extends AttestationLikeForCanonical,
>(attestations: T[]): T[] {
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
  return [...byKey.values()]
}
