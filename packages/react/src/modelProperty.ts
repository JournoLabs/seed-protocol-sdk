import { useModel } from "./model"
import { useCallback, useEffect, useRef, useState, useMemo } from "react"
import { flushSync } from "react-dom"
import { debounce } from "lodash-es"
import { getPropertySchema, ModelProperty } from '@seedprotocol/sdk'
import { useIsClientReady } from "./client"
import { Subscription } from "xstate"
import { useLiveQuery } from "./liveQuery"
import { BaseDb, ClientNotInitializedError } from '@seedprotocol/sdk'
import { properties as propertiesTable, schemas as schemasTable } from '@seedprotocol/sdk'
import { eq, or } from "drizzle-orm"
import { Model } from '@seedprotocol/sdk'
import { useQuery } from "@tanstack/react-query"
import { useSeedQueryClient } from "./queryClient"
import { useCreateState } from "./useCreateState"
import { useHeldEntities } from "./useHeldEntities"

const NO_PROPERTIES: ModelProperty[] = []
/** ModelProperty.retain, stable for useHeldEntities. */
const retainProperty = (property: ModelProperty) => ModelProperty.retain(property)

type UseModelPropertiesResult = {
  modelProperties: ModelProperty[]
  isLoading: boolean
  error: Error | null
}

/**
 * Hook to get all ModelProperty instances for a specific model
 * Can be called in two ways:
 * 1. With schemaId and modelName: useModelProperties(schemaId, modelName)
 * 2. With modelId: useModelProperties(modelId)
 * 
 * Uses useLiveQuery to watch for changes in the properties table and automatically
 * updates the returned ModelProperty instances when changes occur.
 * 
 * @param schemaIdOrModelId - The schema ID (schema file ID) OR the model ID (modelFileId)
 * @param modelName - The name of the model to get properties from (required if first param is schemaId)
 * @returns Object with modelProperties array, isLoading, and error
 */
/**
 * The stored schema a schemaId names, by schema name or schema file id; undefined when none does.
 * A "name-version" id isn't cut down to a name: `blog-2` resolving to `blog` added properties to
 * the wrong schema when `blog-2` was a typo or not stored yet. Throws `ClientNotInitializedError`
 * while the database isn't open, which would otherwise read as a schema id no schema has.
 */
async function resolveSchemaName(schemaId: string): Promise<string | undefined> {
  const db = BaseDb.getAppDb()
  if (!db) throw new ClientNotInitializedError()
  const rows = await db
    .select({ name: schemasTable.name })
    .from(schemasTable)
    .where(or(eq(schemasTable.name, schemaId), eq(schemasTable.schemaFileId, schemaId)))
    .limit(1)
  return rows[0]?.name ?? undefined
}

