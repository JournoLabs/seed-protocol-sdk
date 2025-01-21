import { useCallback, useEffect, useRef, useState } from 'react'
import { createNewItem } from '@/db/write/createNewItem'
import { Item } from '@/browser/Item'
import { eventEmitter } from '@/eventBus'
import { useImmer } from 'use-immer'
import { orderBy } from 'lodash-es'
import { getAreItemEventHandlersReady } from '@/events'
import debug from 'debug'
import { useGlobalServiceStatus } from '@/browser/react/services'
import { ModelValues } from '@/types'
import { Subscription } from 'xstate'
import { useSelector } from '@xstate/react'
import { IItem } from '@/interfaces'
import { BaseItem } from '@/Item/BaseItem'

const logger = debug('app:react:item')

type UseItemProps = {
  modelName: string
  seedLocalId?: string
  seedUid?: string
}

type UseItemReturn<T extends ModelValues<T>> = {
  item: Item<T> | undefined
  itemData: ItemData<T>
  itemStatus: string | Record<string, unknown> | undefined
}

type UseItem<T> = (props: UseItemProps) => UseItemReturn<T>

type ItemData<T> = Record<string, Partial<T>>

export const useItem: UseItem<any> = ({ modelName, seedLocalId, seedUid }) => {
  // const [itemSubscription, setItemSubscription] = useState<
  //   Subscription | undefined
  // >()
  //
  // const queryClient = useQueryClient()
  //
  // const { data: item } = useQuery({
  //   queryKey: ['item', modelName, seedLocalId, seedUid],
  //   queryFn: async () =>
  //     Item.find({
  //       modelName,
  //       seedLocalId,
  //       seedUid,
  //     }),
  //   networkMode: 'offlineFirst',
  // })
  //
  // const updateItem = async (newItem: Item<any>) => {
  //   queryClient.setQueryData(['item', modelName, seedLocalId, seedUid], newItem)
  // }
  //
  // useEffect(() => {
  //   if (item && item.subscribe && !itemSubscription) {
  //     const subscription = item.subscribe(async (_) => {
  //       const newItem = await Item.find({ modelName, seedLocalId, seedUid })
  //       if (!newItem) {
  //         logger(
  //           '[useItem] [itemSubscription] no item found',
  //           modelName,
  //           seedLocalId,
  //         )
  //         return
  //       }
  //       updateItem(newItem)
  //     })
  //     setItemSubscription(subscription)
  //   }
  //
  //   return () => {
  //     itemSubscription?.unsubscribe()
  //   }
  // }, [item, itemSubscription])
  //
  // return {
  //   item,
  //   itemData: {},
  //   itemStatus: undefined,
  // }

  const [itemData, setItemData] = useImmer<ItemData<any>>({})
  const [item, setItem] = useState<Item<any> | undefined>()
  const [itemSubscription, setItemSubscription] = useState<
    Subscription | undefined
  >()

  const { status, internalStatus } = useGlobalServiceStatus()

  const isReadingDb = useRef(false)

  const itemStatus = useSelector(
    item?.getService(),
    (snapshot) => snapshot?.value,
  )

  const updateItem = useCallback(
    (newItem: Item<any>) => {
      setItemData((draft) => {
        Object.keys(newItem.properties).forEach((propertyName) => {
          const value = newItem[propertyName]
          draft[propertyName] = value
        })
      })
    },
    [setItemData],
  )

  const readFromDb = useCallback(async () => {
    if (
      isReadingDb.current ||
      internalStatus !== 'ready' ||
      (!seedUid && !seedLocalId)
    ) {
      return
    }
    isReadingDb.current = true
    const foundItem = await Item.find({
      modelName,
      seedLocalId,
      seedUid,
    })
    if (!foundItem) {
      logger('[useItem] [getItemFromDb] no item found', modelName, seedLocalId)
      isReadingDb.current = false
      return
    }
    setItem(() => foundItem)
    updateItem(foundItem)
    isReadingDb.current = false
  }, [internalStatus])

  const listenerRef = useRef(readFromDb)

  useEffect(() => {
    listenerRef.current = readFromDb
  }, [readFromDb])

  useEffect(() => {
    if (internalStatus === 'ready') {
      listenerRef.current()
    }
  }, [internalStatus, status])

  useEffect(() => {
    if (item && !itemSubscription) {
      const subscription = item.subscribe(async (_) => {
        const newItem = await Item.find({ modelName, seedLocalId, seedUid })
        if (!newItem) {
          logger(
            '[useItem] [itemSubscription] no item found',
            modelName,
            seedLocalId,
          )
          return
        }
        updateItem(newItem)
        setItem(() => newItem)
      })
      setItemSubscription(subscription)
    }

    return () => {
      itemSubscription?.unsubscribe()
    }
  }, [item, itemSubscription])

  useEffect(() => {
    const seedId = seedUid || seedLocalId

    eventEmitter.addListener(`item.${modelName}.${seedId}.update`, () => {
      listenerRef.current()
    })

    return () => {
      eventEmitter.removeListener(`item.${modelName}.${seedId}.update`)
    }
  }, [])

  return {
    item,
    itemData,
    itemStatus,
  }
}
type UseItemsReturn = {
  items: BaseItem<any>[]
  isReadingDb: boolean
}
type UseItemsProps = {
  modelName?: string
  deleted?: boolean
}
type UseItems = (props: UseItemsProps) => UseItemsReturn
export const useItems: UseItems = ({ modelName, deleted=false }) => {
  const [items, setItems] = useImmer<BaseItem<any>[]>([])

  const { status, internalStatus } = useGlobalServiceStatus()

  const modelNameRef = useRef<string | undefined>(modelName)

  const isReadingDb = useRef(false)

  const readFromDb = useCallback(async () => {
    if (isReadingDb.current || internalStatus !== 'ready') {
      return
    }
    isReadingDb.current = true
    const allItems = await Item.all(modelNameRef.current, deleted)
    setItems(() => [])
    setItems(() => allItems)
    isReadingDb.current = false
  }, [internalStatus])

  const listenerRef = useRef(readFromDb)

  useEffect(() => {
    listenerRef.current = readFromDb
  }, [readFromDb])

  useEffect(() => {
    if (internalStatus === 'ready') {
      listenerRef.current()
    }
  }, [internalStatus, status])

  useEffect(() => {
    eventEmitter.addListener('item.requestAll', (event) => {
      if (
        !event ||
        !event.modelName ||
        event.modelName !== modelNameRef.current
      ) {
        return
      }
      listenerRef.current()
    })

    return () => {
      eventEmitter.removeListener('item.requestAll', readFromDb)
    }
  }, [])

  return {
    items: orderBy(
      items,
      [
        (item) =>
          item.lastVersionPublishedAt ||
          item.attestationCreatedAt ||
          item.createdAt,
      ],
      ['desc'],
    ),
    isReadingDb: isReadingDb.current,
  }
}
export const useItemIsReady = () => {
  const [itemListenersReady, setItemListenersReady] = useState(false)

  const itemEventListenersHandler = useCallback((_) => {
    setItemListenersReady(true)
  }, [])

  useEffect(() => {
    const areReady = getAreItemEventHandlersReady()

    if (areReady) {
      itemEventListenersHandler(true)
    }

    eventEmitter.addListener(
      'item.events.setupAllItemsEventHandlers',
      itemEventListenersHandler,
    )

    return () => {
      eventEmitter.removeListener('item.events.setupAllItemsEventHandlers')
    }
  }, [])

  return {
    isReady: itemListenersReady,
  }
}
export const useCreateItem = <T>(modelName: string) => {
  const [isCreatingItem, setIsCreatingItem] = useState(false)

  const { isReady } = useItemIsReady()

  const createItem = useCallback(
    async (itemData) => {
      if (!isReady) {
        console.error(
          `[useCreateItem] [createItem] called before listeners are ready`,
          itemData,
        )
        return
      }
      if (isCreatingItem) {
        // TODO: should we setup a queue for this?
        console.error(
          `[useCreateItem] [createItem] already creating item`,
          itemData,
        )
        return
      }

      setIsCreatingItem(true)

      const { seedLocalId } = await createNewItem({ modelName, ...itemData })

      const newItem = await Item.find({ modelName, seedLocalId })

      eventEmitter.emit('item.requestAll', { modelName })

      setIsCreatingItem(false)
    },
    [isCreatingItem, isReady],
  )

  return {
    createItem,
    isCreatingItem,
  }
}

type PublishItemResult = Error | undefined | void

type UsePublishItemReturn = {
  publishItem: (
    item: Item<any> | undefined,
    callback?: (result: PublishItemResult) => any,
  ) => void
  isPublishing: boolean
}

type PublishItemProps =
  | [Item<any> | undefined]
  | [Item<any> | undefined, (result: PublishItemResult) => any | undefined]

type PublishItem = (...props: PublishItemProps) => Promise<any>

export const usePublishItem = (): UsePublishItemReturn => {
  const [isPublishing, setIsPublishing] = useState(false)

  const isLocked = useRef(false)

  const publishItem: PublishItem = useCallback(async (item, callback?) => {
    if (!item || isLocked.current) {
      return
    }
    isLocked.current = true
    setIsPublishing(true)
    try {
      const uploads = await item.getPublishUploads()
      const payload = await item.getPublishPayload(uploads)
      if (callback) {
        callback()
      }
    } catch (e) {
      if (callback) {
        callback(e as Error)
      }
    }
    setIsPublishing(false)
    isLocked.current = false
  }, [])

  return {
    publishItem,
    isPublishing,
  }
}
