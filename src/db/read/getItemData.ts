import { GetItemData, ItemData } from "@/types"
import debug from "debug"
import { BaseDb } from "../Db/BaseDb"
import { and, eq, getTableColumns, gt, SQL, sql, count, max } from "drizzle-orm"
import { toSnakeCase } from "drizzle-orm/casing"
import { getItemProperties } from "./getItemProperties"
import { getVersionData } from "./subqueries/versionData"
import { seeds, versions } from "@/seedSchema"
import { getSeedData } from "./getSeedData"

const logger = debug('seedSdk:db:read:getItemData')

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
    seedLocalId = seedData.localId || undefined
  }

  const appDb = BaseDb.getAppDb()

  const { localId, uid, ...rest } = getTableColumns(seeds)

  const whereClauses: SQL[] = []

  if (modelName) {
    whereClauses.push(eq(seeds.type, toSnakeCase(modelName)))
  }

  if (seedUid) {
    whereClauses.push(eq(seeds.uid, seedUid))
  }

  if (seedLocalId && !seedUid) {
    whereClauses.push(eq(seeds.localId, seedLocalId))
  }

  // First, query the seeds table directly to find the item
  const seedRows = await appDb
    .select({
      ...rest,
      seedLocalId: seeds.localId,
      seedUid: seeds.uid,
    })
    .from(seeds)
    .where(and(...whereClauses))
    .limit(1)

  logger('[getItemData] Seed query result', { rowsCount: seedRows?.length || 0, firstRow: seedRows?.[0] })

  if (!seedRows || seedRows.length === 0) {
    logger('[db/queries] [getItemDataFromDb] no seedRows found', { modelName, seedLocalId, seedUid })
    return
  }

  const seedRow = seedRows[0]
  const resolvedSeedLocalId = seedRow.seedLocalId

  // Now get version data if it exists - query versions table directly
  let versionRow = {
    versionsCount: 0,
    lastVersionPublishedAt: null,
    latestVersionUid: null,
    latestVersionLocalId: null,
  }
  
  try {
    const versionRows = await appDb
      .select({
        versionsCount: count(versions.localId).as('versionsCount'),
        lastVersionPublishedAt: max(versions.attestationCreatedAt).as('lastVersionPublishedAt'),
        latestVersionUid: max(versions.uid).as('latestVersionUid'),
        latestVersionLocalId: max(versions.localId).as('latestVersionLocalId'),
      })
      .from(versions)
      .where(eq(versions.seedLocalId, resolvedSeedLocalId))
      .groupBy(versions.seedLocalId)
      .limit(1)

    if (versionRows && versionRows.length > 0) {
      versionRow = versionRows[0]
    }
  } catch (error) {
    console.error('[getItemData] Error querying versions', error)
    // Continue with default versionRow values
  }

  let itemData = {
    ...seedRow,
    ...versionRow,
  } as ItemData & { [key: string]: any }

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