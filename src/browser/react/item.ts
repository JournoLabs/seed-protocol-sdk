import { useCallback, useEffect, useRef, useState, useMemo } from 'react'
import { createNewItem } from '@/db/write/createNewItem'
import { Item } from '@/Item/Item'
import { eventEmitter } from '@/eventBus'
import { orderBy } from 'lodash-es'
import { getAreItemEventHandlersReady } from '@/events'
import debug from 'debug'
import { ModelValues } from '@/types'
import { Subscription } from 'xstate'
import { IItem } from '@/interfaces'
import { useIsClientReady } from './client'
import { useLiveQuery } from './liveQuery'
import { BaseDb } from '@/db/Db/BaseDb'
import { seeds } from '@/seedSchema'
import { and, eq, gt, isNotNull, isNull, or } from 'drizzle-orm'
import type { SeedType } from '@/seedSchema/SeedSchema'
import { getVersionData } from '@/db/read/subqueries/versionData'

const logger = debug('seedSdk:react:item')

type UseItemReturn<T extends ModelValues<T>> = {
  item: IItem<T> | undefined
  isLoading: boolean
  error: Error | null
}

type UseItemProps = {
  modelName: string
  seedLocalId?: string
  seedUid?: string
}

type UseItem = <T extends ModelValues<T>>(props: UseItemProps) => UseItemReturn<T>

export const useItem: UseItem = <T extends ModelValues<T>>({ modelName, seedLocalId, seedUid }: UseItemProps) => {
  const [item, setItem] = useState<Item<T> | undefined>()
  const [isLoading, setIsLoading] = useState(!!(seedLocalId || seedUid))
  const [error, setError] = useState<Error | null>(null)
  const subscriptionRef = useRef<Subscription | undefined>(undefined)

  const isClientReady = useIsClientReady()

  const modelNameRef = useRef<string>(modelName)
  const seedLocalIdRef = useRef<string | undefined>(seedLocalId)
  const seedUidRef = useRef<string | undefined>(seedUid)

  // Determine if we should be loading based on parameters - use useMemo to stabilize
  // Use refs to check current values to avoid dependency issues
  const shouldLoad = useMemo(() => {
    if (!isClientReady) return false
    return !!(seedLocalIdRef.current || seedUidRef.current)
  }, [isClientReady, seedLocalId, seedUid])

  const loadItem = useCallback(async () => {
    // Check shouldLoad inside the function to avoid recreating the callback
    const currentShouldLoad = !!(isClientReady && (seedLocalIdRef.current || seedUidRef.current))
    if (!currentShouldLoad) {
      setItem(undefined)
      setIsLoading(false)
      setError(null)
      return
    }

    try {
      // Don't set isLoading here - let the subscription effect handle it
      // This avoids race conditions where isLoading is set to true but then
      // the subscription effect hasn't run yet to set it to false
      setError(null)

      const foundItem = await Item.find({
        modelName: modelNameRef.current,
        seedLocalId: seedLocalIdRef.current,
        seedUid: seedUidRef.current,
      }) as Item<T> | undefined
      
      if (!foundItem) {
        logger('[useItem] [loadItem] no item found', modelNameRef.current, seedLocalIdRef.current)
        setItem(undefined)
        setIsLoading(false)
        setError(null)
        return
      }

      // Item.find() now waits for idle by default, so the item should be ready
      setItem(foundItem)
      setIsLoading(false) // Item is ready since find() waited for idle
      setError(null)
    } catch (error) {
      logger('[useItem] Error loading item:', error)
      setItem(undefined)
      setIsLoading(false)
      setError(error as Error)
    }
  }, [isClientReady])

  useEffect(() => {
    modelNameRef.current = modelName
    seedLocalIdRef.current = seedLocalId
    seedUidRef.current = seedUid
  }, [modelName, seedLocalId, seedUid])

  // Fetch/refetch when parameters change or client becomes ready
  useEffect(() => {
    // Only clear item if we don't have parameters to load
    // Don't clear if shouldLoad is false but we have an item - it might just be a timing issue
    if (!shouldLoad) {
      // Only clear if we actually don't have parameters (not just client not ready)
      if (!seedLocalId && !seedUid) {
        setItem(undefined)
        setIsLoading(false)
        setError(null)
      }
      return
    }
    loadItem()
  }, [shouldLoad, loadItem, seedLocalId, seedUid])

  // Subscribe to service changes when item is available
  useEffect(() => {
    if (!item) {
      // Clean up subscription if item is not available
      subscriptionRef.current?.unsubscribe()
      subscriptionRef.current = undefined
      return
    }

    // Clean up previous subscription
    subscriptionRef.current?.unsubscribe()

    // Subscribe to service changes
    // Don't set isLoading here - it's already set correctly in loadItem
    // Just subscribe to future state changes
    const service = item.getService()
    
    const subscription = service.subscribe((snapshot: any) => {
      // Update loading state based on service state changes
      if (snapshot && typeof snapshot === 'object' && 'value' in snapshot) {
        const isIdle = snapshot.value === 'idle'
        setIsLoading(!isIdle)
        
        // Clear error if service is in idle state
        if (isIdle) {
          setError(null)
        } else if (snapshot.value === 'error') {
          // Set error if service is in error state
          setError(new Error('Item service error'))
        }
      }
    })
    
    subscriptionRef.current = subscription

    return () => {
      subscriptionRef.current?.unsubscribe()
      subscriptionRef.current = undefined
    }
  }, [item])

  return {
    item,
    isLoading,
    error,
  }
}

