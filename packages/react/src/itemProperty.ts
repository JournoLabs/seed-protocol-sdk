import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Subscription, SnapshotFrom } from 'xstate'
import debug from 'debug'
import { ItemProperty } from '@seedprotocol/sdk'
import { useIsClientReady } from './client'
import type { IItemProperty } from '@seedprotocol/sdk'
import { useLiveQuery } from './liveQuery'
import { BaseDb } from '@seedprotocol/sdk'
import { metadata } from '@seedprotocol/sdk'
import { seeds } from '@seedprotocol/sdk'
import { and, eq, isNotNull } from 'drizzle-orm'
import { getMetadataLatest } from '@seedprotocol/sdk'
import { propertyMachine } from '@seedprotocol/sdk'
import { debounce, startCase } from 'lodash-es'
import { useQuery, useQueryClient } from '@tanstack/react-query'

const logger = debug('seedSdk:react:property')
const propertiesLogger = debug('seedSdk:react:itemProperties')

type ItemPropertySnapshot = SnapshotFrom<typeof propertyMachine>

type UseItemPropertyReturn = {
  property: IItemProperty | undefined
  isLoading: boolean
  error: Error | null
}

/**
 * Hook to get a specific ItemProperty instance
 * Can be called in multiple ways:
 * 1. With seedLocalId/seedUid and propertyName: useItemProperty({ seedLocalId, propertyName }) or useItemProperty({ seedUid, propertyName })
 * 2. With itemId and propertyName: useItemProperty(itemId, propertyName) or useItemProperty({ itemId, propertyName })
 * 
 * @overload
 * @param props - Object with seedLocalId or seedUid, and propertyName
 * @returns Object with property, isLoading, and error
 * 
 * @overload
 * @param props - Object with itemId and propertyName
 * @returns Object with property, isLoading, and error
 * 
 * @overload
 * @param itemId - The item ID (seedLocalId or seedUid)
 * @param propertyName - The name of the property
 * @returns Object with property, isLoading, and error
 */
