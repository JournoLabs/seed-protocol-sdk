import { Item } from '@/browser/item'

import { getItemProperties } from '@/browser/db/read/getItemProperties'
import { getSeedData } from '@/browser/db/read/getSeedData'
import debug from 'debug'
import { ItemData } from '@/types'
import { getAppDb } from '../sqlWasmClient'
import { seeds } from '@/shared/seedSchema'
import { and, eq, getTableColumns, gt, sql, SQL } from 'drizzle-orm'
import { getVersionData } from './subqueries/versionData'

const logger = debug('app:db:queries:getItem')

type GetItemDataFromDbParams = {
  modelName?: string
  seedLocalId?: string
  seedUid?: string
}

type GetItemDataFromDb = (
  params: GetItemDataFromDbParams,
) => Promise<ItemData | undefined>

export const getItemDataFromDb: GetItemDataFromDb = async ({
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

  const appDb = getAppDb()

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
    .groupBy(seeds.localId)

  if (!itemDataRows || itemDataRows.length === 0) {
    logger('[db/queries] [getItemDataFromDb] no itemDataRows')
    return
  }

  let itemData = itemDataRows[0]

  const propertiesData = await getItemProperties({ seedLocalId, seedUid })

  // const initObj: ItemData = {
  //   seedLocalId,
  //   seedUid,
  //   modelName,
  // }

  if (!propertiesData || propertiesData.length === 0) {
    return itemData
  }

  const firstPropertyData = propertiesData[0]

  for (const propertyData of propertiesData) {
    const propertyName = propertyData.propertyName

    const propertyValue = propertyData.propertyValue

    // TODO: Find a better place for the property data below
    // Since initObj is used to initialize an Item, the following values
    // just overwrite each other for each property since they are Property
    // specific.

    // const refSeedType = propertyDbValues[11]
    // if (refSeedType) {
    //   initObj.refSeedType = refSeedType
    // }
    // const refValueType = propertyDbValues[12]
    // if (refValueType) {
    //   initObj.refValueType = refValueType
    // }
    //
    // if (
    //   refSeedType &&
    //   refValueType === 'list' &&
    //   propertyName.endsWith('Ids')
    // ) {
    //   logger('[db/queries] [getItemDataFromDb] propertyName', propertyName)
    // }

    itemData[propertyName] = propertyValue
  }

  return itemData
}

type GetItemParams = {
  modelName?: string
  seedLocalId?: string
  seedUid?: string
}

type GetItem = (params: GetItemParams) => Promise<Item<any> | undefined>

export const getItem: GetItem = async ({ modelName, seedLocalId, seedUid }) => {
  const itemInitObj = await getItemDataFromDb({
    modelName,
    seedLocalId,
    seedUid,
  })

  if (!itemInitObj) {
    console.error(
      `[db/queries] [getItem] no itemInitObj modelName: ${modelName} seedLocalId: ${seedLocalId} seedUid: ${seedUid}`,
    )
    return
  }

  if (!itemInitObj.seedLocalId) {
    console.error(
      `[db/queries] [getItem] no itemInitObj.seedLocalId modelName: ${modelName} seedLocalId: ${seedLocalId} seedUid: ${seedUid}`,
    )
    return
  }

  return Item.create(itemInitObj)
}
