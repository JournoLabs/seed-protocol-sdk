import { and, eq, getTableColumns, or, SQL, sql } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { metadata } from '@/seedSchema'

export const getMetadataLatest = ({seedLocalId, seedUid}: {seedLocalId?: string, seedUid?: string}) => {
  const appDb = BaseDb.getAppDb()

  const whereClauses: SQL[] = []

  if (seedLocalId) {
    whereClauses.push(eq(metadata.seedLocalId, seedLocalId))
  }

  if (seedUid) {
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
               ORDER BY COALESCE(created_at, attestation_created_at) DESC
           )
          `).as('rowNum')
      })
      .from(metadata)
      .where(and(...whereClauses))
  )
}
