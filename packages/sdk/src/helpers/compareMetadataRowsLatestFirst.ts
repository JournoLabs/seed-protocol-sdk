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

type PropertyGroupRow = { propertyId?: number | null; propertyName?: string | null; seedLocalId?: string | null }

/**
 * One key per property for grouping rows (decision D4): `#<property_id>`. A row with no property_id
 * takes the id of a row of the same seed stored under the same name (a row written before writers
 * set it, beside newer ones), else its stored name.
 */
export function metadataPropertyGroupKeys<T extends PropertyGroupRow>(rows: readonly T[]): (row: T) => string {
  const idByName = new Map<string, number>()
  for (const row of rows) {
    if (row.propertyId != null && row.propertyName) idByName.set(`${row.seedLocalId ?? ''}\u0000${row.propertyName}`, row.propertyId)
  }
  return (row) => {
    if (row.propertyId != null) return `#${row.propertyId}`
    const sibling = idByName.get(`${row.seedLocalId ?? ''}\u0000${row.propertyName ?? ''}`)
    return sibling != null ? `#${sibling}` : (row.propertyName ?? '')
  }
}

/** SQL form of metadataPropertyGroupKeys over the metadata table's columns. */
export const METADATA_PROPERTY_GROUP_KEY_SQL = `COALESCE('#' || property_id, (
  SELECT '#' || sibling.property_id FROM metadata sibling
  WHERE sibling.seed_local_id = metadata.seed_local_id AND sibling.property_name = metadata.property_name
    AND sibling.property_id IS NOT NULL
  LIMIT 1
), property_name)`

/**
 * The row readers show for each property (first by {@link compareMetadataRowsLatestFirst}). Rows
 * group by property as {@link metadataPropertyGroupKeys} keys them.
 */
export function pickLatestMetadataRowPerProperty<
  T extends MetadataRecencyRow & PropertyGroupRow,
>(rows: readonly T[]): T[] {
  const groupKey = metadataPropertyGroupKeys(rows)
  const latestByProperty = new Map<string, T>()
  for (const row of rows) {
    if (!row.propertyName) continue
    const key = groupKey(row)
    const existing = latestByProperty.get(key)
    if (!existing || compareMetadataRowsLatestFirst(row, existing) < 0) {
      latestByProperty.set(key, row)
    }
  }
  return Array.from(latestByProperty.values())
}
