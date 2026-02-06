import { ItemData } from '@/types'
import { and, eq, gt, isNotNull, isNull, or, SQL, sql } from 'drizzle-orm'
import { toSnakeCase } from 'drizzle-orm/casing'
import { seeds } from '@/seedSchema'
import { BaseDb } from '@/db/Db/BaseDb'
import { getVersionData } from './subqueries/versionData'

type GetItemsDataProps = {
  modelName?: string
  deleted?: boolean
}

type GetItemsData = (props: GetItemsDataProps) => Promise<ItemData[]>

export const getItemsData: GetItemsData = async ({
  modelName,
  deleted,
}): Promise<ItemData[]> => {
  const appDb = BaseDb.getAppDb()

  const conditions: SQL[] = []

  if (modelName) {
    conditions.push(eq(seeds.type, toSnakeCase(modelName)))
  }

  if (deleted) {
    conditions.push(
      or(
        isNotNull(seeds._markedForDeletion),
        eq(seeds._markedForDeletion, 1),
      ) as SQL,
    )
  }

  if (!deleted) {
    conditions.push(
      or(
        isNull(seeds._markedForDeletion),
        eq(seeds._markedForDeletion, 0),
      ) as SQL,
    )
  }

  const versionData = getVersionData()

  // When modelName is not provided (e.g. useItems({})), select each seed's type so Item.create
  // can derive modelName via startCase(props.type). Otherwise loadOrCreateItem throws "modelName is required".
  const selectModelNameOrType = modelName
    ? { modelName: sql<string>`${modelName}` as any }
    : { type: seeds.type }

  let query = appDb
    .with(versionData)
    .select({
      seedLocalId: seeds.localId,
      seedUid: seeds.uid,
      schemaUid: seeds.schemaUid,
      ...selectModelNameOrType,
      attestationCreatedAt: seeds.attestationCreatedAt,
      versionsCount: versionData.versionsCount,
      lastVersionPublishedAt: versionData.lastVersionPublishedAt,
      lastLocalUpdateAt: versionData.lastLocalUpdateAt,
      latestVersionUid: versionData.latestVersionUid,
      latestVersionLocalId: versionData.latestVersionLocalId,
      createdAt: seeds.createdAt,
    })
    .from(seeds)
    .leftJoin(versionData, eq(seeds.localId, versionData.seedLocalId))
    .where(and(gt(versionData.versionsCount, 0), ...conditions))
    .orderBy(sql.raw('COALESCE(attestation_created_at, created_at) DESC'))
    .groupBy(seeds.localId)

  const itemsData = (await query) as ItemData[]

  return itemsData
}
