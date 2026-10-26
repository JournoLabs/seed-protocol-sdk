import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Subscription } from 'xstate'
import debug from 'debug'
import { ItemProperty, ItemPropertySaveValidationError } from '@seedprotocol/sdk'
import { useIsClientReady } from './client'
import type { ChangeWatch, IItemProperty } from '@seedprotocol/sdk'
import { useEntityRowsState } from './entityRows'
import { useSeedQueryClient } from './queryClient'
import { BaseDb } from '@seedprotocol/sdk'
import { metadata } from '@seedprotocol/sdk'
import { seeds } from '@seedprotocol/sdk'
import { and, eq, isNotNull } from 'drizzle-orm'
import { pickLatestMetadataRowPerProperty } from '@seedprotocol/sdk'
import { debounce, startCase } from 'lodash-es'
import { useQuery, useQueryClient } from '@tanstack/react-query'

const logger = debug('seedSdk:react:property')
const propertiesLogger = debug('seedSdk:react:itemProperties')


type UseItemPropertyReturn = {
  property: IItemProperty | undefined
  isLoading: boolean
  error: Error | null
}

/** Query key for one item property: `useItemProperty`'s query. */
export const getItemPropertyQueryKey = (
  seedLocalId: string | undefined,
  seedUid: string | undefined,
  propertyName: string,
) => ['seed', 'itemProperty', seedLocalId ?? null, seedUid ?? null, propertyName] as const

