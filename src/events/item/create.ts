import { eventEmitter } from '@/eventBus'
import { createItemCacheKey, getItemCache, updateItemCache } from './requestAll'
import { Item } from '@/Item/Item'

export const createItemRequestHandler = async (event) => {
  const { modelName, itemData } = event

  if (!modelName) {
    console.error('[createItemRequestHandler] modelName is required', { event })
    throw new Error('modelName is required')
  }

  const itemCache = getItemCache()

  const itemCacheKey = createItemCacheKey(itemData)

  if (!itemCacheKey) {
    console.warn('itemCacheKey not found for itemData', itemData)
    return
  }

  if (itemCache.has(itemCacheKey)) {
    return
  }

  const newItem = await Item.create({
    modelName,
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
