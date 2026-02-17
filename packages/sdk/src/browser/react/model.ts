import { useMemo, useState, useEffect, useCallback, useRef } from 'react'
import { Model } from '@/Model/Model'
import { useIsClientReady } from './client'
import { useLiveQuery } from './liveQuery'
import { BaseDb } from '@/db/Db/BaseDb'
import { models as modelsTable } from '@/seedSchema/ModelSchema'
import { modelSchemas } from '@/seedSchema/ModelSchemaSchema'
import { schemas as schemasTable } from '@/seedSchema/SchemaSchema'
import { eq, or } from 'drizzle-orm'
import { Subscription } from 'xstate'
import { useQuery, useQueryClient } from '@tanstack/react-query'

type UseModelsResult = {
  models: Model[]
  isLoading: boolean
  error: Error | null
}

type UseModelsParams = string | null | undefined

type UseModels = (schemaId: UseModelsParams) => UseModelsResult

/**
 * Hook to get all Model instances for a specific schema
 * Uses useLiveQuery to watch for changes in the models table and automatically
 * updates the returned Model instances when changes occur.
 * @param schemaId - The schema ID (schema file ID) or schema name to get models from
 * @returns Array of Model instances belonging to the schema
 */
const getModelsQueryKey = (schemaId: UseModelsParams) => ['seed', 'models', schemaId] as const

// Last-known-good models per schemaId so we never flash [] after remount or refetch race (survives component unmount).
const lastModelsBySchemaId = new Map<string, Model[]>()

export const useModels: UseModels = (schemaId) => {
  const isClientReady = useIsClientReady()
  const queryClient = useQueryClient()
  const modelsRef = useRef<Model[]>([])

  const queryKey = useMemo(() => getModelsQueryKey(schemaId), [schemaId])

  const {
    data: models = [],
    isLoading,
    error: queryError,
  } = useQuery({
    queryKey,
    queryFn: async () => {
      // Capture previous data before any async work so we don't overwrite good cache with [].
      const prev = queryClient.getQueryData<Model[]>(queryKey)
      // Use waitForReady: false so we return models as soon as they exist; waitForReady: true
      // filters to only idle models and can return [] while a model is in creatingProperties.
      const next = await Model.all(schemaId!, { waitForReady: false })
      // getModelsData can intermittently return [] after returning data; keep prev to avoid overwrite.
      if (Array.isArray(prev) && prev.length > 0 && Array.isArray(next) && next.length === 0) {
        return [...prev]
      }
      // If this refetch returned [], avoid overwriting non-empty cache (e.g. race where another refetch already wrote data).
      if (Array.isArray(next) && next.length === 0) {
        const current = queryClient.getQueryData<Model[]>(queryKey)
        if (Array.isArray(current) && current.length > 0) {
          return [...current]
        }
      }
      return next
    },
    enabled: isClientReady && !!schemaId,
  })
  // Never expose [] when we previously had models (avoids flash from refetch races, remounts, or intermittent getModelsData returning []).
  // When schemaId is null/undefined, always show [] — do not use fallback from a previous schema.
  const schemaIdKey = schemaId && typeof schemaId === 'string' ? schemaId : ''
  if (models.length > 0) {
    lastModelsBySchemaId.set(schemaIdKey, models)
  }
  const fallback = modelsRef.current.length > 0 ? modelsRef.current : lastModelsBySchemaId.get(schemaIdKey)
  const displayModels =
    !schemaId
      ? models
      : models.length > 0
        ? models
        : fallback?.length
          ? fallback
          : models
  modelsRef.current = displayModels

  // When a model is created, writeModelToDb posts to this channel; live query over join often doesn't re-run
  useEffect(() => {
    if (!schemaId || typeof BroadcastChannel === 'undefined') return
    const ch = new BroadcastChannel('seed-models-invalidate')
    const onMessage = (event: MessageEvent<{ schemaName?: string; schemaFileId?: string }>) => {
      const { schemaName, schemaFileId } = event.data || {}
      if (schemaId === schemaName || schemaId === schemaFileId) {
        queryClient.invalidateQueries({ queryKey })
        queryClient.refetchQueries({ queryKey })
      }
    }
    ch.addEventListener('message', onMessage)
    return () => {
      ch.removeEventListener('message', onMessage)
      ch.close()
    }
  }, [schemaId, queryClient, queryKey])

  // Stabilize query reference: only recreate when (schemaId, isClientReady) change, not when db reference changes.
  // This keeps the same liveQuery observable/subscription alive so effects can deliver updates when a new model is added.
  const stableModelsQueryKeyRef = useRef<{ schemaId: string; ready: boolean } | null>(null)
  const stableModelsQueryRef = useRef<ReturnType<typeof buildModelsQuery> | null>(null)
  function buildModelsQuery() {
    const currentDb = BaseDb.getAppDb()
    if (!currentDb || !schemaId) return null
    return currentDb
      .select({
        modelFileId: modelsTable.schemaFileId,
        modelName: modelsTable.name,
      })
      .from(schemasTable)
      .innerJoin(modelSchemas, eq(schemasTable.id, modelSchemas.schemaId))
      .innerJoin(modelsTable, eq(modelSchemas.modelId, modelsTable.id))
      .where(
        or(
          eq(schemasTable.schemaFileId, schemaId),
          eq(schemasTable.name, schemaId)
        )
      )
  }
  const modelsQuery = useMemo(() => {
    if (!schemaId || !isClientReady) return null
    const key = { schemaId, ready: isClientReady }
    const prevKey = stableModelsQueryKeyRef.current
    if (
      prevKey &&
      prevKey.schemaId === key.schemaId &&
      prevKey.ready === key.ready &&
      stableModelsQueryRef.current !== null
    ) {
      return stableModelsQueryRef.current
    }
    const q = buildModelsQuery()
    if (!q) return null
    stableModelsQueryKeyRef.current = key
    stableModelsQueryRef.current = q
    return q
  }, [schemaId, isClientReady])

  const modelsTableData = useLiveQuery<{ modelFileId: string | null; modelName: string }>(modelsQuery)

  useEffect(() => {
    if (!isClientReady || !modelsTableData || !schemaId) return

    const currentModelsSet = new Set<string>()
    for (const model of modelsRef.current) {
      const modelFileId = model.id || (model as any).modelFileId
      if (modelFileId) currentModelsSet.add(modelFileId)
      else if (model.modelName) currentModelsSet.add(model.modelName)
    }

    const tableDataModelsSet = new Set<string>()
    for (const dbModel of modelsTableData) {
      if (dbModel.modelFileId) tableDataModelsSet.add(dbModel.modelFileId)
      else if (dbModel.modelName) tableDataModelsSet.add(dbModel.modelName)
    }

    const setsAreEqual =
      currentModelsSet.size === tableDataModelsSet.size &&
      [...currentModelsSet].every((id) => tableDataModelsSet.has(id))

    // Only invalidate when the table has rows we might be missing (live query saw new data).
    // Do NOT invalidate when we have more than the table: the live query may not have updated
    // yet (e.g. join over model_schemas), and refetching would overwrite cache with [].
    const tableHasNewRows =
      tableDataModelsSet.size > 0 &&
      [...tableDataModelsSet].some((id) => !currentModelsSet.has(id))

    if (!setsAreEqual && tableHasNewRows) {
      queryClient.invalidateQueries({ queryKey })
    }
  }, [isClientReady, modelsTableData, schemaId, queryClient, queryKey])

  return {
    models: displayModels,
    isLoading,
    error: queryError as Error | null,
  }
}

