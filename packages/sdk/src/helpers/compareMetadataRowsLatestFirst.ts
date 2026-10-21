/**
 * Canonical "latest metadata row first" ordering, the one readers use to pick a property's value
 * from its rows across versions:
 *
 * 1. Newest first: `COALESCE(attestation_created_at, created_at)`. A revoked row counts like any
 *    other. Sync keeps one attestation per version and property schema (the newest live one, else
 *    the newest revoked one, ADR 0006), so a revoked row is the newest only when its whole version
 *    has none live: on a live seed that is a retraction, stored with no value, and an earlier
 *    version's value must not show through it (ADR 0021); on an unpublished seed every row is
 *    revoked and keeps its last value.
 * 2. Tie-break on `local_id`, descending.
 *
 * {@link METADATA_LATEST_FIRST_ORDER_SQL} is the same ordering in SQL. SQL that can't take a
 * fragment (e.g. liveQuery tagged templates, where every interpolation is a bound value) spells it
 * out; keep those in sync.
 */
export const METADATA_LATEST_FIRST_ORDER_SQL =
  'COALESCE(attestation_created_at, created_at) DESC, local_id DESC'

export type MetadataRecencyRow = {
  attestationCreatedAt?: number | null
  createdAt?: number | null
  localId?: string | null
  revokedAt?: number | null
}

export function metadataLatestFirstSortKey(row: MetadataRecencyRow): {
  t: number
  localId: string
} {
  return {
    t: row.attestationCreatedAt ?? row.createdAt ?? 0,
    localId: String(row.localId ?? ''),
  }
}

/** Sort comparator: larger time first; on tie, larger localId (lexicographic) first. */
export function compareMetadataRowsLatestFirst(a: MetadataRecencyRow, b: MetadataRecencyRow): number {
  const ka = metadataLatestFirstSortKey(a)
  const kb = metadataLatestFirstSortKey(b)
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
