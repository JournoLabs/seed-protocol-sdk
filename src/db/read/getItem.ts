import { Item } from '@/browser/Item'
import { getItemData } from './getItemData'
import { GetItem } from '@/types'


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

  return Item.create(itemInitObj)
}