export const useModelProperties = (
  schemaIdOrModelId: string | null | undefined,
  modelName?: string | null | undefined
): UseModelPropertiesResult => {
  // Use useModel to handle both lookup patterns (by ID or by schemaId + modelName)
  const { model } = useModel(schemaIdOrModelId, modelName)
  
  const isClientReady = useIsClientReady()
  const queryClient = useSeedQueryClient()

  // The model's database id. It can arrive after the model is first seen (the row is written later),
  // so follow the model's snapshot: memoizing it once left the properties live query unbuilt.
  const dbModelId = useModelDbId(model)

  const modelId = model?.id
  const modelPropertiesQueryKey = useMemo(
    () => ['seed', 'modelProperties', modelId ?? ''] as const,
    [modelId],
  )

  const {
    data: modelProperties = NO_PROPERTIES,
    isLoading,
    error: queryError,
  } = useQuery({
    queryKey: modelPropertiesQueryKey,
    queryFn: () => ModelProperty.all(modelId!, { waitForReady: true }),
    enabled: isClientReady && !!modelId,
  }, queryClient)

  // One hold per mounted hook on each property it lists. A property that can't be held, or stops
  // while listed (destroyed, evicted), is listed again.
  const refetch = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: modelPropertiesQueryKey })
  }, [queryClient, modelPropertiesQueryKey])
  useHeldEntities(modelProperties, retainProperty, refetch)

  const db = isClientReady ? BaseDb.getAppDb() : null
  const propertiesQuery = useMemo(() => {
    if (!db || !dbModelId) return null
    return db
      .select({
        id: propertiesTable.id,
        name: propertiesTable.name,
        dataType: propertiesTable.dataType,
        schemaFileId: propertiesTable.schemaFileId,
      })
      .from(propertiesTable)
      .where(eq(propertiesTable.modelId, dbModelId))
  }, [db, isClientReady, dbModelId])
  const propertiesTableData = useLiveQuery<{ id: number; name: string; dataType: string; schemaFileId: string | null }>(propertiesQuery)

  const modelPropertiesRef = useRef<ModelProperty[]>([])
  modelPropertiesRef.current = modelProperties

  // Fallback: when we have modelId but query returned [] (e.g. properties not in DB yet or
  // propertiesTableData is undefined because model._dbId isn't set yet), schedule refetches
  // so we pick up properties after they're written.
  useEffect(() => {
    if (!modelId || modelProperties.length > 0 || !queryClient || !modelPropertiesQueryKey) return
    const delays = [400, 1200, 2500]
    const timers = delays.map((ms) =>
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: modelPropertiesQueryKey })
      }, ms)
    )
    return () => timers.forEach((t) => clearTimeout(t))
  }, [modelId, modelProperties.length, queryClient, modelPropertiesQueryKey])

  useEffect(() => {
    if (!isClientReady || !model?.id || !propertiesTableData || !modelPropertiesQueryKey) return

    const currentPropertiesSet = new Set<string>()
    for (const prop of modelPropertiesRef.current) {
      const context = (prop as any)._getSnapshotContext()
      const propertyFileId = context?.id
      if (propertyFileId) currentPropertiesSet.add(propertyFileId)
      else if (prop.name) currentPropertiesSet.add(prop.name)
    }

    const tableDataPropertiesSet = new Set<string>()
    for (const dbProperty of propertiesTableData) {
      if (dbProperty.schemaFileId) tableDataPropertiesSet.add(dbProperty.schemaFileId)
      else if (dbProperty.name) tableDataPropertiesSet.add(dbProperty.name)
    }

    const setsAreEqual =
      currentPropertiesSet.size === tableDataPropertiesSet.size &&
      (currentPropertiesSet.size === 0 ||
        [...currentPropertiesSet].every((id) => tableDataPropertiesSet.has(id)))

    // Invalidate when cached list is out of sync with the table: either we have stale cached data
    // (currentPropertiesSet.size > 0) or the table has new rows we don't have yet (tableDataPropertiesSet.size > 0).
    // The latter handles the case where the initial query returned [] before properties were written.
    const shouldInvalidate =
      !setsAreEqual && (currentPropertiesSet.size > 0 || tableDataPropertiesSet.size > 0)

    if (shouldInvalidate) {
      queryClient.invalidateQueries({ queryKey: modelPropertiesQueryKey })
    }
  }, [isClientReady, propertiesTableData, model?.id, queryClient, modelPropertiesQueryKey])

  // When we have cached modelProperties, do not report isLoading: true even if the query
  // is refetching (e.g. after useModels refetch causes modelId to change briefly). UX expects
  // isLoading false once we have shown data.
  const effectiveIsLoading = isLoading && modelProperties.length === 0

  return {
    modelProperties,
    isLoading: effectiveIsLoading,
    error: queryError as Error | null,
  }
}

const LOOKUP_RETRY_DELAYS_MS = [400, 1200, 2500]

const readModelDbId = (model: Model | undefined | null): number | undefined => {
  if (!model) return undefined
  try {
    return (model as any)._getSnapshotContext()._dbId as number | undefined
  } catch {
    return undefined
  }
}

/** The model's `_dbId`, updated when the model's actor sets it. */
const useModelDbId = (model: Model | undefined | null): number | undefined => {
  const [dbModelId, setDbModelId] = useState(() => readModelDbId(model))
  useEffect(() => {
    setDbModelId(readModelDbId(model))
    if (!model) return
    const subscription = model.getService().subscribe(() => setDbModelId(readModelDbId(model)))
    return () => subscription.unsubscribe()
  }, [model])
  return dbModelId
}

