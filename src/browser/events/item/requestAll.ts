import { eventEmitter } from '@/eventBus'
import { Item } from '@/browser/item'
import { getItemsData } from '@/browser/db/read/getItems'
import debug from 'debug'
import { getModel } from '@/browser/stores/modelClass'

const logger = debug('app:events:requestAll')

const cache = new Map<string, Map<string, Item<any>>>()

let modelCount = 0

const handleRequestAll = async (event) => {
  const { modelName, eventId } = event

  let modelItemsCache

  if (cache.has(modelName)) {
    modelItemsCache = cache.get(modelName)
  }

  if (modelItemsCache && modelName === 'Identity' && modelCount <= 1) {
    // Send what we have while we update the cache
    eventEmitter.emit(`item.${modelName}.requestAll.response`, {
      items: Array.from(modelItemsCache.values()),
      eventId,
    })
    modelCount++
  }

  if (!modelItemsCache) {
    modelItemsCache = new Map()
  }

  const itemsData = await getItemsData({ modelName })

  const cacheKeys = Array.from(modelItemsCache.keys())

  const keysInDb = []

  const returnItems = []

  const ModelClass = getModel(modelName)

  for (const itemData of itemsData) {
    returnItems.push(
      await Item.create({
        ...itemData,
        modelName,
      }),
    )
  }

  if (modelName === 'Identity' && modelCount <= 1) {
    logger(
      `[XXXXXX] [handleRequestAll] ${ModelClass?.originalConstructor.name}:`,
      returnItems.length,
    )
    eventEmitter.emit(`item.${modelName}.requestAll.response`, {
      items: returnItems,
      eventId,
    })
  }

  for (const returnItem of returnItems) {
    const itemCacheKey = `${returnItem.seedLocalId}_${returnItem.seedUid || ''}`
    keysInDb.push(itemCacheKey)
    const existingCacheKey = cacheKeys.find((ck) => ck.includes(itemCacheKey))

    if (!existingCacheKey) {
      modelItemsCache.set(itemCacheKey, returnItem)
      continue
    }

    if (existingCacheKey) {
      const existingItem = modelItemsCache.get(existingCacheKey)
      if (!existingItem) {
        console.error(
          '[events/requestAll] [getItemsDataFromDb] no existingItem for cache key',
          existingCacheKey,
          modelItemsCache,
        )
        continue
      }
      for (const [key, value] of Object.entries(returnItem)) {
        if (key === 'seedLocalId' || key === 'seedUid') {
          continue
        }
        existingItem[key] = value
      }
      modelItemsCache.set(existingCacheKey, existingItem)
    }
  }

  // Remove any stale items from the cache that were deleted from the DB
  if (keysInDb.length !== cacheKeys.length) {
    for (const cacheKey of cacheKeys) {
      if (!keysInDb.includes(cacheKey)) {
        modelItemsCache.delete(cacheKey)
      }
    }
  }

  cache.set(modelName, modelItemsCache)

  if (modelName === 'Identity' && modelCount <= 1) {
    logger(
      `[XXXXXX] [getItemsDataFromDb] ${modelName} responding with`,
      Array.from(modelItemsCache.values()),
    )
    eventEmitter.emit(`item.${modelName}.requestAll.response`, {
      items: Array.from(modelItemsCache.values()),
      eventId,
    })
  }
}

export const itemRequestAllHandler = async (event) => {
  logger('[events/requestAll] Request all items', event)
  await handleRequestAll(event)
  // eventQueue.push(event, (err) => {
  //   if (err) {
  //     console.error(err)
  //   }
  //   if (!err) {
  //     logger('[events/requestAll] Request all items done without error')
  //   }
  // })
}

// export const getItemCache = () => {
//   return itemCache
// }

type CreateItemCacheKeyParams = {
  seedLocalId?: string
  seedUid?: string
}

type CreateItemCacheKey = (
  itemData: CreateItemCacheKeyParams,
) => string | undefined

export const createItemCacheKey: CreateItemCacheKey = (itemData) => {
  if (!itemData || (!itemData.seedLocalId && !itemData.seedUid)) {
    return
  }
  return `${itemData.seedLocalId}_${itemData.seedUid || ''}`
}

// export const updateItemCache = (itemCacheKey: string, item: Item<any>) => {
//   itemCache.set(itemCacheKey, item)
// }
//
// export const deleteItemFromCache = (itemCacheKey: string) => {
//   itemCache.delete(itemCacheKey)
// }
