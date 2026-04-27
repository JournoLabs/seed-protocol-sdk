/**
 * Canonical "latest metadata row first" ordering. Must stay in sync with SQL that uses:
 * `ORDER BY COALESCE(attestation_created_at, created_at) DESC, local_id DESC`
 */

export type MetadataRecencyRow = {
  attestationCreatedAt?: number | null
  createdAt?: number | null
  localId?: string | null
}

export function metadataLatestFirstSortKey(row: MetadataRecencyRow): { t: number; localId: string } {
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