/**
 * Helper function to get property schema by modelFileId and propertyName
 */
const getPropertySchemaByModelFileId = async (
  modelFileId: string,
  propertyName: string
): Promise<ReturnType<typeof getPropertySchema>> => {
  // Get model by modelFileId
  const model = await Model.createById(modelFileId)
  if (!model) {
    return undefined
  }

  // Get modelName from model
  const modelName = model.modelName ?? (model as any).name
  if (!modelName) {
    return undefined
  }

  // Use existing getPropertySchema function, pinned to this model (names are only unique per schema)
  return getPropertySchema(modelName, propertyName, { modelFileId, schemaName: model.schemaName })
}

/**
 * Hook to get a specific ModelProperty instance
 * Can be called in three ways:
 * 1. With propertyFileId: useModelProperty(propertyFileId)
 * 2. With modelFileId and propertyName: useModelProperty(modelFileId, propertyName)
 * 3. With schemaId, modelName, and propertyName: useModelProperty(schemaId, modelName, propertyName)
 * 
 * @overload
 * @param propertyFileId - The property file ID (schemaFileId)
 * @returns Object with modelProperty, isLoading, and error
 * 
 * @overload
 * @param modelFileId - The model file ID (modelFileId)
 * @param propertyName - The name of the property
 * @returns Object with modelProperty, isLoading, and error
 * 
 * @overload
 * @param schemaId - The schema ID (schema file ID)
 * @param modelName - The name of the model
 * @param propertyName - The name of the property
 * @returns Object with modelProperty, isLoading, and error
 */
