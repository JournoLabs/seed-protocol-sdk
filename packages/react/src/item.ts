import { useCallback, useEffect, useRef, useState, useMemo } from 'react'
import { flushSync } from 'react-dom'
import {
  getAddressesForItemsFilter,
  ownedSeedsSql,
  placeholderUidSql,
  publisherInAddressListSql,
  Item,
  eventEmitter,
  EAS_SEED_DATA_SYNCED_TO_DB_EVENT,
  isValidEasAttestationUid,
} from '@seedprotocol/sdk'
import { orderBy } from 'lodash-es'
import debug from 'debug'
import type { ModelValues } from '@seedprotocol/sdk'
import { Subscription } from 'xstate'
import type { IItem, IItemProperty, ItemCreateOptions, ItemPublishOptions } from '@seedprotocol/sdk'
import { useIsClientReady } from './client'
import { useSeedAddressRevision } from './SeedSessionContext'
import { useLiveQuery } from './liveQuery'
import { useSeedQueryClient } from './queryClient'
import { BaseDb } from '@seedprotocol/sdk'
import { seeds } from '@seedprotocol/sdk'
import { and, eq, gt, isNull, or } from 'drizzle-orm'
import { easName } from '@seedprotocol/sdk'
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

/** Query key for one item: `useItem`'s query. Invalidated alongside `['seed', 'items']`. */
export const getItemQueryKey = (id: string | undefined) => ['seed', 'item', id ?? null] as const

/**
 * Loads one Item by seedLocalId or seedUid.
 *
 * - An Item already in the instance cache and ready (`Item.peekReady`) comes back on the first
 *   render with `isLoading: false`, then `Item.find()` refreshes it in the background.
 * - Changing the id never returns the previous id's item.
 * - The item updates in place (its state machine), so the hook also re-renders on its changes.
 */
