/**
 * Canonical "latest metadata row first" ordering, the one readers use to pick a property's value
 * from its rows across versions:
 *
 * 1. Live rows (`revoked_at IS NULL`) before revoked ones. A synced row with `revoked_at` set is
 *    kept only because every attestation of that property on its version is revoked (ADR 0006);
 *    it must not hide a live value from another version, but is still the value to show when no
 *    live row is left (an unpublished item keeps its last values). Local drafts (no uid) are live.
 * 2. Newest first: `COALESCE(attestation_created_at, created_at)`.
 * 3. Tie-break on `local_id`, descending.
 *
 * {@link METADATA_LATEST_FIRST_ORDER_SQL} is the same ordering in SQL. SQL that can't take a
 * fragment (e.g. liveQuery tagged templates, where every interpolation is a bound value) spells it
 * out; keep those in sync.
 */
export const METADATA_LATEST_FIRST_ORDER_SQL =
  '(revoked_at IS NOT NULL), COALESCE(attestation_created_at, created_at) DESC, local_id DESC'

export type MetadataRecencyRow = {
  attestationCreatedAt?: number | null
  createdAt?: number | null
  localId?: string | null
  revokedAt?: number | null
}

export function metadataLatestFirstSortKey(row: MetadataRecencyRow): {
  revoked: boolean
  t: number
  localId: string
} {
  return {
    revoked: row.revokedAt != null,
    t: row.attestationCreatedAt ?? row.createdAt ?? 0,
    localId: String(row.localId ?? ''),
  }
}

/** Sort comparator: live before revoked; then larger time first; on tie, larger localId (lexicographic) first. */
export function compareMetadataRowsLatestFirst(a: MetadataRecencyRow, b: MetadataRecencyRow): number {
  const ka = metadataLatestFirstSortKey(a)
  const kb = metadataLatestFirstSortKey(b)
  if (ka.revoked !== kb.revoked) return ka.revoked ? 1 : -1
  if (kb.t !== ka.t) return kb.t - ka.t
  return kb.localId.localeCompare(ka.localId)
}

/** The row readers show for each property name (first by {@link compareMetadataRowsLatestFirst}). */
export function pickLatestMetadataRowPerProperty<
  T extends MetadataRecencyRow & { propertyName?: string | null },
>(rows: readonly T[]): T[] {
  const latestByProperty = new Map<string, T>()
  for (const row of rows) {
    if (!row.propertyName) continue
    const existing = latestByProperty.get(row.propertyName)
    if (!existing || compareMetadataRowsLatestFirst(row, existing) < 0) {
      latestByProperty.set(row.propertyName, row)
    }
  }
  return Array.from(latestByProperty.values())
}
