import { useCallback, useEffect, useRef, useState, useMemo } from 'react'
import { flushSync } from 'react-dom'
import {
  getAddressesForItemsFilter,
  publisherInAddressListSql,
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
import { useSeedQueryClient } from './queryClient'
import { BaseDb } from '@seedprotocol/sdk'
import { seeds } from '@seedprotocol/sdk'
import { and, eq, gt, isNotNull, isNull, or } from 'drizzle-orm'
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

  // Follow the item's machine: busy after a real transition out of idle (reload), or error.
  useEffect(() => {
    hasSeenIdleRef.current = false
    setIsMachineBusy(false)
    setMachineError(null)
    if (!item) return

    const subscription: Subscription = item.getService().subscribe((snapshot: any) => {
      if (!snapshot || typeof snapshot !== 'object' || !('value' in snapshot)) return
      if (snapshot.value === 'idle') {
        hasSeenIdleRef.current = true
        setIsMachineBusy(false)
        setMachineError(null)
      } else if (snapshot.value === 'error') {
        setMachineError(new Error('Item service error'))
        setIsMachineBusy(false)
      } else if (hasSeenIdleRef.current) {
        // Only after idle, so the transitions find() already waited out don't count as loading.
        setIsMachineBusy(true)
      }
    })
    return () => subscription.unsubscribe()
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
    () => getItemsQueryKey(modelName, deleted, includeEas, addressFilter, addressRevision, modelFileId, schemaName),
    [modelName, deleted, includeEas, addressFilter, addressRevision, modelFileId, schemaName],
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
        modelFileId,
        schemaName,
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
    if (addressFilter === 'owned' || addressFilter === 'watched') {
      conditions.push(
        publisherInAddressListSql(seeds.publisher, addressesForFilter ?? []) as any,
      )
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
        // Item.create runs File/Image/Html values through their save pipeline; createNewItem stores them raw.
        const newItem = await Item.create({ modelName, ...data } as Parameters<typeof Item.create>[0])
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
