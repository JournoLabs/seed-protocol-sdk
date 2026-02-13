import { useModel } from "./model"
import { useCallback, useEffect, useRef, useState, useMemo } from "react"
import { flushSync } from "react-dom"
import { getPropertySchema } from "@/helpers/property"
import { ModelProperty } from "@/ModelProperty/ModelProperty"
import { useIsClientReady } from "./client"
import { Subscription } from "xstate"
import debug from "debug"
import { useLiveQuery } from "./liveQuery"
import { BaseDb } from "@/db/Db/BaseDb"
import { properties as propertiesTable, models as modelsTable } from "@/seedSchema/ModelSchema"
import { eq } from "drizzle-orm"
import { Model } from "@/Model/Model"
import { useQuery, useQueryClient } from "@tanstack/react-query"

const logger = debug('seedSdk:browser:react:modelProperty')

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
export const useModelProperties = (
  schemaIdOrModelId: string | null | undefined,
  modelName?: string | null | undefined
): UseModelPropertiesResult => {
  // Use useModel to handle both lookup patterns (by ID or by schemaId + modelName)
  const { model } = useModel(schemaIdOrModelId, modelName)
  
  // Determine the modelName for use in getPropertySchema
  const modelNameForProperty = useMemo(() => {
    if (!model) return undefined
    try {
      return model.modelName ?? (model as any).name
    } catch {
      return undefined
    }
  }, [model])
  const isClientReady = useIsClientReady()
  const queryClient = useQueryClient()

  // Get _dbId (database ID) from model context
  const dbModelId = useMemo(() => {
    if (!model) return null
    try {
      const context = (model as any)._getSnapshotContext()
      return context._dbId as number | undefined
    } catch {
      return null
    }
  }, [model])

  const modelId = model?.id
  const modelPropertiesQueryKey = useMemo(
    () => ['seed', 'modelProperties', modelId ?? ''] as const,
    [modelId],
  )

  const {
    data: modelProperties = [],
    isLoading,
    error: queryError,
  } = useQuery({
    queryKey: modelPropertiesQueryKey,
    queryFn: () => ModelProperty.all(modelId!, { waitForReady: true }),
    enabled: isClientReady && !!modelId,
  })

  // #region agent log
  useEffect(() => {
    fetch('http://127.0.0.1:7242/ingest/0978b378-ebae-46bf-8fd3-134ef2e16cdd',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'modelProperty.ts:useModelProperties',message:'useModelProperties state',data:{modelId,isLoading,propsLen:modelProperties?.length,hasData:!!modelProperties?.length},timestamp:Date.now(),hypothesisId:'A'})}).catch(()=>{})
  }, [modelId, isLoading, modelProperties?.length])
  // #endregion

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
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/0978b378-ebae-46bf-8fd3-134ef2e16cdd',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'modelProperty.ts:invalidate',message:'useLiveQuery invalidation triggered',data:{modelId:model?.id,currentSize:modelPropertiesRef.current.length,tableSize:propertiesTableData?.length},timestamp:Date.now(),hypothesisId:'A'})}).catch(()=>{})
      // #endregion
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

  // Use existing getPropertySchema function
  return getPropertySchema(modelName, propertyName)
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
export function useModelProperty(propertyFileId: string): {
  modelProperty: ModelProperty | undefined
  isLoading: boolean
  error: Error | null
}
export function useModelProperty(
  modelFileId: string,
  propertyName: string
): {
  modelProperty: ModelProperty | undefined
  isLoading: boolean
  error: Error | null
}
export function useModelProperty(
  schemaId: string,
  modelName: string,
  propertyName: string
): {
  modelProperty: ModelProperty | undefined
  isLoading: boolean
  error: Error | null
}
export function useModelProperty(
  arg1: string | null | undefined,
  arg2?: string | null | undefined,
  arg3?: string | null | undefined
) {
  // Determine initial loading state - start loading if we have valid parameters
  const initialLoadingState = useMemo(() => {
    if (arg3 !== undefined && arg3 !== null) {
      // Three arguments: schemaId, modelName, propertyName
      return !!(arg1 && arg2 && arg3)
    } else if (arg2 !== undefined && arg2 !== null) {
      // Two arguments: modelFileId, propertyName
      return !!(arg1 && arg2)
    } else {
      // One argument: propertyFileId
      return !!arg1
    }
  }, [arg1, arg2, arg3])

  const [modelProperty, setModelProperty] = useState<ModelProperty | undefined>(undefined)
  const [isLoading, setIsLoading] = useState(initialLoadingState)
  const [error, setError] = useState<Error | null>(null)
  const subscriptionRef = useRef<Subscription | undefined>(undefined)

  const isClientReady = useIsClientReady()

  // Determine which lookup mode we're in based on arguments
  const lookupMode = useMemo(() => {
    if (arg3 !== undefined && arg3 !== null) {
      // Three arguments: schemaId, modelName, propertyName
      return { type: 'schemaId' as const, schemaId: arg1, modelName: arg2, propertyName: arg3 }
    } else if (arg2 !== undefined && arg2 !== null) {
      // Two arguments: modelFileId, propertyName
      return { type: 'modelFileId' as const, modelFileId: arg1, propertyName: arg2 }
    } else {
      // One argument: propertyFileId
      return { type: 'propertyFileId' as const, propertyFileId: arg1 }
    }
  }, [arg1, arg2, arg3])

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

  const updateModelProperty = useCallback(async () => {
    if (!isClientReady) {
      setModelProperty(undefined)
      setIsLoading(false)
      setError(null)
      return
    }

    let propertyData: Awaited<ReturnType<typeof getPropertySchema>> | undefined
    let resolvedModelName: string | undefined

    try {
      setIsLoading(true)
      setError(null)

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
        propertyData = await getPropertySchema(lookupMode.modelName, lookupMode.propertyName)
        resolvedModelName = lookupMode.modelName
      }

      if (propertyData && resolvedModelName) {
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

  // Subscribe to service changes when modelProperty is available.
  // Skip subscription for schemaId/modelFileId lookups where we created the instance locally—
  // refetching on every snapshot would set loading and can race with the initial render.
  const shouldSubscribe = lookupMode.type === 'propertyFileId'
  useEffect(() => {
    if (!modelProperty || !shouldSubscribe) {
      return
    }

    // Clean up previous subscription
    subscriptionRef.current?.unsubscribe()

    // Subscribe to service changes
    const subscription = modelProperty.getService().subscribe((snapshot) => {
      updateModelProperty()
    })
    
    subscriptionRef.current = subscription

    return () => {
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
  ) => ModelProperty
  isLoading: boolean
  error: Error | null
  resetError: () => void
}

/**
 * Hook to create a ModelProperty with loading and error state.
 * create(schemaId, modelName, property) creates a new property on the model.
 */
export const useCreateModelProperty = (): UseCreateModelPropertyReturn => {
  const subscriptionRef = useRef<Subscription | undefined>(undefined)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const resetError = useCallback(() => setError(null), [])

  const create = useCallback(
    (
      _schemaId: string,
      modelName: string,
      property: UseCreateModelPropertyOptions
    ): ModelProperty => {
      setError(null)
      setIsLoading(true)
      subscriptionRef.current?.unsubscribe()
      subscriptionRef.current = undefined

      if (!modelName || !property.name || !property.dataType) {
        const err = new Error('modelName, property name and dataType are required')
        setError(err)
        setIsLoading(false)
        throw err
      }

      const created = ModelProperty.create(
        { ...property, modelName } as Parameters<typeof ModelProperty.create>[0],
        { waitForReady: false }
      ) as ModelProperty
      const subscription = created.getService().subscribe((snapshot) => {
        if ((snapshot as { value?: string }).value === 'error') {
          const err = (snapshot.context as any)._loadingError?.error ?? new Error('Failed to create model property')
          setError(err instanceof Error ? err : new Error(String(err)))
          setIsLoading(false)
        }
        if (snapshot.value === 'idle') {
          setError(null)
          setIsLoading(false)
        }
      })
      subscriptionRef.current = subscription
      return created
    },
    []
  )

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

export type UseDestroyModelPropertyReturn = {
  destroy: (modelProperty: ModelProperty) => Promise<void>
  isLoading: boolean
  error: Error | null
  resetError: () => void
}

export const useDestroyModelProperty = (): UseDestroyModelPropertyReturn => {
  const [currentInstance, setCurrentInstance] = useState<ModelProperty | null>(null)
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
      const snap = service.getSnapshot()
      const ctx = snap.context as { _destroyInProgress?: boolean; _destroyError?: { message: string } | null }
      setDestroyState({
        isLoading: !!ctx._destroyInProgress,
        error: ctx._destroyError ? new Error(ctx._destroyError.message) : null,
      })
    }
    update()
    const sub = service.subscribe(update)
    return () => sub.unsubscribe()
  }, [currentInstance])

  const destroy = useCallback(async (modelProperty: ModelProperty) => {
    if (!modelProperty) return
    setCurrentInstance(modelProperty)
    await modelProperty.destroy()
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