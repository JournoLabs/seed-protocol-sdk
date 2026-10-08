import { and, eq, getTableColumns, or, SQL, sql } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { metadata } from '@/seedSchema'
import { METADATA_LATEST_FIRST_ORDER_SQL } from '@/helpers/compareMetadataRowsLatestFirst'

/**
 * Metadata rows of a seed numbered per property_name in reader order (`rowNum = 1` is the value to
 * show): live rows before revoked ones, then newest first. See `compareMetadataRowsLatestFirst`.
 */
export const getMetadataLatest = ({seedLocalId, seedUid}: {seedLocalId?: string, seedUid?: string}) => {
  const appDb = BaseDb.getAppDb()

  const whereClauses: SQL[] = []

  if (seedLocalId && seedUid) {
    const orClause = or(
      eq(metadata.seedLocalId, seedLocalId),
      eq(metadata.seedUid, seedUid),
    )
    if (orClause) whereClauses.push(orClause)
  } else if (seedLocalId) {
    whereClauses.push(eq(metadata.seedLocalId, seedLocalId))
  } else if (seedUid) {
    whereClauses.push(eq(metadata.seedUid, seedUid))
  }

  const metadataColumns = getTableColumns(metadata)

  return appDb.$with('metadataLatest').as(
    appDb
      .select({
        ...metadataColumns,
        rowNum: sql.raw(`
           ROW_NUMBER() OVER (
               PARTITION BY property_name
               ORDER BY ${METADATA_LATEST_FIRST_ORDER_SQL}
           )
          `).as('rowNum')
      })
      .from(metadata)
      .where(and(...whereClauses))
  )
}