export const useItem: UseItem = <T extends ModelValues<T>>({ modelName, seedLocalId, seedUid }: UseItemProps) => {
  const id = seedLocalId || seedUid
  /** Bumped when EAS sync updates SQLite so cached `Item` instances re-render after in-place hydration. */
  const [, setEasHydrationTick] = useState(0)
  /** Bumped when one of the item's property values changes. */
  const [, setPropertyValuesTick] = useState(0)
  const [isMachineBusy, setIsMachineBusy] = useState(false)
  const [machineError, setMachineError] = useState<Error | null>(null)
  const hasSeenIdleRef = useRef(false)

  const isClientReady = useIsClientReady()
  const queryClient = useSeedQueryClient()
  const queryKey = useMemo(() => getItemQueryKey(id), [id])
  const queryKeyRef = useRef(queryKey)
  queryKeyRef.current = queryKey

  const query = useQuery(
    {
      queryKey,
      queryFn: async (): Promise<Item<T> | null> => {
        // A ready cached item is what find() would return, minus the cache hold find() takes.
        const found = (Item.peekReady(id) ??
          (await Item.find({ modelName, seedLocalId, seedUid }))) as Item<T> | undefined
        if (found) return found
        logger('[useItem] no item found', modelName, id)
        // find() also returns undefined when the item doesn't settle in time; keep what we have,
        // unless it was unloaded (e.g. a local purge stops the instance and deletes its rows).
        const previous = queryClient.getQueryData<Item<T> | null>(queryKey)
        return previous && previous.getService().getSnapshot().status === 'active' ? previous : null
      },
      // The Item instance cache is the cache. A ready cached item is the first render's data and
      // staleTime 0 refreshes it in the background; gcTime 0 drops the query once unused, so it
      // never hands out an instance that was unloaded since.
      initialData: () => Item.peekReady(id) as Item<T> | undefined,
      staleTime: 0,
      gcTime: 0,
      // An Item is a live actor-backed object, not data to compare field by field.
      structuralSharing: false,
      retry: false,
      enabled: isClientReady && !!id,
    },
    queryClient,
  )
  const item = query.data ?? undefined

  useEffect(() => {
    const onEasSynced = () => {
      setEasHydrationTick((n) => n + 1)
      void queryClient.invalidateQueries({ queryKey: queryKeyRef.current })
    }
    eventEmitter.on(EAS_SEED_DATA_SYNCED_TO_DB_EVENT, onEasSynced)
    return () => {
      eventEmitter.off(EAS_SEED_DATA_SYNCED_TO_DB_EVENT, onEasSynced)
    }
  }, [queryClient])

  // Follow the item: busy after it loaded and its machine left idle (publishing), or a failed load.
  useEffect(() => {
    hasSeenIdleRef.current = false
    setIsMachineBusy(false)
    setMachineError(null)
    if (!item) return

    const subscription: Subscription = item.getService().subscribe((snapshot: any) => {
      if (!snapshot || typeof snapshot !== 'object' || !('value' in snapshot)) return
      if (item.status === 'error') {
        setMachineError(new Error('Item service error'))
        setIsMachineBusy(false)
      } else if (item.status === 'ready' && snapshot.value === 'idle') {
        hasSeenIdleRef.current = true
        setIsMachineBusy(false)
        setMachineError(null)
      } else if (hasSeenIdleRef.current) {
        // Only after idle, so the transitions find() already waited out don't count as loading.
        setIsMachineBusy(true)
      }
    })
    return () => subscription.unsubscribe()
  }, [item])

  // Re-render when a property's value changes: the item reads them from its property instances,
  // which update without the item's own machine changing. The item adds instances as they load
  // (same Map, mutated), so recheck the set on each item snapshot.
  useEffect(() => {
    if (!item) return
    const itemService = item.getService()
    const propertySubscriptions = new Map<unknown, Subscription>()

    const followProperties = (propertyInstances: Map<PropertyKey, IItemProperty<any>> | undefined) => {
      const current = new Set(propertyInstances?.values() ?? [])
      for (const [instance, subscription] of propertySubscriptions) {
        if (!current.has(instance as IItemProperty<any>)) {
          subscription.unsubscribe()
          propertySubscriptions.delete(instance)
        }
      }
      for (const instance of current) {
        if (propertySubscriptions.has(instance)) continue
        const service = instance.getService()
        let { propertyValue, renderValue } = (service.getSnapshot() as any).context ?? {}
        propertySubscriptions.set(
          instance,
          service.subscribe((snapshot: any) => {
            const ctx = snapshot?.context
            if (!ctx) return
            if (Object.is(ctx.propertyValue, propertyValue) && Object.is(ctx.renderValue, renderValue)) return
            propertyValue = ctx.propertyValue
            renderValue = ctx.renderValue
            setPropertyValuesTick((n) => n + 1)
          }),
        )
      }
    }

    followProperties(itemService.getSnapshot().context.propertyInstances)
    const itemSubscription: Subscription = itemService.subscribe((snapshot: any) => {
      followProperties(snapshot?.context?.propertyInstances)
    })
    return () => {
      itemSubscription.unsubscribe()
      for (const subscription of propertySubscriptions.values()) subscription.unsubscribe()
    }
  }, [item])

  return {
    item,
    isLoading: (!!id && query.isPending) || isMachineBusy,
    error: machineError ?? (query.error as Error | null),
  }
}

type UseItemsReturn = {
  items: IItem<any>[]
  isLoading: boolean
  error: Error | null
}

type UseItemsProps = {
  modelName?: string
  /** Only items of one model, when several schemas define `modelName`: the schema that defines it ... */
  schemaName?: string
  /** ... or its Model.id. */
  modelFileId?: string
  deleted?: boolean
  includeEas?: boolean
  addressFilter?: 'owned' | 'watched' | 'all'
}

type UseItems = (props: UseItemsProps) => UseItemsReturn

/** A row of `useItems`' live query. */
type LiveSeedRow = Pick<SeedType, 'localId' | 'uid' | 'createdAt' | 'attestationCreatedAt'> & {
  lastVersionPublishedAt: number | null
}

/**
 * What `useItems` sorts and refreshes on from its live rows: when each seed was last published,
 * and a signature that changes when a listed seed is published, republished or reordered.
 */
type LiveSeedOrder = { signature: string; sortTimes: Map<string, number> }

const getLiveSeedOrder = (rows: LiveSeedRow[] | undefined): LiveSeedOrder => {
  const sortTimes = new Map<string, number>()
  const parts: string[] = []
  for (const row of rows ?? []) {
    if (!row.localId) continue
    // Drafts carry a placeholder uid (NULL, '' or zero bytes32): all the same unpublished state.
    const uid = isValidEasAttestationUid(row.uid) ? row.uid!.toLowerCase() : ''
    const sortTime = row.lastVersionPublishedAt || row.attestationCreatedAt || row.createdAt
    if (sortTime) sortTimes.set(row.localId, sortTime)
    parts.push(`${row.localId}:${uid}:${sortTime ?? ''}`)
  }
  return { signature: parts.sort().join(','), sortTimes }
}

