import { GetItemData, ItemData } from "@/types"
import debug from "debug"
import { BaseDb } from "../Db/BaseDb"
import { and, eq, getTableColumns, gt, SQL, sql } from "drizzle-orm"
import { getItemProperties } from "./getItemProperties"
import { getVersionData } from "./subqueries/versionData"
import { seeds } from "@/seedSchema"
import { getSeedData } from "./getSeedData"

const logger = debug('app:db:read:getItemData')

export const getItemData: GetItemData = async ({
  modelName,
  seedLocalId,
  seedUid,
}) => {
  if (!seedLocalId && !seedUid) {
    throw new Error('[db/queries] [getItem] no seedLocalId or seedUid')
  }

  if (seedUid && !seedLocalId) {
    const seedData = await getSeedData({ seedUid })
    if (!seedData) {
      logger('[db/queries] [getItem] no seedData seedUid', seedUid)
      return
    }
    seedLocalId = seedData.localId
  }

  const appDb = BaseDb.getAppDb()

  const { localId, uid, ...rest } = getTableColumns(seeds)

  const whereClauses: SQL[] = []

  if (modelName) {
    whereClauses.push(eq(seeds.type, modelName.toLowerCase()))
  }

  if (seedUid) {
    whereClauses.push(eq(seeds.uid, seedUid))
  }

  if (seedLocalId && !seedUid) {
    whereClauses.push(eq(seeds.localId, seedLocalId))
  }

  const versionData = getVersionData()

  const itemDataRows = await appDb
    .with(versionData)
    .select({
      ...rest,
      seedLocalId: seeds.localId,
      seedUid: seeds.uid,
      versionsCount: versionData.versionsCount,
      lastVersionPublishedAt: versionData.lastVersionPublishedAt,
      latestVersionUid: versionData.latestVersionUid,
      latestVersionLocalId: versionData.latestVersionLocalId,
    })
    .from(seeds)
    .leftJoin(versionData, eq(seeds.localId, versionData.seedLocalId))
    .where(and(...whereClauses, gt(versionData.versionsCount, 0)))
    .orderBy(sql.raw('COALESCE(attestation_created_at, created_at) DESC'))
    .groupBy(seeds.localId) as ItemData[]

  if (!itemDataRows || itemDataRows.length === 0) {
    logger('[db/queries] [getItemDataFromDb] no itemDataRows')
    return
  }

  let itemData = itemDataRows[0] as ItemData & { [key: string]: any }

  const propertiesData = await getItemProperties({
    seedLocalId,
    seedUid: itemData.seedUid || undefined,
  })

  if (!propertiesData || propertiesData.length === 0) {
    return itemData
  }

  for (const propertyData of propertiesData) {
    const propertyName = propertyData.propertyName

    let propertyValue = propertyData.propertyValue

    if (propertyName.endsWith('Id') || propertyName.endsWith('Ids')) {
      if (propertyData.refSeedType) {
        const propertyNameVariant = propertyName.replace(/Ids?$/, '')
        itemData[propertyNameVariant] = propertyValue
      }
    }

    itemData[propertyName] = propertyValue
  }

  if (itemData) return itemData
}