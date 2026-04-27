import { useCallback, useEffect, useRef, useState, useMemo } from 'react'
import { flushSync } from 'react-dom'
import {
  createNewItem,
  getAddressesForItemsFilter,
  Item,
  eventEmitter,
  EAS_SEED_DATA_SYNCED_TO_DB_EVENT,
} from '@seedprotocol/sdk'
import { orderBy } from 'lodash-es'
import debug from 'debug'
import type { ModelValues } from '@seedprotocol/sdk'
import { Subscription } from 'xstate'
import type { IItem } from '@seedprotocol/sdk'
import { useIsClientReady } from './client'
import { useSeedAddressRevision } from './SeedSessionContext'
import { useLiveQuery } from './liveQuery'
import { BaseDb } from '@seedprotocol/sdk'
import { seeds } from '@seedprotocol/sdk'
import { and, eq, gt, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm'
import { toSnakeCase } from 'drizzle-orm/casing'
import type { SeedType } from '@seedprotocol/sdk'
import { getVersionData } from '@seedprotocol/sdk'
import { useQuery, useQueryClient } from '@tanstack/react-query'

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
  /** Bumped when EAS sync updates SQLite so cached `Item` instances re-render after in-place hydration. */
  const [, setEasHydrationTick] = useState(0)
  const [isLoading, setIsLoading] = useState(!!(seedLocalId || seedUid))
  const [error, setError] = useState<Error | null>(null)
  const subscriptionRef = useRef<Subscription | undefined>(undefined)
  const hasSeenIdleRef = useRef(false)

  const isClientReady = useIsClientReady()
  const addressRevision = useSeedAddressRevision()

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
        // Don't clear item if we already have one for the same request (e.g. duplicate loadItem from effect re-run)
        setItem((prev) => {
          if (!prev) return undefined
          const match = (prev.seedLocalId && prev.seedLocalId === seedLocalIdRef.current) ||
            (prev.seedUid && prev.seedUid === seedUidRef.current)
          return match ? prev : undefined
        })
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

  const loadItemRef = useRef(loadItem)
  useEffect(() => {
    loadItemRef.current = loadItem
  }, [loadItem])

  useEffect(() => {
    modelNameRef.current = modelName
    seedLocalIdRef.current = seedLocalId
    seedUidRef.current = seedUid
  }, [modelName, seedLocalId, seedUid])

  useEffect(() => {
    const onEasSynced = () => {
      setEasHydrationTick((n) => n + 1)
      void loadItemRef.current()
    }
    eventEmitter.on(EAS_SEED_DATA_SYNCED_TO_DB_EVENT, onEasSynced)
    return () => {
      eventEmitter.off(EAS_SEED_DATA_SYNCED_TO_DB_EVENT, onEasSynced)
    }
  }, [])

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
  }, [shouldLoad, loadItem, seedLocalId, seedUid, addressRevision])

  // Subscribe to service changes when item is available
  useEffect(() => {
    if (!item) {
      // Clean up subscription if item is not available
      subscriptionRef.current?.unsubscribe()
      subscriptionRef.current = undefined
      hasSeenIdleRef.current = false
      return
    }

    // Clean up previous subscription
    subscriptionRef.current?.unsubscribe()
    hasSeenIdleRef.current = false

    // Subscribe to service changes. Only set isLoading to true after we've seen idle at least
    // once, so we don't overwrite the ready state that loadItem() just set (find() waits for idle).
    const service = item.getService()

    const subscription = service.subscribe((snapshot: any) => {
      // Update loading state based on service state changes
      if (snapshot && typeof snapshot === 'object' && 'value' in snapshot) {
        const isIdle = snapshot.value === 'idle'
        if (isIdle) {
          hasSeenIdleRef.current = true
          setIsLoading(false)
          setError(null)
        } else if (snapshot.value === 'error') {
          setError(new Error('Item service error'))
          setIsLoading(false)
        } else {
          // Only show loading if we've already seen idle (real transition to loading)
          if (hasSeenIdleRef.current) {
            setIsLoading(true)
          }
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
  includeEas?: boolean
  addressFilter?: 'owned' | 'watched' | 'all'
}

type UseItems = (props: UseItemsProps) => UseItemsReturn

const getItemsQueryKey = (
  modelName?: string,
  deleted?: boolean,
  includeEas?: boolean,
  addressFilter?: 'owned' | 'watched' | 'all',
  addressRevision?: number,
) =>
  [
    'seed',
    'items',
    modelName ?? null,
    deleted ?? false,
    includeEas ?? false,
    addressFilter ?? null,
    addressRevision ?? 0,
  ] as const

/**
 * Lists items for an optional model (and filters) with TanStack Query plus a SQLite live query.
 *
 * - This hook uses `staleTime: 0` on its query so the list does not inherit Seed’s default
 *   long freshness window; local data is kept in sync via live-query invalidation, and remounts
 *   can refetch when the cache is stale.
 * - Schema-backed fields on each `IItem` (e.g. list relation properties) read from the item
 *   machine and may be `undefined` until that property is loaded; normalize for forms
 *   (e.g. `Array.isArray(x) ? x : []`).
 */
export const useItems: UseItems = ({
  modelName,
  deleted = false,
  includeEas = false,
  addressFilter,
}) => {
  const isClientReady = useIsClientReady()
  const addressRevision = useSeedAddressRevision()
  const queryClient = useQueryClient()

  useEffect(() => {
    const onEasSynced = () => {
      queryClient.invalidateQueries({ queryKey: ['seed', 'items'] })
    }
    eventEmitter.on(EAS_SEED_DATA_SYNCED_TO_DB_EVENT, onEasSynced)
    return () => {
      eventEmitter.off(EAS_SEED_DATA_SYNCED_TO_DB_EVENT, onEasSynced)
    }
  }, [queryClient])

  const itemsRef = useRef<IItem<any>[]>([])
  const lastFetchedIdsRef = useRef<Set<string>>(new Set())
  const hasSeenLiveSeedsSnapshotRef = useRef(false)
  const [addressesForFilter, setAddressesForFilter] = useState<string[] | null>(null)

  useEffect(() => {
    if (addressFilter !== 'owned' && addressFilter !== 'watched') {
      setAddressesForFilter(null)
      return
    }
    let cancelled = false
    getAddressesForItemsFilter(addressFilter).then((addrs) => {
      if (!cancelled) setAddressesForFilter(addrs)
    })
    return () => {
      cancelled = true
    }
  }, [addressFilter, addressRevision])

  const queryKey = useMemo(
    () => getItemsQueryKey(modelName, deleted, includeEas, addressFilter, addressRevision),
    [modelName, deleted, includeEas, addressFilter, addressRevision],
  )

  useEffect(() => {
    hasSeenLiveSeedsSnapshotRef.current = false
  }, [queryKey])

  const {
    data: items = [],
    isLoading,
    error: queryError,
  } = useQuery({
    queryKey,
    queryFn: async () => {
      const rows = await Item.all(modelName, deleted, {
        waitForReady: true,
        includeEas,
        addressFilter,
      })
      return rows
    },
    enabled: isClientReady,
    // Local SQLite + live invalidation drive freshness; Seed’s default staleTime would keep a
    // mistaken initial [] “fresh” and block refetch when another subscriber mounts.
    staleTime: 0,
  })
  itemsRef.current = items

  // Watch the seeds table for changes
  const db = isClientReady ? BaseDb.getAppDb() : null
  const seedsQuery = useMemo(() => {
    if (!db) return null
    if (addressFilter === 'owned' || addressFilter === 'watched') {
      if (addressesForFilter === null) return null
    }
    const conditions: any[] = []
    if (!includeEas) {
      conditions.push(or(isNull(seeds.uid), eq(seeds.uid, '')) as any)
    }
    if (modelName) {
      conditions.push(eq(seeds.type, toSnakeCase(modelName)))
    }
    if (addressFilter === 'owned') {
      if (addressesForFilter && addressesForFilter.length > 0) {
        conditions.push(
          or(
            inArray(seeds.publisher, addressesForFilter),
            isNull(seeds.publisher)
          ) as any
        )
      }
    } else if (addressFilter === 'watched') {
      if (addressesForFilter && addressesForFilter.length > 0) {
        conditions.push(inArray(seeds.publisher, addressesForFilter) as any)
      } else {
        conditions.push(sql`1=0` as any)
      }
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
      conditions.push(
        or(isNull(seeds.revokedAt), eq(seeds.revokedAt, 0)) as any
      )
    }
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
  }, [db, isClientReady, modelName, deleted, includeEas, addressFilter, addressesForFilter])
  const seedsTableData = useLiveQuery<SeedType>(seedsQuery)

  // Invalidate when table data actually changes so useQuery refetches
  useEffect(() => {
    if (!isClientReady || !seedsTableData) return

    const tableDataItemsSet = new Set<string>()
    for (const dbSeed of seedsTableData) {
      const key = dbSeed.localId || dbSeed.uid
      if (key) tableDataItemsSet.add(key)
    }

    const currentItemsSet = new Set<string>()
    for (const item of itemsRef.current) {
      const key = item.seedLocalId || item.seedUid
      if (key) currentItemsSet.add(key)
    }

    if (tableDataItemsSet.size === 0 && currentItemsSet.size > 0) {
      return
    }

    if (!hasSeenLiveSeedsSnapshotRef.current) {
      hasSeenLiveSeedsSnapshotRef.current = true
      if (tableDataItemsSet.size > 0 && currentItemsSet.size === 0) {
        lastFetchedIdsRef.current = new Set(tableDataItemsSet)
        queryClient.invalidateQueries({ queryKey })
        return
      }
    }

    const lastFetched = lastFetchedIdsRef.current
    if (
      lastFetched.size === tableDataItemsSet.size &&
      [...lastFetched].every((id) => tableDataItemsSet.has(id))
    ) {
      return
    }

    const setsAreEqual =
      currentItemsSet.size === tableDataItemsSet.size &&
      [...currentItemsSet].every((id) => tableDataItemsSet.has(id))

    if (setsAreEqual) {
      lastFetchedIdsRef.current = new Set(tableDataItemsSet)
      return
    }

    lastFetchedIdsRef.current = new Set(tableDataItemsSet)
    queryClient.invalidateQueries({ queryKey })
  }, [isClientReady, seedsTableData, queryClient, queryKey])

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
    error: queryError as Error | null,
  }
}

export type UseCreateItemReturn = {
  createItem: (modelName: string, itemData?: Record<string, any>) => Promise<Item<any> | undefined>
  isLoading: boolean
  error: Error | null
  resetError: () => void
}

export const useCreateItem = (): UseCreateItemReturn => {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const resetError = useCallback(() => setError(null), [])

  const createItem = useCallback(
    async (modelName: string, itemData?: Record<string, any>): Promise<Item<any> | undefined> => {
      if (isLoading) {
        logger('[useCreateItem] [createItem] already creating item, skipping')
        return undefined
      }

      setError(null)
      // Flush loading=true synchronously so the UI (and tests) can observe it before async work runs.
      flushSync(() => setIsLoading(true))

      try {
        const data = itemData ?? {}
        const { seedLocalId } = await createNewItem({ modelName, ...data })
        const newItem = await Item.find({ modelName, seedLocalId })
        return (newItem ?? undefined) as Item<any> | undefined
      } catch (err) {
        logger('[useCreateItem] Error creating item:', err)
        setError(err instanceof Error ? err : new Error(String(err)))
        return undefined
      } finally {
        // Defer clearing loading so React can commit the loading=true render first.
        // Otherwise the test (or UI) may never observe isLoading true (same continuation batching).
        queueMicrotask(() => setIsLoading(false))
      }
    },
    [isLoading],
  )

  return {
    createItem,
    isLoading,
    error,
    resetError,
  }
}

type UsePublishItemReturn = {
  publishItem: (item: Item<any> | undefined) => void
  isLoading: boolean
  error: Error | null
  resetError: () => void
}

export const usePublishItem = (): UsePublishItemReturn => {
  const [publishingItem, setPublishingItem] = useState<Item<any> | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const subscriptionRef = useRef<Subscription | undefined>(undefined)

  const resetError = useCallback(() => setError(null), [])

  const publishItem = useCallback((item: Item<any> | undefined) => {
    if (!item) return
    setPublishingItem(item)
    setError(null)
    item.publish().catch(() => {
      // Error is surfaced via service state subscription; avoid unhandled rejection
    })
  }, [])

  useEffect(() => {
    if (!publishingItem) {
      subscriptionRef.current?.unsubscribe()
      subscriptionRef.current = undefined
      setIsLoading(false)
      return
    }

    subscriptionRef.current?.unsubscribe()
    const service = publishingItem.getService()
    const subscription = service.subscribe((snapshot: any) => {
      const value = snapshot?.value
      const ctx = snapshot?.context
      setIsLoading(value === 'publishing')
      const publishError = ctx?._publishError
      setError(publishError ? new Error(publishError.message) : null)
    })

    subscriptionRef.current = subscription
    const snap = service.getSnapshot()
    setIsLoading(snap?.value === 'publishing')
    const ctx = snap?.context
    const publishError = ctx?._publishError
    setError(publishError ? new Error(publishError.message) : null)

    return () => {
      subscriptionRef.current?.unsubscribe()
      subscriptionRef.current = undefined
    }
  }, [publishingItem])

  return {
    publishItem,
    isLoading,
    error,
    resetError,
  }
}
