import { PropertyData } from '@/types'
import { getAppDb } from '@/browser/db/sqlWasmClient'
import { metadata, seeds, versions } from '@/shared/seedSchema'
import { and, eq, getTableColumns, isNotNull, isNull, SQL } from 'drizzle-orm'

type GetPropertiesForSeedProps = {
  seedLocalId?: string
  seedUid?: string
  edited?: boolean
}

type GetItemProperties = (
  props: GetPropertiesForSeedProps,
) => Promise<PropertyData[]>

export const getItemProperties: GetItemProperties = async ({
  seedLocalId,
  seedUid,
  edited,
}) => {
  const appDb = getAppDb()

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

  return propertiesData
}