export function useItemProperty(props: {
  seedLocalId?: string
  seedUid?: string
  propertyName: string
}): UseItemPropertyReturn
export function useItemProperty(props: {
  itemId?: string
  propertyName: string
}): UseItemPropertyReturn
export function useItemProperty(
  itemId: string,
  propertyName: string
): UseItemPropertyReturn
export function useItemProperty(
  arg1:
    | { seedLocalId?: string; seedUid?: string; propertyName: string }
    | { itemId: string; propertyName: string }
    | string,
  arg2?: string
) {
  const isClientReady = useIsClientReady()
  const [property, setProperty] = useState<IItemProperty | undefined>(undefined)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const subscriptionRef = useRef<Subscription | undefined>(undefined)
  const [, setVersion] = useState(0) // Version counter to force re-renders

  // Extract primitives so useMemo/useCallback deps are stable when caller passes inline objects
  // Support object form with itemId: useItemProperty({ itemId, propertyName })
  const arg1IsObject = typeof arg1 === 'object' && arg1 != null
  const obj = arg1IsObject ? (arg1 as Record<string, unknown>) : null
  const itemIdFromObj = obj != null ? (obj.itemId as string | undefined) : undefined
  const seedLocalId =
    obj != null ? (obj.seedLocalId as string | undefined) : undefined
  const seedUid =
    obj != null ? (obj.seedUid as string | undefined) : undefined
  const propertyNameFromObj =
    obj != null ? (obj.propertyName as string | undefined) : undefined
  const itemId =
    typeof arg1 === 'string' ? arg1 : (itemIdFromObj !== undefined && itemIdFromObj !== '' ? itemIdFromObj : undefined)
  const propertyNameFromArgs = typeof arg1 === 'string' ? arg2 : undefined
  const propertyName = propertyNameFromObj ?? propertyNameFromArgs

  // Determine which lookup mode we're in based on arguments (deps are primitives to avoid infinite loop)
  // Unify itemId and identifiers: when itemId is provided (string or object form), use it as seedLocalId so we hit the same code path
  const lookupMode = useMemo(() => {
    const resolvedSeedLocalId = (itemId !== undefined && itemId !== '') ? itemId : seedLocalId
    const resolvedSeedUid = (itemId !== undefined && itemId !== '') ? undefined : seedUid
    if ((resolvedSeedLocalId != null || resolvedSeedUid != null) && propertyName != null && propertyName !== '') {
      return {
        type: 'identifiers' as const,
        seedLocalId: resolvedSeedLocalId ?? undefined,
        seedUid: resolvedSeedUid,
        propertyName,
      }
    }
    return null
  }, [itemId, propertyName, seedLocalId, seedUid])

  // Determine initial loading state
  const initialLoadingState = useMemo(() => {
    if (!lookupMode) return false
    return !!(
      (lookupMode.seedLocalId || lookupMode.seedUid) &&
      lookupMode.propertyName
    )
  }, [lookupMode])

  // Determine if we should be loading based on parameters
  const shouldLoad = useMemo(() => {
    if (!isClientReady) return false
    if (!lookupMode) return false
    return !!(
      (lookupMode.seedLocalId || lookupMode.seedUid) &&
      lookupMode.propertyName
    )
  }, [isClientReady, lookupMode])

  const updateItemProperty = useCallback(async () => {
    if (!isClientReady || !lookupMode) {
      setProperty(undefined)
      setIsLoading(false)
      setError(null)
      return
    }

    try {
      setIsLoading(true)
      setError(null)

      const seedLocalId = lookupMode.seedLocalId
      const seedUid = lookupMode.seedUid

      if (!seedLocalId && !seedUid) {
        setProperty(undefined)
        setIsLoading(false)
        setError(null)
        return
      }

      const foundProperty = await ItemProperty.find({
        propertyName: lookupMode.propertyName,
        seedLocalId,
        seedUid,
      })

      if (!foundProperty) {
        logger(
          `[useItemProperty] [updateItemProperty] no property found for Item.${seedLocalId || seedUid}.${lookupMode.propertyName}`,
        )
        setProperty(undefined)
        setIsLoading(false)
        setError(null)
        return
      }

      // ItemProperty.find() now waits for idle by default, so the property should be ready
      setProperty(foundProperty)
      setIsLoading(false) // Property is ready since find() waited for idle
      setError(null)
    } catch (error) {
      logger('[useItemProperty] Error updating item property:', error)
      setProperty(undefined)
      setIsLoading(false)
      setError(error as Error)
    }
  }, [isClientReady, lookupMode])

  // Fetch/refetch when lookup parameters change or client becomes ready.
  // Skip refetch when we already have the property for this lookup (avoids setting loading true
  // again when effect re-runs e.g. from Strict Mode or updateItemProperty identity change).
  // Match by the active identifier only: when looking up by seedLocalId both must match;
  // when looking up by seedUid both must match. Do not use (seedUid === undefined) as a match
  // when seedLocalIds differ, which would incorrectly skip refetch after seedLocalId change.
  useEffect(() => {
    if (!shouldLoad) {
      setProperty(undefined)
      setIsLoading(false)
      setError(null)
      return
    }
    const alreadyHavePropertyGuard =
      property &&
      lookupMode &&
      property.propertyName === lookupMode.propertyName &&
      ((lookupMode.seedLocalId != null && property.seedLocalId === lookupMode.seedLocalId) ||
        (lookupMode.seedUid != null && (property as any).seedUid === lookupMode.seedUid))
    if (alreadyHavePropertyGuard) return
    updateItemProperty()
  }, [shouldLoad, updateItemProperty, property, lookupMode])

  // Subscribe to service changes when property is available
  useEffect(() => {
    if (!property) {
      // Clean up subscription if property is not available
      subscriptionRef.current?.unsubscribe()
      subscriptionRef.current = undefined
      return
    }

    // Clean up previous subscription
    subscriptionRef.current?.unsubscribe()

    // Subscribe to service changes. Only set isLoading to false when idle; never set to true
    // here so we never overwrite the loaded state when the machine emits any non-idle state
    // (e.g. loading, initializing, resolvingRelatedValue) after the initial fetch.
    let lastVersionAt = 0
    let wasIdle = false
    const THROTTLE_MS = 50
    const subscription = property.getService().subscribe((snapshot: any) => {
      const isIdle = snapshot && typeof snapshot === 'object' && 'value' in snapshot && snapshot.value === 'idle'
      if (isIdle) {
        setIsLoading(false)
        setError(null)
        // Only update when transitioning TO idle (not on every idle snapshot - machine emits many)
        if (!wasIdle) {
          wasIdle = true
          setVersion(prev => prev + 1)
        }
        return
      }
      wasIdle = false
      // Throttle re-renders during transitions: property machine emits many snapshots
      const now = Date.now()
      if (now - lastVersionAt >= THROTTLE_MS) {
        lastVersionAt = now
        setVersion(prev => prev + 1)
      }
    })
    
    subscriptionRef.current = subscription

    return () => {
      subscriptionRef.current?.unsubscribe()
      subscriptionRef.current = undefined
    }
  }, [property])

  return {
    property,
    isLoading,
    error,
  }
}

