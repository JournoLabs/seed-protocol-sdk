import { useContext, useMemo, useState, useEffect, useCallback, useRef } from 'react'
import { Model } from '@seedprotocol/sdk'
import { useIsClientReady } from './client'
import { useLiveQuery } from './liveQuery'
import { BaseDb } from '@seedprotocol/sdk'
import { models as modelsTable, modelSchemas, schemas as schemasTable } from '@seedprotocol/sdk'
import { eq, or } from 'drizzle-orm'
import { Subscription } from 'xstate'
import { QueryClient, QueryClientContext, useQuery } from '@tanstack/react-query'

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

// Used only outside a QueryClientProvider: useModel(modelId) calls useModels(null) (hooks must
// run in the same order), and an id lookup never needed a provider.
let fallbackQueryClient: QueryClient | undefined

export const useModels: UseModels = (schemaId) => {
  const isClientReady = useIsClientReady()
  const contextQueryClient = useContext(QueryClientContext)
  const queryClient = contextQueryClient ?? (fallbackQueryClient ??= new QueryClient())
  // Latest models-table rows for this schema (live query): the ground truth for what exists.
  const tableIdsRef = useRef<Set<string> | null>(null)

  const queryKey = useMemo(() => getModelsQueryKey(schemaId), [schemaId])

  const {
    data: models = [],
    isLoading,
    error: queryError,
  } = useQuery({
    queryKey,
    queryFn: async () => {
      // Use waitForReady: false so we return models as soon as they exist; waitForReady: true
      // filters to only idle models and can return [] while a model is in creatingProperties.
      const next = await Model.all(schemaId!, { waitForReady: false })
      // Model.all can briefly return [] while models load. Keep the previous list only while the
      // table still has rows; once it is empty (all deleted), [] is the answer.
      const prev = queryClient.getQueryData<Model[]>(queryKey)
      const tableIds = tableIdsRef.current
      if (next.length === 0 && prev && prev.length > 0 && (!tableIds || tableIds.size > 0)) {
        return prev
      }
      return next
    },
    enabled: isClientReady && !!schemaId,
  }, queryClient)
  const displayModels = schemaId ? models : []
  const modelsRef = useRef<Model[]>(displayModels)
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
    tableIdsRef.current = tableDataModelsSet

    const setsAreEqual =
      currentModelsSet.size === tableDataModelsSet.size &&
      [...currentModelsSet].every((id) => tableDataModelsSet.has(id))

    // Refetch on any difference: new rows, and deleted ones (which used to leave the list stale).
    if (!setsAreEqual) {
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
        const foundModel = await Model.createById(schemaIdOrModelId, { hold: false })
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

  // Always call useModels (with null for an id lookup): hooks must run in the same order on
  // every render, and returning early before it crashed when modelName switched null <-> string.
  const { models: modelsList, isLoading: modelsLoading, error: modelsError } = useModels(
    isModelIdLookup ? null : schemaIdOrModelId,
  )
  const foundModel = useMemo(() => {
    if (isModelIdLookup || !modelName) {
      return undefined
    }
    // Try both modelName property and name getter for compatibility
    return modelsList.find((m: Model) => {
      const mName = m.modelName ?? (m as any).name
      return mName === modelName
    })
  }, [isModelIdLookup, modelsList, modelName])

  const activeModel = isModelIdLookup ? model : foundModel

  // Re-render on the model's service changes
  useEffect(() => {
    subscriptionRef.current?.unsubscribe()
    subscriptionRef.current = undefined
    if (!activeModel) return

    subscriptionRef.current = activeModel.getService().subscribe(() => {
      setVersion((prev) => prev + 1)
    })

    return () => {
      subscriptionRef.current?.unsubscribe()
      subscriptionRef.current = undefined
    }
  }, [activeModel])

  if (isModelIdLookup) {
    return {
      model,
      isLoading,
      error,
    }
  }
  return {
    model: foundModel,
    isLoading: modelsLoading,
    error: modelsError,
  }
}

export type UseCreateModelOptions = {
  modelFileId?: string
  properties?: { [propertyName: string]: any }
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
      }) as Model
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
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  // Loading state is tracked here: the model's service doesn't record destroy progress, and
  // destroy() stops the service, often within a few microtasks.
  const destroy = useCallback(async (model: Model) => {
    if (!model) return
    setError(null)
    setIsLoading(true)
    try {
      await model.destroy()
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