type UseModelResult = {
  model: Model | undefined
  isLoading: boolean
  error: Error | null
}

/**
 * Hook to get a specific Model instance
 * Can be called in two ways:
 * 1. With schemaId and modelName: useModel(schemaId, modelName)
 * 2. With modelId: useModel(modelId)
 * 
 * @param schemaIdOrModelId - The schema ID (schema file ID) OR the model ID (modelFileId)
 * @param modelName - The name of the model to retrieve (required if first param is schemaId)
 * @returns Object with model, isLoading, and error
 */
export const useModel = (
  schemaIdOrModelId: string | null | undefined,
  modelName?: string | null | undefined
): UseModelResult => {
  const isClientReady = useIsClientReady()
  const [model, setModel] = useState<Model | undefined>(undefined)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const subscriptionRef = useRef<Subscription | undefined>(undefined)
  const [, setVersion] = useState(0) // Version counter to force re-renders

  // If modelName is provided, treat first param as schemaId
  // Otherwise, treat first param as modelId
  const isModelIdLookup = modelName === undefined || modelName === null

  // Determine initial loading state
  const shouldLoad = useMemo(() => {
    if (!isClientReady) return false
    if (isModelIdLookup) {
      return !!schemaIdOrModelId
    } else {
      return !!(schemaIdOrModelId && modelName)
    }
  }, [isClientReady, isModelIdLookup, schemaIdOrModelId, modelName])

  // Lookup model by ID if needed
  useEffect(() => {
    if (!isClientReady || !isModelIdLookup || !schemaIdOrModelId) {
      setModel(undefined)
      setIsLoading(false)
      setError(null)
      return
    }

    const lookupModelById = async () => {
      try {
        setIsLoading(true)
        setError(null)
        // Use Model.createById which handles cache + DB lookup
        const foundModel = await Model.createById(schemaIdOrModelId)
        setModel(foundModel || undefined)
        setIsLoading(false)
        setError(null)
      } catch (error) {
        console.error('[useModel] Error looking up model by ID:', error)
        setModel(undefined)
        setIsLoading(false)
        setError(error as Error)
      }
    }

    lookupModelById()
  }, [isClientReady, isModelIdLookup, schemaIdOrModelId])

  // Subscribe to service changes when model is available (for modelId lookup)
  useEffect(() => {
    if (!isModelIdLookup || !model) {
      // Clean up subscription if model is not available
      subscriptionRef.current?.unsubscribe()
      subscriptionRef.current = undefined
      return
    }

    // Clean up previous subscription
    subscriptionRef.current?.unsubscribe()

    // Subscribe to service changes
    const subscription = model.getService().subscribe((snapshot) => {
      // Force re-render by incrementing version counter
      setVersion(prev => prev + 1)
    })
    
    subscriptionRef.current = subscription

    return () => {
      subscriptionRef.current?.unsubscribe()
      subscriptionRef.current = undefined
    }
  }, [isModelIdLookup, model])

  // If doing modelId lookup, return the model directly
  if (isModelIdLookup) {
    return {
      model,
      isLoading,
      error,
    }
  }

  // Otherwise, use schemaId + modelName lookup via useModels
  const { models: modelsList, isLoading: modelsLoading, error: modelsError } = useModels(schemaIdOrModelId)
  const foundModel = useMemo(() => {
    if (!modelName) {
      return undefined
    }
    // Try both modelName property and name getter for compatibility
    return modelsList.find((m: Model) => {
      const mName = m.modelName ?? (m as any).name
      return mName === modelName
    })
  }, [modelsList, modelName])

  // Subscribe to service changes when model is available (for schemaId + modelName lookup)
  useEffect(() => {
    if (isModelIdLookup || !foundModel) {
      // Clean up subscription if model is not available
      subscriptionRef.current?.unsubscribe()
      subscriptionRef.current = undefined
      return
    }

    // Clean up previous subscription
    subscriptionRef.current?.unsubscribe()

    // Subscribe to service changes
    const subscription = foundModel.getService().subscribe((snapshot) => {
      // Force re-render by incrementing version counter
      setVersion(prev => prev + 1)
    })
    
    subscriptionRef.current = subscription

    return () => {
      subscriptionRef.current?.unsubscribe()
      subscriptionRef.current = undefined
    }
  }, [isModelIdLookup, foundModel])

  // #region agent log
  useEffect(() => {
    fetch('http://127.0.0.1:7242/ingest/0978b378-ebae-46bf-8fd3-134ef2e16cdd',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'model.ts:useModel schemaId+modelName',message:'useModel state',data:{hasFoundModel:!!foundModel,modelId:foundModel?.id,modelsLoading},timestamp:Date.now(),hypothesisId:'B'})}).catch(()=>{})
  }, [foundModel, modelsLoading])
  // #endregion

  // For schemaId + modelName lookup, derive loading/error from useModels
  return {
    model: foundModel,
    isLoading: modelsLoading,
    error: modelsError,
  }
}

