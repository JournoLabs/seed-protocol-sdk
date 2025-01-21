import { GetItemProperties, PropertyData } from '@/types'
import { metadata, seeds, versions } from '@/seedSchema'
import { and, eq, getTableColumns, isNotNull, isNull, SQL } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'


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

  // const uidWhereClause: SQL = seedUid
  //   ? eq(seeds.uid, seedUid)
  //   : isNull(seeds.uid)
  // const localWhereClause: SQL = seedLocalId
  //   ? eq(seeds.localId, seedLocalId)
  //   : isNull(seeds.localId)

  // whereClauses.push(or(localWhereClause, uidWhereClause) as SQL)
  whereClauses.push(isNotNull(metadata.propertyName))
  // whereClauses.push(isNotNull(metadata.easDataType))

  if (typeof edited !== 'undefined') {
    if (edited) {
      whereClauses.push(isNull(metadata.uid))
    }
    if (!edited) {
      whereClauses.push(isNotNull(metadata.uid))
    }
  }

  const metadataColumns = getTableColumns(metadata)

  const propertiesData = await appDb
    .select({
      ...metadataColumns,
    })
    .from(seeds)
    .leftJoin(metadata, eq(metadata.seedLocalId, seeds.localId))
    .leftJoin(versions, eq(versions.localId, seeds.localId))
    .where(and(...whereClauses))
    .groupBy(metadata.propertyName)

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