type UseDebouncedItemPropertyParams =
  | { seedLocalId?: string; seedUid?: string; propertyName: string }
  | { itemId: string; propertyName: string }

type UseDebouncedItemPropertyReturn = {
  property: IItemProperty | undefined
  setValue: (value: string) => void
  isLoading: boolean
  error: Error | null
}

/**
 * Hook for real-time ItemProperty updates with debounced persistence.
 * Updates the display immediately on each change while debouncing writes to the database.
 * Use this for text inputs and other high-frequency updates.
 *
 * @param params - Same as useItemProperty: { seedLocalId, propertyName }, { seedUid, propertyName }, or { itemId, propertyName }
 * @param debounceMs - Debounce delay for persistence (default: 300)
 */
export function useDebouncedItemProperty(
  params: UseDebouncedItemPropertyParams,
  debounceMs = 300
): UseDebouncedItemPropertyReturn {
  const itemId = 'itemId' in params ? params.itemId : undefined
  const seedLocalId = 'seedLocalId' in params ? params.seedLocalId : undefined
  const seedUid = 'seedUid' in params ? params.seedUid : undefined
  const propertyName = params.propertyName

  const normalizedParams = useMemo(() => {
    if (itemId) {
      return { seedLocalId: itemId, propertyName }
    }
    return { seedLocalId, seedUid, propertyName }
  }, [itemId, seedLocalId, seedUid, propertyName])

  const { property, isLoading, error } = useItemProperty(normalizedParams)
  const latestValueRef = useRef<string>('')

  const debouncedPersist = useMemo(
    () =>
      debounce((prop: IItemProperty) => {
        prop.getService().send({
          type: 'save',
          newValue: latestValueRef.current,
        })
      }, debounceMs),
    [debounceMs]
  )

  useEffect(() => {
    return () => debouncedPersist.cancel()
  }, [debouncedPersist])

  const setValue = useCallback(
    (value: string) => {
      if (!property) return
      latestValueRef.current = value
      property.getService().send({
        type: 'updateContext',
        propertyValue: value,
        renderValue: value,
      })
      debouncedPersist(property)
    },
    [property, debouncedPersist]
  )

  return {
    property,
    setValue,
    isLoading,
    error,
  }
}

type UseItemPropertiesReturn = {
  properties: IItemProperty[]
  isLoading: boolean
  error: Error | null
}