export type UseCreateModelOptions = {
  modelFileId?: string
  properties?: { [propertyName: string]: any }
  registerWithSchema?: boolean
}

export type UseCreateModelReturn = {
  create: (
    schemaName: string,
    modelName: string,
    options?: UseCreateModelOptions
  ) => Model
  isLoading: boolean
  error: Error | null
  resetError: () => void
}

export const useCreateModel = (): UseCreateModelReturn => {
  const subscriptionRef = useRef<Subscription | undefined>(undefined)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const resetError = useCallback(() => setError(null), [])

  const create = useCallback(
    (schemaName: string, modelName: string, options?: UseCreateModelOptions): Model => {
      setError(null)
      setIsLoading(true)
      subscriptionRef.current?.unsubscribe()
      subscriptionRef.current = undefined
      const model = Model.create(modelName, schemaName, {
        ...options,
        waitForReady: false,
      }) as import('@/Model/Model').Model
      const subscription = model.getService().subscribe((snapshot) => {
        if (snapshot.value === 'error') {
          setError(
            (snapshot.context as any)._loadingError?.error ??
              new Error('Failed to create model')
          )
          setIsLoading(false)
        }
        if (snapshot.value === 'idle') {
          setError(null)
          setIsLoading(false)
        }
      })
      subscriptionRef.current = subscription
      return model
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

export type UseDestroyModelReturn = {
  destroy: (model: Model) => Promise<void>
  isLoading: boolean
  error: Error | null
  resetError: () => void
}

export const useDestroyModel = (): UseDestroyModelReturn => {
  const [currentInstance, setCurrentInstance] = useState<Model | null>(null)
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

  const destroy = useCallback(async (model: Model) => {
    if (!model) return
    setCurrentInstance(model)
    await model.destroy()
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