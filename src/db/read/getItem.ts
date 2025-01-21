import { getItemData } from './getItemData'
import { GetItem } from '@/types'
import { BaseItem } from '@/Item/BaseItem'
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

  return BaseItem.create(itemInitObj)
}