/** Fetches item properties list for useQuery (shared with useItemProperties). */
async function fetchItemPropertiesList(
  seedLocalId: string | undefined,
  seedUid: string | undefined
): Promise<IItemProperty[]> {
  if (!seedLocalId && !seedUid) return []
  const db = BaseDb.getAppDb()
  if (!db) return []

  const baseList = await ItemProperty.all(
    { seedLocalId: seedLocalId ?? undefined, seedUid: seedUid ?? undefined },
    { waitForReady: true },
  )
  const _itemProperties: IItemProperty[] = [...(baseList as IItemProperty[])]

  const propertiesWithMetadata = new Set<string>()
  for (const p of baseList) {
    if (p.propertyName) propertiesWithMetadata.add(p.propertyName)
  }

  let modelName: string | undefined
  if (baseList.length > 0) {
    const first = baseList[0]
    modelName = first.modelName ?? (first as any).modelType
    if (modelName && typeof modelName === 'string') modelName = startCase(modelName)
  }
  if (!modelName) {
    const seedRecords = await db
      .select({ type: seeds.type })
      .from(seeds)
      .where(seedUid ? eq(seeds.uid, seedUid) : eq(seeds.localId, seedLocalId!))
      .limit(1)
    if (seedRecords.length > 0 && seedRecords[0].type) {
      modelName = startCase(seedRecords[0].type)
    }
  }

  const modelProperties: string[] = []
  if (modelName) {
    try {
      const { Model } = await import('@seedprotocol/sdk')
      const model = await Model.getByNameAsync(modelName)
      if (model?.properties) {
        for (const modelProperty of model.properties) {
          if (modelProperty.name) modelProperties.push(modelProperty.name)
        }
      }
    } catch (error) {
      propertiesLogger(`[useItemProperties] Error getting ModelProperties for ${modelName}:`, error)
    }
  }

  if (modelName && modelProperties.length > 0) {
    const resolvedSeedLocalId = baseList.length > 0 ? (baseList[0].seedLocalId ?? seedLocalId) : seedLocalId
    const resolvedSeedUid = baseList.length > 0 ? (baseList[0].seedUid ?? seedUid) : seedUid
    for (const propertyName of modelProperties) {
      if (propertiesWithMetadata.has(propertyName)) continue
      try {
        const itemProperty = ItemProperty.create(
          {
            propertyName,
            modelName,
            seedLocalId: resolvedSeedLocalId || undefined,
            seedUid: resolvedSeedUid || undefined,
            propertyValue: null,
          },
          { waitForReady: false },
        )
        if (itemProperty) _itemProperties.push(itemProperty as any as IItemProperty)
      } catch (error) {
        logger(`[useItemProperties] Error creating ItemProperty for missing property ${propertyName}:`, error)
      }
    }
  }

  if (seedLocalId || seedUid) {
    const seedRecords = await db
      .select({ createdAt: seeds.createdAt })
      .from(seeds)
      .where(seedUid ? eq(seeds.uid, seedUid) : eq(seeds.localId, seedLocalId!))
      .limit(1)
    if (seedRecords.length > 0 && seedRecords[0].createdAt) {
      const createdAtPropertyName = 'createdAt'
      const hasCreatedAtProperty = _itemProperties.some((p) => p.propertyName === createdAtPropertyName)
      if (!hasCreatedAtProperty && modelName) {
        try {
          const resolvedSeedLocalId = baseList.length > 0 ? (baseList[0].seedLocalId ?? seedLocalId) : seedLocalId
          const resolvedSeedUid = baseList.length > 0 ? (baseList[0].seedUid ?? seedUid) : seedUid
          const createdAtProperty = ItemProperty.create(
            {
              propertyName: createdAtPropertyName,
              modelName,
              seedLocalId: resolvedSeedLocalId || undefined,
              seedUid: resolvedSeedUid || undefined,
              propertyValue: seedRecords[0].createdAt.toString(),
            },
            { waitForReady: false },
          )
          if (createdAtProperty) _itemProperties.push(createdAtProperty as any as IItemProperty)
        } catch (error) {
          logger(`[useItemProperties] Error creating createdAt ItemProperty:`, error)
        }
      }
    }
  }

  return _itemProperties
}

