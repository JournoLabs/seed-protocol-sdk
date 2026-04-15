import { getItemData } from './getItemData'
import { GetItem } from '@/types'
import { Item } from '@/Item/Item'
import { startCase } from 'lodash-es'

export const getItem: GetItem = async ({ modelName, seedLocalId, seedUid }) => {
  const itemInitObj = await getItemData({
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

  if (!itemInitObj.modelName && itemInitObj.type) {
    itemInitObj.modelName = startCase(itemInitObj.type)
  }

  // DB + loadOrCreateItem + concurrent property saves (e.g. during publish) can exceed the default 5s idle wait.
  const getItemReadyTimeoutMs = 120_000
  return Item.create(itemInitObj, { readyTimeout: getItemReadyTimeoutMs })
}