const getItemsQueryKey = (
  modelName?: string,
  deleted?: boolean,
  includeEas?: boolean,
  addressFilter?: 'owned' | 'watched' | 'all',
  addressRevision?: number,
  modelFileId?: string,
  schemaName?: string,
) =>
  [
    'seed',
    'items',
    modelName ?? null,
    deleted ?? false,
    includeEas ?? false,
    addressFilter ?? null,
    addressRevision ?? 0,
    // Only scoped lists get the extra segment, so unscoped keys keep their existing shape.
    ...(modelFileId || schemaName ? [{ modelFileId: modelFileId ?? null, schemaName: schemaName ?? null }] : []),
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
  modelFileId,
  schemaName,
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
  // The live seed ids a refetch was last requested for.
  const lastFetchedIdsRef = useRef<Set<string>>(new Set())
  // Fetches started, and how many had started when the last refetch was requested. Only a fetch
  // started after the request can answer it: an invalidation while a fetch with no data yet is
  // running joins that fetch instead of starting one.
  const fetchesStartedRef = useRef(0)
  const refetchRequestedAtRef = useRef(0)
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
    () => getItemsQueryKey(modelName, deleted, includeEas, addressFilter, addressRevision, modelFileId, schemaName),
    [modelName, deleted, includeEas, addressFilter, addressRevision, modelFileId, schemaName],
  )

  useEffect(() => {
    lastFetchedIdsRef.current = new Set()
  }, [queryKey])

  const {
    data: items = [],
    isLoading,
    isFetching,
    dataUpdatedAt,
    error: queryError,
  } = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      fetchesStartedRef.current++
      const rows = await Item.all(modelName, deleted, {
        waitForReady: true,
        includeEas,
        addressFilter,
        modelFileId,
        schemaName,
        // A superseded fetch (new key, cancelled refetch, unmount) stops building items.
        signal,
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
    // Same predicates as getItemsData, so the live query and the fetched list agree.
    if (!includeEas) {
      conditions.push(placeholderUidSql(seeds.uid) as any)
    }
    if (modelName) {
      conditions.push(eq(seeds.type, easName(modelName)))
    }
    if (addressFilter === 'owned') {
      conditions.push(ownedSeedsSql(addressesForFilter ?? []) as any)
    } else if (addressFilter === 'watched') {
      conditions.push(
        publisherInAddressListSql(seeds.publisher, addressesForFilter ?? []) as any,
      )
    }
    if (deleted) {
      conditions.push(eq(seeds._markedForDeletion, 1) as any)
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
        lastVersionPublishedAt: versionData.lastVersionPublishedAt,
        _markedForDeletion: seeds._markedForDeletion,
      })
      .from(seeds)
      .leftJoin(versionData, eq(seeds.localId, versionData.seedLocalId))
      .where(and(gt(versionData.versionsCount, 0), ...conditions))
      .groupBy(seeds.localId)
  }, [db, isClientReady, modelName, deleted, includeEas, addressFilter, addressesForFilter])
  const seedsTableData = useLiveQuery<LiveSeedRow>(seedsQuery)

  // A publish keeps the seed's local id, so the refetch below doesn't run for it, and the Item
  // instances only take its uid in place. The list follows the live rows instead: a new order (and
  // a new array) whenever a listed seed's uid or publish time changes, and the same one otherwise.
  const liveSeedOrderRef = useRef<LiveSeedOrder>(getLiveSeedOrder(undefined))
  const nextLiveSeedOrder = getLiveSeedOrder(seedsTableData)
  if (nextLiveSeedOrder.signature !== liveSeedOrderRef.current.signature) {
    liveSeedOrderRef.current = nextLiveSeedOrder
  }
  const liveSeedOrder = liveSeedOrderRef.current

  // Refetch when the live seed ids differ from the listed items.
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

    if (sameIds(currentItemsSet, tableDataItemsSet)) {
      lastFetchedIdsRef.current = tableDataItemsSet
      return
    }

    const requestRefetch = () => {
      lastFetchedIdsRef.current = tableDataItemsSet
      refetchRequestedAtRef.current = fetchesStartedRef.current
      queryClient.invalidateQueries({ queryKey })
    }

    if (!sameIds(lastFetchedIdsRef.current, tableDataItemsSet)) {
      requestRefetch()
      return
    }

    // A refetch was already requested for these ids. If a fetch started after the request, it
    // answers it, or failed and retries on its own: Item.all and the live query can disagree
    // (an item still loading), so don't loop.
    if (fetchesStartedRef.current > refetchRequestedAtRef.current) return
    // The request joined a fetch that started before the change. Wait for it to settle (this
    // effect runs again then), and refetch: it listed the old ids.
    if (isFetching) return
    requestRefetch()
  }, [isClientReady, seedsTableData, queryClient, queryKey, dataUpdatedAt, isFetching])

  // Same array while the data is the same, so `items` can be an effect/memo dependency. The live
  // rows' times come first: an Item instance keeps the publish times it loaded with.
  const sortedItems = useMemo(
    () =>
      orderBy(
        items,
        [
          (item) =>
            (item.seedLocalId && liveSeedOrder.sortTimes.get(item.seedLocalId)) ||
            item.lastVersionPublishedAt ||
            item.attestationCreatedAt ||
            item.createdAt,
        ],
        ['desc'],
      ),
    [items, liveSeedOrder],
  )

  return {
    items: sortedItems,
    // Before the client is ready the query is disabled, which TanStack reports as not loading:
    // count it as loading so an empty list isn't shown as "no items" first.
    isLoading: isLoading || !isClientReady,
    error: queryError as Error | null,
  }
}