/**
 * Hook to get all ItemProperty instances for a specific item
 * Can be called in multiple ways:
 * 1. With seedLocalId: useItemProperties({ seedLocalId })
 * 2. With seedUid: useItemProperties({ seedUid })
 * 3. With itemId: useItemProperties(itemId)
 * 
 * Uses useLiveQuery to watch for changes in the metadata table and automatically
 * updates the returned ItemProperty instances when changes occur.
 * 
 * @overload
 * @param props - Object with seedLocalId or seedUid
 * @returns Object with properties array, isLoading, and error
 * 
 * @overload
 * @param itemId - The item ID (seedLocalId or seedUid)
 * @returns Object with properties array, isLoading, and error
 */
export function useItemProperties(props: {
  seedLocalId?: string
  seedUid?: string
}): UseItemPropertiesReturn
export function useItemProperties(itemId: string): UseItemPropertiesReturn
export function useItemProperties(
  arg1: { seedLocalId?: string; seedUid?: string } | string
): UseItemPropertiesReturn {

  const isClientReady = useIsClientReady()
  const queryClient = useQueryClient()
  const previousTableDataRef = useRef<string | undefined>(undefined)

  // Determine which lookup mode we're in based on arguments
  const lookupMode = useMemo(() => {
    if (typeof arg1 === 'string') {
      // String argument: itemId (assumed to be seedLocalId)
      return { type: 'itemId' as const, itemId: arg1 }
    } else if (typeof arg1 === 'object') {
      // Object argument: { seedLocalId/seedUid }
      return {
        type: 'identifiers' as const,
        seedLocalId: arg1.seedLocalId,
        seedUid: arg1.seedUid,
      }
    } else {
      return null
    }
  }, [arg1])

  // Determine seedLocalId and seedUid for query
  const seedLocalId = useMemo(() => {
    if (!lookupMode) return undefined
    if (lookupMode.type === 'itemId') {
      return lookupMode.itemId
    } else {
      return lookupMode.seedLocalId
    }
  }, [lookupMode])

  const seedUid = useMemo(() => {
    if (!lookupMode || lookupMode.type === 'itemId') return undefined
    return lookupMode.seedUid
  }, [lookupMode])

  const canonicalItemKey = seedLocalId ?? seedUid ?? ''
  const itemPropertiesQueryKey = useMemo(
    () => (['seed', 'itemProperties', canonicalItemKey] as const),
    [canonicalItemKey],
  )

  const {
    data: properties = [],
    isLoading,
    error: queryError,
  } = useQuery({
    queryKey: itemPropertiesQueryKey,
    queryFn: () => fetchItemPropertiesList(seedLocalId, seedUid),
    enabled: isClientReady && !!canonicalItemKey,
  })

  // Watch the metadata table for changes
  // Query metadata table directly and filter for latest records in JavaScript
  // This is simpler and works better with useLiveQuery than CTEs
  // Get db inside useMemo to avoid recreating query on each render
  // Drizzle query builders are new objects each time, but useMemo will only recreate
  // when dependencies change, which is what we want for reactive queries
  const propertiesQuery = useMemo(() => {
    if (!isClientReady || (!seedLocalId && !seedUid)) {
      propertiesLogger('[useItemProperties] Query: returning null (not ready or no identifiers)')
      return null
    }
    
    const db = BaseDb.getAppDb()
    if (!db) {
      propertiesLogger('[useItemProperties] Query: returning null (no db)')
      return null
    }
    
    propertiesLogger(`[useItemProperties] Query: creating query for seedLocalId=${seedLocalId}, seedUid=${seedUid}`)
    
    // Query metadata table directly - we'll filter for latest records in JavaScript
    const query = seedUid
      ? db
          .select({
            propertyName: metadata.propertyName,
            propertyValue: metadata.propertyValue,
            seedLocalId: metadata.seedLocalId,
            seedUid: metadata.seedUid,
            modelType: metadata.modelType,
            schemaUid: metadata.schemaUid,
            createdAt: metadata.createdAt,
            attestationCreatedAt: metadata.attestationCreatedAt,
          })
          .from(metadata)
          .where(
            and(
              eq(metadata.seedUid, seedUid),
              isNotNull(metadata.propertyName)
            )
          )
      : seedLocalId
          ? db
              .select({
                propertyName: metadata.propertyName,
                propertyValue: metadata.propertyValue,
                seedLocalId: metadata.seedLocalId,
                seedUid: metadata.seedUid,
                modelType: metadata.modelType,
                schemaUid: metadata.schemaUid,
                createdAt: metadata.createdAt,
                attestationCreatedAt: metadata.attestationCreatedAt,
              })
              .from(metadata)
              .where(
                and(
                  eq(metadata.seedLocalId, seedLocalId),
                  isNotNull(metadata.propertyName)
                )
              )
          : null
    
    propertiesLogger(`[useItemProperties] Query: created query object`, { queryType: seedUid ? 'seedUid' : 'seedLocalId' })
    return query
  }, [isClientReady, seedLocalId, seedUid])
  
  const rawPropertiesTableData = useLiveQuery<{
    propertyName: string | null
    propertyValue: string | null
    seedLocalId: string | null
    seedUid: string | null
    modelType: string | null
    schemaUid: string | null
    createdAt: number | null
    attestationCreatedAt: number | null
  }>(propertiesQuery)
  
  // Filter for latest records (one per propertyName) in JavaScript
  const propertiesTableData = useMemo(() => {
    if (!rawPropertiesTableData || rawPropertiesTableData.length === 0) {
      return []
    }

    // Group by propertyName and keep only the latest record for each
    const latestByProperty = new Map<string, typeof rawPropertiesTableData[0]>()
    
    for (const record of rawPropertiesTableData) {
      if (!record.propertyName) continue
      
      const existing = latestByProperty.get(record.propertyName)
      if (!existing) {
        latestByProperty.set(record.propertyName, record)
      } else {
        // Compare timestamps to find the latest
        const existingTime = existing.attestationCreatedAt || existing.createdAt || 0
        const currentTime = record.attestationCreatedAt || record.createdAt || 0
        if (currentTime > existingTime) {
          latestByProperty.set(record.propertyName, record)
        }
      }
    }

    return Array.from(latestByProperty.values())
  }, [rawPropertiesTableData])

  // Invalidate when metadata table data actually changes so useQuery refetches
  useEffect(() => {
    if (!isClientReady || (!seedLocalId && !seedUid) || propertiesTableData === undefined) return

    // Include propertyValue so value-only changes produce a different string and trigger invalidation
    const tableDataString = JSON.stringify(
      propertiesTableData
        .map((p) => ({
          propertyName: p.propertyName,
          propertyValue: p.propertyValue,
          seedLocalId: p.seedLocalId,
          seedUid: p.seedUid,
        }))
        .sort((a, b) => (a.propertyName || '').localeCompare(b.propertyName || ''))
    )

    if (previousTableDataRef.current === tableDataString) return
    previousTableDataRef.current = tableDataString

    // Invalidate when metadata table data changed (new/updated/removed props or value changes)
    // so useQuery refetches and UI shows latest values.
    if (propertiesTableData.length > 0) {
      queryClient.invalidateQueries({ queryKey: itemPropertiesQueryKey })
    }
  }, [isClientReady, propertiesTableData, properties, seedLocalId, seedUid, queryClient, itemPropertiesQueryKey])

  useEffect(() => {
    previousTableDataRef.current = undefined
  }, [seedLocalId, seedUid])

  return {
    properties,
    isLoading,
    error: queryError as Error | null,
  }
}

