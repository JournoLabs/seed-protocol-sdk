import { GetItemProperties, PropertyData } from '@/types'
import { metadata, seeds, versions } from '@/seedSchema'
import { and, eq, getTableColumns, isNotNull, isNull, sql, SQL } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { getMetadataLatest } from './subqueries/metadataLatest'


export const getItemProperties: GetItemProperties = async ({
  seedLocalId,
  seedUid,
  edited,
}) => {
  const appDb = BaseDb.getAppDb()

  const whereClauses: SQL[] = [isNotNull(metadata.propertyName)]

  if (seedUid) {
    whereClauses.push(eq(seeds.uid, seedUid))
  }

  if (seedLocalId) {
    whereClauses.push(eq(seeds.localId, seedLocalId))
  }

  whereClauses.push(isNotNull(metadata.propertyName))

  if (typeof edited !== 'undefined') {
    if (edited) {
      whereClauses.push(isNull(metadata.uid))
    }
    if (!edited) {
      whereClauses.push(isNotNull(metadata.uid))
    }
  }

  // const metadataColumns = getTableColumns(metadata)

  const metadataLatest = getMetadataLatest({seedLocalId, seedUid})

  const propertiesData = await appDb
    .with(metadataLatest)
    .select()
    .from(metadataLatest)
    .where(eq(metadataLatest.rowNum, 1))

  return propertiesData.map(data => ({
    ...data,
    localId: data.localId || '',
    uid: data.uid || '',
    propertyName: data.propertyName || '',
    propertyValue: data.propertyValue || '',
    schemaUid: data.schemaUid || '',
    modelType: data.modelType || '',
    seedLocalId: data.seedLocalId || '',
  })) as PropertyData[]
}
