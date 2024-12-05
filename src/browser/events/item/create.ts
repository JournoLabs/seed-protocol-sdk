import { Item } from 'src/browser/item'
import { eventEmitter } from '@/eventBus'
import { createItemCacheKey, getItemCache, updateItemCache } from './requestAll'

export const createItemRequestHandler = async (event) => {
  const { ModelClass, itemData } = event

  const itemCache = getItemCache()

  const itemCacheKey = createItemCacheKey(itemData)

  if (!itemCacheKey) {
    console.warn('itemCacheKey not found for itemData', itemData)
    return
  }

  if (itemCache.has(itemCacheKey)) {
    return
  }

  const newItem = Item.create({
    modelName: ModelClass.originalConstructor.name,
    ...itemData,
  })

  updateItemCache(itemCacheKey, newItem)

  return new Promise<void>((resolve) => {
    const subscription = newItem.subscribe((context) => {
      if (context && context.versionLocalId && context.seedLocalId) {
        subscription.unsubscribe()
        // allItemsService.send({ type: 'addItemToContext', item: newItem })
        eventEmitter.emit('item.create.response', { item: newItem })
        // eventEmitter.emit('item.requestAll', { modelName })
        resolve()
      }
    })
  })
}