export type UseCreateItemPropertyProps = {
  seedLocalId?: string
  seedUid?: string
  propertyName: string
  modelName: string
  propertyValue?: any
  versionLocalId?: string
  versionUid?: string
  [key: string]: any
}

export type UseCreateItemPropertyReturn = {
  create: (props: UseCreateItemPropertyProps) => IItemProperty | undefined
  isLoading: boolean
  error: Error | null
  resetError: () => void
}

/**
 * Hook to create an ItemProperty with loading and error state.
 * create(props) creates a new property instance for an item; provide seedLocalId or seedUid, propertyName, and modelName.
 */
export const useCreateItemProperty = (): UseCreateItemPropertyReturn => {
  const subscriptionRef = useRef<Subscription | undefined>(undefined)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const resetError = useCallback(() => setError(null), [])

  const create = useCallback((props: UseCreateItemPropertyProps): IItemProperty | undefined => {
    if (!props.propertyName || (!props.seedLocalId && !props.seedUid) || !props.modelName) {
      const err = new Error('seedLocalId or seedUid, propertyName, and modelName are required')
      setError(err)
      return undefined
    }

    setError(null)
    setIsLoading(true)
    subscriptionRef.current?.unsubscribe()
    subscriptionRef.current = undefined

    const instance = ItemProperty.create(props, { waitForReady: false })
    if (!instance) {
      setError(new Error('Failed to create item property'))
      setIsLoading(false)
      return undefined
    }

    const subscription = instance.getService().subscribe((snapshot: any) => {
      if (snapshot?.value === 'error') {
        const err = (snapshot.context as any)?._loadingError?.error ?? new Error('Failed to create item property')
        setError(err instanceof Error ? err : new Error(String(err)))
        setIsLoading(false)
      }
      if (snapshot?.value === 'idle') {
        setError(null)
        setIsLoading(false)
      }
    })
    subscriptionRef.current = subscription
    return instance
  }, [])

  useEffect(() => {
    return () => {
      subscriptionRef.current?.unsubscribe()
      subscriptionRef.current = undefined
    }
  }, [])

  return {
    create,
    isLoading,
    error,
    resetError,
  }
}