/**
 * Hook to get a specific ItemProperty instance
 * Can be called in multiple ways:
 * 1. With seedLocalId/seedUid and propertyName: useItemProperty({ seedLocalId, propertyName }) or useItemProperty({ seedUid, propertyName })
 * 2. With itemId and propertyName: useItemProperty(itemId, propertyName) or useItemProperty({ itemId, propertyName })
 *
 * A property already in the instance cache and ready (`ItemProperty.peekReady`) comes back on the
 * first render with `isLoading: false`. Changing the lookup never returns the previous property.
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
  const queryClient = useSeedQueryClient()
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
    if ((resolvedSeedLocalId || resolvedSeedUid) && propertyName) {
      return {
        type: 'identifiers' as const,
        seedLocalId: resolvedSeedLocalId || undefined,
        seedUid: resolvedSeedUid || undefined,
        propertyName,
        // An itemId may be a seedLocalId or a seedUid: tried as the local id first
        itemId: itemId !== undefined && itemId !== '' ? itemId : undefined,
      }
    }
    return null
  }, [itemId, propertyName, seedLocalId, seedUid])

  const queryKey = useMemo(
    () => getItemPropertyQueryKey(lookupMode?.seedLocalId, lookupMode?.seedUid, lookupMode?.propertyName ?? ''),
    [lookupMode],
  )

  const query = useQuery(
    {
      queryKey,
      queryFn: async (): Promise<IItemProperty | null> => {
        if (!lookupMode) return null
        // A ready cached property is what find() would return. No hold here: the hook holds the
        // property it shows while mounted (useHeldItemProperties).
        const found =
          ItemProperty.peekReady(lookupMode) ??
          (await ItemProperty.find({
            propertyName: lookupMode.propertyName,
            seedLocalId: lookupMode.seedLocalId,
            seedUid: lookupMode.seedUid,
            hold: false,
          }))
        // itemId may be a seedUid (an item synced from EAS): it was only ever looked up as a local id
        const foundByUid =
          !found && lookupMode.itemId
            ? await ItemProperty.find({ propertyName: lookupMode.propertyName, seedUid: lookupMode.itemId, hold: false })
            : undefined
        const result = found ?? foundByUid
        if (!result) {
          logger(
            `[useItemProperty] no property found for Item.${lookupMode.seedLocalId || lookupMode.seedUid}.${lookupMode.propertyName}`,
          )
        }
        return (result as IItemProperty | undefined) ?? null
      },
      // The ItemProperty instance cache is the cache; see useItem.
      initialData: () =>
        (lookupMode ? ItemProperty.peekReady(lookupMode) : undefined) as IItemProperty | undefined,
      staleTime: 0,
      gcTime: 0,
      // An ItemProperty is a live actor-backed object, not data to compare field by field.
      structuralSharing: false,
      // find() throws when the property fails to load or times out; report that, as before.
      retry: false,
      enabled: isClientReady && !!lookupMode,
    },
    queryClient,
  )
  const property = query.data ?? undefined
  useHeldItemProperties(useMemo(() => (property ? [property] : []), [property]))

  // Re-render on the property's own changes (value updates after it loaded).
  useEffect(() => {
    if (!property) return

    const bump = () => setVersion((prev) => prev + 1)
    const initialContext = (property.getService().getSnapshot() as any)?.context
    let lastRenderValue: unknown = initialContext?.renderValue
    let lastPropertyValue: unknown = initialContext?.propertyValue
    let lastConflict: unknown = initialContext?.conflict
    let wasIdle = false
    let lastVersionAt = 0
    let trailing: ReturnType<typeof setTimeout> | undefined
    const THROTTLE_MS = 50
    const subscription: Subscription = property.getService().subscribe((snapshot: any) => {
      const ctx = snapshot?.context ?? {}
      // A value change re-renders at once: a controlled input bound to property.value that
      // skipped a render was reset to the old value, and the next keystroke built on it.
      // So does a conflict arriving or clearing (sync, another tab), which comes on an idle snapshot.
      if (
        !Object.is(ctx.renderValue, lastRenderValue) ||
        !Object.is(ctx.propertyValue, lastPropertyValue) ||
        !Object.is(ctx.conflict ?? null, lastConflict ?? null)
      ) {
        lastRenderValue = ctx.renderValue
        lastPropertyValue = ctx.propertyValue
        lastConflict = ctx.conflict
        wasIdle = snapshot.value === 'idle' && ctx._status === 'ready'
        lastVersionAt = Date.now()
        clearTimeout(trailing)
        trailing = undefined
        bump()
        return
      }
      // Loaded and idle (not hydrating again)
      const isIdle = snapshot.value === 'idle' && ctx._status === 'ready'
      if (isIdle) {
        // Idle snapshots repeat often; re-render only on arriving there.
        if (!wasIdle) {
          wasIdle = true
          clearTimeout(trailing)
          trailing = undefined
          bump()
        }
        return
      }
      wasIdle = false
      // Other fields (saving flags, errors) change on many snapshots in a row: throttle those, with a
      // trailing render so the last one is never dropped.
      const now = Date.now()
      if (now - lastVersionAt >= THROTTLE_MS) {
        lastVersionAt = now
        bump()
      } else if (!trailing) {
        trailing = setTimeout(() => {
          trailing = undefined
          lastVersionAt = Date.now()
          bump()
        }, THROTTLE_MS - (now - lastVersionAt))
      }
    })

    return () => {
      clearTimeout(trailing)
      subscription.unsubscribe()
    }
  }, [property])

  return {
    property,
    isLoading: !!lookupMode && query.isPending,
    error: query.error as Error | null,
  }
}

type UseDebouncedItemPropertyParams =
  | { seedLocalId?: string; seedUid?: string; propertyName: string }
  | { itemId: string; propertyName: string }

type UseDebouncedItemPropertyReturn = {
  property: IItemProperty | undefined
  setValue: (value: string) => void
  /** Save a pending edit now instead of after the debounce delay (e.g. before navigating). */
  flush: () => void
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
      return { itemId, propertyName }
    }
    return { seedLocalId, seedUid, propertyName }
  }, [itemId, seedLocalId, seedUid, propertyName])

  const { property, isLoading, error: queryError } = useItemProperty(normalizedParams)
  const latestValueRef = useRef<string>('')
  const saveError = usePropertySaveError(property)

  const debouncedPersist = useMemo(
    () =>
      debounce((prop: IItemProperty) => {
        // setValue appends the op (looking up a missing propertyRecordSchema first). A refused or
        // failed write shows the stored value again; a value that breaks a rule stays with its errors.
        prop.setValue(latestValueRef.current)
      }, debounceMs),
    [debounceMs]
  )

  // Save a pending edit when the component unmounts (or the delay changes); cancelling here lost
  // the last keystrokes typed within the debounce window.
  useEffect(() => {
    return () => debouncedPersist.flush()
  }, [debouncedPersist])

  const flush = useCallback(() => debouncedPersist.flush(), [debouncedPersist])

  const setValue = useCallback(
    (value: string) => {
      if (!property) return
      latestValueRef.current = value
      property.showValue(value)
      debouncedPersist(property)
    },
    [property, debouncedPersist]
  )

  return {
    property,
    setValue,
    flush,
    isLoading,
    error: queryError ?? saveError,
  }
}

/**
 * The property's last save failure: `_saveError` (an OwnershipError for an item you don't own,
 * say), or an ItemPropertySaveValidationError when the value broke a rule. Cleared by the next save.
 */
function usePropertySaveError(property: IItemProperty | undefined): Error | null {
  const [error, setError] = useState<Error | null>(null)
  useEffect(() => {
    if (!property) {
      setError(null)
      return
    }
    const read = (ctx: any): Error | null => {
      if (ctx?._saveError) return ctx._saveError as Error
      const validationErrors = ctx?._saveValidationErrors
      if (validationErrors?.length) {
        return new ItemPropertySaveValidationError(
          `Invalid value for property ${ctx.propertyName}: ${validationErrors.map((e: { message: string }) => e.message).join('; ')}`,
          validationErrors,
        )
      }
      return null
    }
    let lastSource: unknown
    const update = (ctx: any) => {
      // Compare the context fields, not the built error, so an unchanged failure keeps its identity.
      const source = ctx?._saveError || (ctx?._saveValidationErrors?.length ? ctx._saveValidationErrors : null)
      if (source === lastSource) return
      lastSource = source
      setError(read(ctx))
    }
    update((property.getService().getSnapshot() as any)?.context)
    const subscription: Subscription = property.getService().subscribe((snapshot: any) => update(snapshot?.context))
    return () => subscription.unsubscribe()
  }, [property])
  return error
}