export type UseCreateItemReturn = {
  /**
   * Calls `Item.create({ modelName, ...itemData }, options)`. A call made while another is in
   * flight returns that call's promise (and its item) instead of creating a second one.
   */
  createItem: (
    modelName: string,
    itemData?: Record<string, any>,
    options?: ItemCreateOptions,
  ) => Promise<Item<any> | undefined>
  isLoading: boolean
  error: Error | null
  resetError: () => void
}

export const useCreateItem = (): UseCreateItemReturn => {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  // A ref, not the isLoading state: two calls before a re-render both saw isLoading false.
  const inFlightRef = useRef<Promise<Item<any> | undefined> | null>(null)

  const resetError = useCallback(() => setError(null), [])

  const createItem = useCallback(
    (
      modelName: string,
      itemData?: Record<string, any>,
      options?: ItemCreateOptions,
    ): Promise<Item<any> | undefined> => {
      if (inFlightRef.current) {
        logger('[useCreateItem] [createItem] already creating item, returning the in-flight create')
        return inFlightRef.current
      }

      setError(null)
      // Flush loading=true synchronously so the UI (and tests) can observe it before async work runs.
      flushSync(() => setIsLoading(true))

      const run = async (): Promise<Item<any> | undefined> => {
        try {
          const data = itemData ?? {}
          // Item.create runs File/Image/Html values through their save pipeline; createNewItem stores them raw.
          const newItem = await Item.create({ modelName, ...data } as Parameters<typeof Item.create>[0], options)
          return (newItem ?? undefined) as Item<any> | undefined
        } catch (err) {
          logger('[useCreateItem] Error creating item:', err)
          setError(err instanceof Error ? err : new Error(String(err)))
          return undefined
        } finally {
          inFlightRef.current = null
          // Defer clearing loading so React can commit the loading=true render first.
          // Otherwise the test (or UI) may never observe isLoading true (same continuation batching).
          queueMicrotask(() => setIsLoading(false))
        }
      }
      const promise = run()
      inFlightRef.current = promise
      return promise
    },
    [],
  )

  return {
    createItem,
    isLoading,
    error,
    resetError,
  }
}

type UsePublishItemReturn = {
  /**
   * Calls `item.publish(options)`, which needs @seedprotocol/publish: `initPublish()` or
   * `<PublishProvider config>` must have run, or `error` reports that publishing is not configured.
   */
  publishItem: (item: Item<any> | undefined, options?: ItemPublishOptions) => void
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

  const publishItem = useCallback((item: Item<any> | undefined, options?: ItemPublishOptions) => {
    if (!item) return
    setPublishingItem(item)
    setError(null)
    // The promise is the one source of errors: it also rejects before the item machine
    // starts (publishing not configured, item not owned, already publishing).
    item.publish(options).catch((err: unknown) => {
      setError(err instanceof Error ? err : new Error(String(err)))
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
      setIsLoading(snapshot?.value === 'publishing')
    })

    subscriptionRef.current = subscription
    setIsLoading(service.getSnapshot()?.value === 'publishing')

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

function sameIds(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && [...a].every((id) => b.has(id))
}