export type UseDestroyItemPropertyReturn = {
  destroy: (itemProperty: IItemProperty) => Promise<void>
  isLoading: boolean
  error: Error | null
  resetError: () => void
}

export const useDestroyItemProperty = (): UseDestroyItemPropertyReturn => {
  const [currentInstance, setCurrentInstance] = useState<IItemProperty | null>(null)
  const [destroyState, setDestroyState] = useState<{ isLoading: boolean; error: Error | null }>({
    isLoading: false,
    error: null,
  })

  useEffect(() => {
    if (!currentInstance) {
      setDestroyState({ isLoading: false, error: null })
      return
    }
    const service = currentInstance.getService()
    const update = () => {
      const snap = service.getSnapshot() as unknown as {
        context: { _destroyInProgress?: boolean; _destroyError?: { message: string } | null }
      }
      const ctx = snap.context
      setDestroyState({
        isLoading: !!ctx._destroyInProgress,
        error: ctx._destroyError ? new Error(ctx._destroyError.message) : null,
      })
    }
    update()
    const sub = service.subscribe(update)
    return () => sub.unsubscribe()
  }, [currentInstance])

  const destroy = useCallback(async (itemProperty: IItemProperty) => {
    if (!itemProperty) return
    setCurrentInstance(itemProperty)
    await itemProperty.destroy()
  }, [])

  const resetError = useCallback(() => {
    if (currentInstance) {
      currentInstance.getService().send({ type: 'clearDestroyError' })
    }
  }, [currentInstance])

  return {
    destroy,
    isLoading: destroyState.isLoading,
    error: destroyState.error,
    resetError,
  }
}