type UseItemsReturn = {
  items: IItem<any>[]
  isLoading: boolean
  error: Error | null
}

type UseItemsProps = {
  modelName?: string
  deleted?: boolean
}

type UseItems = (props: UseItemsProps) => UseItemsReturn

export const useItems: UseItems = ({ modelName, deleted=false }) => {
  const [items, setItems] = useState<IItem<any>[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const isClientReady = useIsClientReady()
  const subscriptionsRef = useRef<Map<IItem<any>, Subscription>>(new Map())
  const loadingItemsRef = useRef<Set<IItem<any>>>(new Set())
  const previousSeedsTableDataRef = useRef<SeedType[] | undefined>(undefined)
  const itemsRef = useRef<IItem<any>[]>([]) // Track items for comparison without triggering effects

  // Watch the seeds table for changes
  // Memoize the query so it's stable across renders - this is critical for distinctUntilChanged to work
  // IMPORTANT: This query must match the logic in getItemsData() to ensure seedsTableData
  // only includes seeds that Item.all() will return (i.e., seeds with versionsCount > 0)
  const db = isClientReady ? BaseDb.getAppDb() : null
  const seedsQuery = useMemo(() => {
    if (!db) return null
    
    const conditions: any[] = []
    
    if (modelName) {
      conditions.push(eq(seeds.type, modelName.toLowerCase()))
    }
    
    if (deleted) {
      conditions.push(
        or(
          isNotNull(seeds._markedForDeletion),
          eq(seeds._markedForDeletion, 1)
        ) as any
      )
    } else {
      conditions.push(
        or(
          isNull(seeds._markedForDeletion),
          eq(seeds._markedForDeletion, 0)
        ) as any
      )
    }
    
    // Join with versionData and filter by versionsCount > 0 to match getItemsData() logic
    // This ensures we only watch seeds that have at least one version
    const versionData = getVersionData()
    
    return db
      .with(versionData)
      .select({
        localId: seeds.localId,
        uid: seeds.uid,
        type: seeds.type,
        schemaUid: seeds.schemaUid,
        createdAt: seeds.createdAt,
        attestationCreatedAt: seeds.attestationCreatedAt,
        _markedForDeletion: seeds._markedForDeletion,
      })
      .from(seeds)
      .leftJoin(versionData, eq(seeds.localId, versionData.seedLocalId))
      .where(and(gt(versionData.versionsCount, 0), ...conditions))
      .groupBy(seeds.localId)
  }, [db, isClientReady, modelName, deleted])
  const seedsTableData = useLiveQuery<SeedType>(seedsQuery)

  const fetchItems = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)
      
      const allItems = await Item.all(modelName, deleted)
      
      // Filter items into ready vs loading based on service state
      const readyItems: IItem<any>[] = []
      const loadingItemsList: IItem<any>[] = []
      
      // Clear previous loading set
      loadingItemsRef.current.clear()
      
      for (const item of allItems) {
        const snapshot = item.getService().getSnapshot()
        const isIdle = snapshot.value === 'idle'
        
        if (isIdle) {
          // Item is ready
          readyItems.push(item)
        } else {
          // Item is still loading - subscribe to state changes
          loadingItemsList.push(item)
          loadingItemsRef.current.add(item)
          
          // Clean up any existing subscription for this item
          const existingSub = subscriptionsRef.current.get(item)
          if (existingSub) {
            existingSub.unsubscribe()
          }
          
          // Subscribe to state changes
          const subscription = item.getService().subscribe((snapshot: any) => {
            if (snapshot && typeof snapshot === 'object' && 'value' in snapshot) {
              const isIdle = snapshot.value === 'idle'
              
              if (isIdle) {
                // Item is now ready - update state
                setItems(prev => {
                  // Check if item is already in the list (by seedLocalId or seedUid)
                  const exists = prev.some(i => 
                    (i.seedLocalId && item.seedLocalId && i.seedLocalId === item.seedLocalId) ||
                    (i.seedUid && item.seedUid && i.seedUid === item.seedUid)
                  )
                  if (exists) {
                    return prev
                  }
                  // Add the newly ready item
                  const updated = [...prev, item]
                  itemsRef.current = updated // Update ref for comparison
                  return updated
                })
                
                // Remove from loading set and clean up subscription
                loadingItemsRef.current.delete(item)
                subscription.unsubscribe()
                subscriptionsRef.current.delete(item)
                
                // Update loading state based on remaining loading items
                setIsLoading(loadingItemsRef.current.size > 0)
              } else if (snapshot.value === 'error') {
                // Item failed to load - clean up subscription
                loadingItemsRef.current.delete(item)
                subscription.unsubscribe()
                subscriptionsRef.current.delete(item)
                
                // Update loading state based on remaining loading items
                setIsLoading(loadingItemsRef.current.size > 0)
              }
            }
          })
          
          subscriptionsRef.current.set(item, subscription)
        }
      }
      
      // Set initial ready items
      setItems(readyItems)
      itemsRef.current = readyItems // Update ref for comparison
      setError(null)
      setIsLoading(loadingItemsList.length > 0) // Still loading if any items are loading
      
    } catch (error) {
      setError(error as Error)
      setIsLoading(false)
    }
  }, [modelName, deleted])

  // Cleanup subscriptions for items that are no longer in the list
  useEffect(() => {
    const currentItemKeys = new Set<string>()
    for (const item of items) {
      const key = item.seedLocalId || item.seedUid || ''
      if (key) {
        currentItemKeys.add(key)
      }
    }
    
    // Clean up subscriptions for items that are no longer in the list
    for (const [item, subscription] of subscriptionsRef.current.entries()) {
      const key = item.seedLocalId || item.seedUid || ''
      if (key && !currentItemKeys.has(key)) {
        // Item is no longer in the list, clean up subscription
        subscription.unsubscribe()
        subscriptionsRef.current.delete(item)
        loadingItemsRef.current.delete(item)
      }
    }
    
    // Update loading state based on remaining loading items
    if (loadingItemsRef.current.size === 0 && isLoading) {
      setIsLoading(false)
    }
  }, [items, isLoading])

  // Fetch items on initial mount when client is ready
  useEffect(() => {
    if (!isClientReady) {
      return
    }
    // Initial fetch when client becomes ready
    fetchItems()
  }, [isClientReady, fetchItems])

  // Refetch items when table data actually changes (not just reference)
  useEffect(() => {
    if (!isClientReady || !seedsTableData) {
      return
    }

    // Check if seedsTableData actually changed by comparing with previous value
    const prevData = previousSeedsTableDataRef.current
    const prevDataJson = prevData ? JSON.stringify(prevData.map(s => ({ localId: s.localId, uid: s.uid }))) : 'undefined'
    const currDataJson = seedsTableData ? JSON.stringify(seedsTableData.map(s => ({ localId: s.localId, uid: s.uid }))) : 'undefined'
    
    if (prevDataJson === currDataJson && prevData !== undefined) {
      // Data hasn't actually changed, skip refetch
      return
    }
    
    // Update ref with current data
    previousSeedsTableDataRef.current = seedsTableData

    // Extract identifying information from current items in state (using ref to avoid dependency)
    const currentItemsSet = new Set<string>()
    for (const item of itemsRef.current) {
      const key = item.seedLocalId || item.seedUid
      if (key) {
        currentItemsSet.add(key)
      }
    }

    // Extract identifying information from seedsTableData
    const tableDataItemsSet = new Set<string>()
    for (const dbSeed of seedsTableData) {
      const key = dbSeed.localId || dbSeed.uid
      if (key) {
        tableDataItemsSet.add(key)
      }
    }

    // Compare sets to detect changes
    const setsAreEqual = 
      currentItemsSet.size === tableDataItemsSet.size &&
      [...currentItemsSet].every(id => tableDataItemsSet.has(id))

    if (setsAreEqual) {
      // Items in state match table data, skip refetch
      return
    }

    // Items have changed, fetch updated items
    fetchItems()
  }, [isClientReady, seedsTableData, fetchItems, modelName])

  // Cleanup all subscriptions on unmount
  useEffect(() => {
    return () => {
      subscriptionsRef.current.forEach(sub => sub.unsubscribe())
      subscriptionsRef.current.clear()
      loadingItemsRef.current.clear()
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
    isLoading,
    error,
  }
}

export const useItemIsReady = () => {
  const [itemListenersReady, setItemListenersReady] = useState(false)

  const itemEventListenersHandler = useCallback((_: any) => {
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

export const useCreateItem = <T>() => {
  const [isCreatingItem, setIsCreatingItem] = useState(false)

  const { isReady } = useItemIsReady()

  const createItem = useCallback(
    async (modelName: string, itemData?: Record<string, any>) => {
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

      if (!itemData) {
        itemData = {}
      }

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

type PublishItemProps = [
  Item<any> | undefined,
  ((result: PublishItemResult) => any) | undefined
]

type PublishItem = (...props: PublishItemProps) => Promise<any>

export const usePublishItem = (): UsePublishItemReturn => {
  const [isPublishing, setIsPublishing] = useState(false)

  const isLocked = useRef(false)

  const publishItem = useCallback(async (item: Item<any> | undefined, callback?: (result: PublishItemResult) => any) => {
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
