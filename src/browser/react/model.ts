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
export const useModels: UseModels = (schemaId) => {
  const [models, setModels] = useState<Model[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const isClientReady = useIsClientReady()

  // Watch the models table for changes via model_schemas join table
  // Memoize the query so it's stable across renders - this is critical for distinctUntilChanged to work
  const db = isClientReady ? BaseDb.getAppDb() : null
  const modelsQuery = useMemo(() => {
    if (!db || !schemaId) return null
    return db
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
  }, [db, isClientReady, schemaId])
  const modelsTableData = useLiveQuery<{ modelFileId: string | null; modelName: string }>(modelsQuery)

  const fetchModels = useCallback(async () => {
    if (!schemaId) {
      setModels([])
      setIsLoading(false)
      setError(null)
      return
    }

    try {
      setIsLoading(true)
      const timestamp = Date.now()
      console.log(`[useModels.fetchModels] [${timestamp}] Starting fetch, modelsTableData count:`, modelsTableData?.length, 'models:', modelsTableData?.map(m => m.modelName))
      
      // Use Model.createBySchemaId to get Model instances (handles caching)
      const modelInstances = await Model.createBySchemaId(schemaId)
      console.log(`[useModels.fetchModels] [${timestamp}] Model.createBySchemaId() returned:`, modelInstances.length, 'models:', modelInstances.map((m: any) => m.modelName))
      
      setModels(prev => {
        // Check if anything actually changed
        if (prev.length !== modelInstances.length) {
          console.log('[useModels] Length changed:', prev.length, '->', modelInstances.length)
          return modelInstances
        }
        
        // Compare by modelFileId (schemaFileId) or name
        const hasChanged = modelInstances.some((model, i) => 
          !prev[i] || 
          model.id !== prev[i].id || 
          model.modelName !== prev[i].modelName
        )
        
        if (hasChanged) {
          console.log('[useModels] Models changed (by ID or name)')
        } else {
          console.log('[useModels] No changes detected')
        }
        return hasChanged ? modelInstances : prev
      })
      setError(null)
      setIsLoading(false)
    } catch (error) {
      setError(error as Error)
      setIsLoading(false)
    }
  }, [schemaId])

  // Fetch models on initial mount when client is ready
  useEffect(() => {
    if (!isClientReady) {
      return
    }
    // Initial fetch when client becomes ready
    fetchModels()
  }, [isClientReady, fetchModels])

  // Refetch models when table data actually changes (not just reference)
  useEffect(() => {
    if (!isClientReady || !modelsTableData || !schemaId) {
      return
    }

    // Extract identifying information from current models in state
    // Use modelFileId (schemaFileId) if available, otherwise fall back to name
    const currentModelsSet = new Set<string>()
    for (const model of models) {
      const modelFileId = model.id || (model as any).modelFileId
      if (modelFileId) {
        currentModelsSet.add(modelFileId)
      } else {
        // Fallback to name if modelFileId not available
        const name = model.modelName
        if (name) {
          currentModelsSet.add(name)
        }
      }
    }

    // Extract identifying information from modelsTableData
    const tableDataModelsSet = new Set<string>()
    for (const dbModel of modelsTableData) {
      if (dbModel.modelFileId) {
        tableDataModelsSet.add(dbModel.modelFileId)
      } else {
        // Fallback to name if modelFileId not available
        if (dbModel.modelName) {
          tableDataModelsSet.add(dbModel.modelName)
        }
      }
    }

    // Compare sets to detect changes
    const setsAreEqual = 
      currentModelsSet.size === tableDataModelsSet.size &&
      [...currentModelsSet].every(id => tableDataModelsSet.has(id))

    if (setsAreEqual) {
      // Models in state match table data, skip refetch
      return
    }

    // Models have changed - log for debugging
    console.log('[useModels] modelsTableData changed:', {
      currentCount: currentModelsSet.size,
      tableDataCount: tableDataModelsSet.size,
      currentIds: Array.from(currentModelsSet),
      tableDataIds: Array.from(tableDataModelsSet),
      tableDataNames: modelsTableData.map(m => m.modelName),
      tableDataFull: modelsTableData.map(m => ({ name: m.modelName, modelFileId: m.modelFileId })),
    })

    // Models have changed, fetch updated models
    fetchModels()
  }, [isClientReady, modelsTableData, models, fetchModels, schemaId])

  return {
    models,
    isLoading,
    error,
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

  // For schemaId + modelName lookup, derive loading/error from useModels
  return {
    model: foundModel,
    isLoading: modelsLoading,
    error: modelsError,
  }
}