export function useModelProperty(propertyFileId: string | null | undefined): {
  modelProperty: ModelProperty | undefined
  isLoading: boolean
  error: Error | null
}
export function useModelProperty(
  modelFileId: string | null | undefined,
  propertyName: string | null | undefined
): {
  modelProperty: ModelProperty | undefined
  isLoading: boolean
  error: Error | null
}
export function useModelProperty(
  schemaId: string | null | undefined,
  modelName: string | null | undefined,
  propertyName: string | null | undefined
): {
  modelProperty: ModelProperty | undefined
  isLoading: boolean
  error: Error | null
}
export function useModelProperty(...args: Array<string | null | undefined>) {
  const [arg1, arg2, arg3] = args
  // The lookup form follows the number of arguments, so a null or undefined argument (not ready
  // yet) waits instead of switching to a shorter form: (schemaId, null, null) used to look the
  // schema id up as a property file id.
  const argCount = Math.min(args.length, 3)

  // Determine initial loading state - start loading if we have valid parameters
  const initialLoadingState = useMemo(() => {
    if (argCount === 3) return !!(arg1 && arg2 && arg3)
    if (argCount === 2) return !!(arg1 && arg2)
    return !!arg1
  }, [argCount, arg1, arg2, arg3])

  const [modelProperty, setModelProperty] = useState<ModelProperty | undefined>(undefined)
  const [isLoading, setIsLoading] = useState(initialLoadingState)
  const [error, setError] = useState<Error | null>(null)
  const subscriptionRef = useRef<Subscription | undefined>(undefined)

  const isClientReady = useIsClientReady()

  // Determine which lookup mode we're in based on arguments
  const lookupMode = useMemo(() => {
    if (argCount === 3) {
      return { type: 'schemaId' as const, schemaId: arg1, modelName: arg2, propertyName: arg3 }
    }
    if (argCount === 2) {
      return { type: 'modelFileId' as const, modelFileId: arg1, propertyName: arg2 }
    }
    return { type: 'propertyFileId' as const, propertyFileId: arg1 }
  }, [argCount, arg1, arg2, arg3])

  // Determine if we should be loading based on parameters
  const shouldLoad = useMemo(() => {
    if (!isClientReady) return false
    if (lookupMode.type === 'propertyFileId') {
      return !!lookupMode.propertyFileId
    } else if (lookupMode.type === 'modelFileId') {
      return !!(lookupMode.modelFileId && lookupMode.propertyName)
    } else {
      return !!(lookupMode.schemaId && lookupMode.modelName && lookupMode.propertyName)
    }
  }, [isClientReady, lookupMode])

  /** `quiet`: a background retry; leaves isLoading alone. */
  const updateModelProperty = useCallback(async ({ quiet = false }: { quiet?: boolean } = {}) => {
    if (!isClientReady) {
      setModelProperty(undefined)
      setIsLoading(false)
      setError(null)
      return
    }

    let propertyData: Awaited<ReturnType<typeof getPropertySchema>> | undefined
    let resolvedModelName: string | undefined

    try {
      if (!quiet) {
        setIsLoading(true)
        setError(null)
      }

      if (lookupMode.type === 'propertyFileId') {
        if (!lookupMode.propertyFileId) {
          setModelProperty(undefined)
          setIsLoading(false)
          setError(null)
          return
        }

        // Use ModelProperty.createById for propertyFileId lookup
        const foundProperty = await ModelProperty.createById(lookupMode.propertyFileId)
        if (foundProperty) {
          setModelProperty(foundProperty)
          setIsLoading(false)
          setError(null)
        } else {
          setModelProperty(undefined)
          setIsLoading(false)
          setError(null)
        }
        return
      } else if (lookupMode.type === 'modelFileId') {
        if (!lookupMode.modelFileId || !lookupMode.propertyName) {
          setModelProperty(undefined)
          setIsLoading(false)
          setError(null)
          return
        }

        // Get property schema by modelFileId and propertyName
        // This function already gets the model and resolves modelName
        propertyData = await getPropertySchemaByModelFileId(lookupMode.modelFileId, lookupMode.propertyName)
        
        // Get modelName from model (needed for ModelProperty.create)
        const model = await Model.createById(lookupMode.modelFileId)
        resolvedModelName = model?.modelName ?? (model as any)?.name
      } else {
        // lookupMode.type === 'schemaId'
        if (!lookupMode.schemaId || !lookupMode.modelName || !lookupMode.propertyName) {
          setModelProperty(undefined)
          setIsLoading(false)
          setError(null)
          return
        }

        // Use existing getPropertySchema for schemaId + modelName + propertyName
        // schemaId may be a schema file id or a schema name; scope the lookup to that schema
        const schemaName = await resolveSchemaName(lookupMode.schemaId)
        propertyData = schemaName
          ? await getPropertySchema(lookupMode.modelName, lookupMode.propertyName, { schemaName })
          : undefined
        resolvedModelName = lookupMode.modelName
      }

      if (propertyData && resolvedModelName) {
        // No hold: the hook holds what it shows (below), once per mount
        const createdProperty = ModelProperty.create(
          { ...propertyData, modelName: resolvedModelName },
          { waitForReady: false }
        )
        const resolvedProperty = createdProperty instanceof Promise ? await createdProperty : createdProperty
        flushSync(() => {
          setModelProperty(resolvedProperty)
          setIsLoading(false)
          setError(null)
        })
      } else {
        setModelProperty(undefined)
        setIsLoading(false)
        setError(null)
      }
    } catch (error) {
      console.error('[useModelProperty] Error updating model property:', error)
      setModelProperty(undefined)
      setIsLoading(false)
      setError(error as Error)
    }
  }, [isClientReady, lookupMode.type, lookupMode.propertyFileId, lookupMode.modelFileId, lookupMode.propertyName, lookupMode.schemaId, lookupMode.modelName])

  // Fetch/refetch when lookup parameters change or client becomes ready
  useEffect(() => {
    if (!shouldLoad) {
      setModelProperty(undefined)
      setIsLoading(false)
      setError(null)
      return
    }
    updateModelProperty()
  }, [shouldLoad, updateModelProperty])

  // One hold per mounted hook on the property it shows; one that stops while shown is looked up again
  const lookUpAgain = useCallback(() => void updateModelProperty({ quiet: true }), [updateModelProperty])
  useHeldEntities(useMemo(() => (modelProperty ? [modelProperty] : NO_PROPERTIES), [modelProperty]), retainProperty, lookUpAgain)

  // A schemaId/modelFileId lookup reads the model's properties, which can still be loading (or the
  // property not yet written) when the hook mounts. Nothing would ask again, so retry a few times
  // while it finds nothing, as useModelProperties does (skipped while a lookup is running, and once
  // one found the property or failed).
  const skipLookupRetryRef = useRef(false)
  skipLookupRetryRef.current = isLoading || !!modelProperty || !!error
  useEffect(() => {
    if (!shouldLoad || lookupMode.type === 'propertyFileId') return
    const timers = LOOKUP_RETRY_DELAYS_MS.map((ms) =>
      setTimeout(() => {
        if (!skipLookupRetryRef.current) updateModelProperty({ quiet: true })
      }, ms),
    )
    return () => timers.forEach((t) => clearTimeout(t))
  }, [shouldLoad, lookupMode.type, updateModelProperty])

  // Subscribe to service changes when modelProperty is available.
  // Skip subscription for schemaId/modelFileId lookups where we created the instance locally—
  // refetching on every snapshot would set loading and can race with the initial render.
  // Debounce to reduce refetch frequency and avoid updateContext/refetch loops.
  const shouldSubscribe = lookupMode.type === 'propertyFileId'
  useEffect(() => {
    if (!modelProperty || !shouldSubscribe) {
      return
    }

    // Clean up previous subscription
    subscriptionRef.current?.unsubscribe()

    const debouncedUpdate = debounce(updateModelProperty, 100)

    // Subscribe to service changes
    const subscription = modelProperty.getService().subscribe(() => {
      debouncedUpdate()
    })

    subscriptionRef.current = subscription

    return () => {
      debouncedUpdate.cancel()
      subscriptionRef.current?.unsubscribe()
      subscriptionRef.current = undefined
    }
  }, [modelProperty, updateModelProperty, shouldSubscribe])

  return {
    modelProperty,
    isLoading,
    error,
  }
}

