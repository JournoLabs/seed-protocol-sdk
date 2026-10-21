import { sql, type SQL } from 'drizzle-orm'
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core'

/**
 * True for a stored attestation uid, false for the placeholders a draft row holds (NULL, '',
 * 'NULL', ZERO_BYTES32; see `isPlaceholderUid` in @seedprotocol/eas). The predicate of the partial
 * unique indexes on `seeds.uid` and `versions.uid`.
 */
export const attestedUidSql = (column: SQLiteColumn): SQL =>
  sql`${column} IS NOT NULL AND trim(${column}) NOT IN ('', 'NULL') AND lower(trim(${column})) != '0x0000000000000000000000000000000000000000000000000000000000000000'`