type UseItemPropertiesReturn = {
  properties: IItemProperty[]
  isLoading: boolean
  error: Error | null
}

/**
 * Holds each property while the component shows it, so an item unloading elsewhere doesn't stop
 * it. The release is deferred a tick: a StrictMode remount or a refetch returning the same
 * instances takes its new hold before the old one is dropped, so the count never touches 0.
 */
function useHeldItemProperties(properties: readonly IItemProperty[]): void {
  useEffect(() => {
    const held = properties.filter((p) => ItemProperty.retain(p))
    return () => {
      setTimeout(() => {
        for (const p of held) p.unload()
      }, 0)
    }
  }, [properties])
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
    { waitForReady: true, hold: false },
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
  // The seed records which model it belongs to (model names are only unique per schema)
  const seedRecords = await db
    .select({ type: seeds.type, modelFileId: seeds.modelFileId })
    .from(seeds)
    .where(seedUid ? eq(seeds.uid, seedUid) : eq(seeds.localId, seedLocalId!))
    .limit(1)
  const modelFileId: string | undefined = seedRecords[0]?.modelFileId ?? undefined
  if (!modelName && seedRecords.length > 0 && seedRecords[0].type) {
    modelName = startCase(seedRecords[0].type)
  }

  const modelProperties: string[] = []
  if (modelName) {
    try {
      const { Model } = await import('@seedprotocol/sdk')
      const model = await Model.resolveAsync(modelName, { modelFileId })
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
          { waitForReady: false, hold: false },
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
            { waitForReady: false, hold: false },
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
 * Re-reads the item's metadata rows when the SDK's change feed reports a write to them, and
 * updates the returned ItemProperty instances when they change.
 *
 * The list has one entry per model property, including ones the item has no value for yet
 * (their `value` is null), plus a read-only `createdAt` entry built from the item's creation
 * time. Filter on `propertyName` or `value` if you only want stored values.
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
    // The instances are held only while a hook shows them: a list kept after unmount could hold
    // stopped ones.
    gcTime: 0,
    // A refetch after another tab's save returns the same instances with new values; structural
    // sharing would keep the old array, and the hook wouldn't re-render.
    structuralSharing: false,
  })
  useHeldItemProperties(properties)

  // Query metadata table directly and filter for latest records in JavaScript
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
            localId: metadata.localId,
            revokedAt: metadata.revokedAt,
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
                localId: metadata.localId,
                revokedAt: metadata.revokedAt,
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
  
  // Re-read when the change feed reports a write to this item's metadata rows (ADR 0020): a page
  // mounting this hook per row no longer re-runs every mount's query on every metadata write.
  const propertiesWatch = useMemo<ChangeWatch | null>(() => {
    if (seedUid) return { seedUid, tables: ['metadata'] }
    if (seedLocalId) return { seedLocalId, tables: ['metadata'] }
    return null
  }, [seedLocalId, seedUid])
  const rawPropertiesTableData = useEntityRowsState<{
    propertyName: string | null
    propertyValue: string | null
    seedLocalId: string | null
    seedUid: string | null
    modelType: string | null
    schemaUid: string | null
    createdAt: number | null
    attestationCreatedAt: number | null
    localId: string | null
    revokedAt: number | null
  }>(propertiesWatch, propertiesQuery).data
  
  // Filter for latest records (one per propertyName) in JavaScript
  const propertiesTableData = useMemo(() => {
    if (!rawPropertiesTableData || rawPropertiesTableData.length === 0) {
      return []
    }

    // One record per propertyName, in the SDK's reader order (live before revoked, then newest)
    return pickLatestMetadataRowPerProperty(rawPropertiesTableData)
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

    // No hold: the hook can't release one. The property unloads after the grace period unless a
    // hook showing it (useItemProperty) or the caller holds it.
    const instance = ItemProperty.create(props, { waitForReady: false, hold: false })
    if (!instance) {
      setError(new Error('Failed to create item property'))
      setIsLoading(false)
      return undefined
    }

    const subscription = instance.getService().subscribe(() => {
      if (instance.status === 'error') {
        setError(new Error('Failed to create item property'))
        setIsLoading(false)
      }
      if (instance.status === 'ready') {
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
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  // Loading state is tracked here: the item property's service doesn't record destroy progress, and
  // destroy() stops the service, often within a few microtasks.
  const destroy = useCallback(async (itemProperty: IItemProperty) => {
    if (!itemProperty) return
    setError(null)
    setIsLoading(true)
    try {
      await itemProperty.destroy()
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)))
      throw err
    } finally {
      setIsLoading(false)
    }
  }, [])

  const resetError = useCallback(() => setError(null), [])

  return {
    destroy,
    isLoading,
    error,
    resetError,
  }
}