export type UseCreateModelPropertyOptions = {
  name: string
  dataType: string
  [key: string]: any
}

export type UseCreateModelPropertyReturn = {
  create: (
    schemaId: string,
    modelName: string,
    property: UseCreateModelPropertyOptions
  ) => Promise<ModelProperty>
  isLoading: boolean
  error: Error | null
  resetError: () => void
}

/**
 * Hook to create a ModelProperty with loading and error state.
 * create(schemaId, modelName, property) creates a new property on the model. schemaId is a schema
 * name, schema file id or "name-version"; it is resolved to a stored schema name first, so create
 * returns a promise. The property takes no hold: it stays cached until it is destroyed or evicted.
 */
export const useCreateModelProperty = (): UseCreateModelPropertyReturn => {
  const { runAsync, isLoading, error, resetError } = useCreateState(
    'Failed to create model property',
  )

  const create = useCallback(
    (
      schemaId: string,
      modelName: string,
      property: UseCreateModelPropertyOptions
    ): Promise<ModelProperty> =>
      runAsync(async () => {
        if (!modelName || !property.name || !property.dataType) {
          throw new Error('modelName, property name and dataType are required')
        }
        const schemaName = await resolveSchemaName(schemaId)
        if (!schemaName) throw new Error(`No stored schema has the name or schema file id "${schemaId}"`)
        return ModelProperty.create(
          { ...property, modelName } as Parameters<typeof ModelProperty.create>[0],
          { waitForReady: false, schemaName }
        ) as ModelProperty
      }),
    [runAsync]
  )

  return {
    create,
    isLoading,
    error,
    resetError,
  }
}

export type UseDestroyModelPropertyReturn = {
  destroy: (modelProperty: ModelProperty) => Promise<void>
  isLoading: boolean
  error: Error | null
  resetError: () => void
}

export const useDestroyModelProperty = (): UseDestroyModelPropertyReturn => {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  // Loading state is tracked here: the model property's service doesn't record destroy progress, and
  // destroy() stops the service, often within a few microtasks.
  const destroy = useCallback(async (modelProperty: ModelProperty) => {
    if (!modelProperty) return
    setError(null)
    setIsLoading(true)
    try {
      await modelProperty.destroy()
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
