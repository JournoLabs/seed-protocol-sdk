import { useModel } from "./model"
import { useCallback, useEffect, useRef, useState, useMemo } from "react"
import { getPropertySchema } from "@/helpers/property"
import { ModelProperty } from "@/ModelProperty/ModelProperty"
import { useIsClientReady } from "./client"
import { Subscription } from "xstate"
import { useImmer } from "use-immer"
import { ModelPropertyMachineContext } from "@/ModelProperty/service/modelPropertyMachine"
import { ValidationError } from "@/Schema/validation"
import debug from "debug"
import { useLiveQuery } from "./liveQuery"
import { BaseDb } from "@/db/Db/BaseDb"
import { properties as propertiesTable, models as modelsTable } from "@/seedSchema/ModelSchema"
import { eq } from "drizzle-orm"

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
  const model = useModel(schemaIdOrModelId, modelName)
  
  // Determine the modelName for use in getPropertySchema
  const modelNameForProperty = useMemo(() => {
    if (!model) return undefined
    try {
      return model.modelName ?? (model as any).name
    } catch {
      return undefined
    }
  }, [model])
  const [modelProperties, setModelProperties] = useState<ModelProperty[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const isClientReady = useIsClientReady()

  // Get modelId (database ID) from model context
  const dbModelId = useMemo(() => {
    if (!model) return null
    try {
      const context = (model as any)._getSnapshotContext()
      return context.modelId as number | undefined
    } catch {
      return null
    }
  }, [model])

  // Watch the properties table for changes
  // Memoize the query so it's stable across renders - this is critical for distinctUntilChanged to work
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

  const fetchModelProperties = useCallback(async () => {
    if (!modelNameForProperty || !model || !schemaIdOrModelId) {
      setModelProperties([])
      setIsLoading(false)
      setError(null)
      return
    }

    try {
      setIsLoading(true)
      const timestamp = Date.now()
      console.log(`[useModelProperties.fetchModelProperties] [${timestamp}] Starting fetch, propertiesTableData count:`, propertiesTableData?.length, 'properties:', propertiesTableData?.map(p => p.name))
      
      // Get model properties from the model instance
      if (!model.properties || model.properties.length === 0) {
        setModelProperties([])
        setError(null)
        setIsLoading(false)
        return
      }

      const _modelProperties: ModelProperty[] = []

      for (const propertyDefinition of model.properties) {
        const propertyName = propertyDefinition.name
        if (!propertyName) continue

        const modelPropertyData = await getPropertySchema(modelNameForProperty, propertyName)
        if (modelPropertyData) {
          const modelProperty = ModelProperty.create({
            ...modelPropertyData,
          })
          _modelProperties.push(modelProperty)
        }
      }

      console.log(`[useModelProperties.fetchModelProperties] [${timestamp}] Created ${_modelProperties.length} ModelProperty instances`)
      
      setModelProperties(prev => {
        // Check if anything actually changed
        if (prev.length !== _modelProperties.length) {
          console.log('[useModelProperties] Length changed:', prev.length, '->', _modelProperties.length)
          return _modelProperties
        }
        
        // Compare by property name or schemaFileId
        const hasChanged = _modelProperties.some((prop, i) => {
          if (!prev[i]) return true
          const prevContext = (prev[i] as any)._getSnapshotContext()
          const currContext = (prop as any)._getSnapshotContext()
          const prevId = prevContext?.id
          const currId = currContext?.id
          const prevName = prev[i].name
          const currName = prop.name
          return prevId !== currId || prevName !== currName
        })
        
        if (hasChanged) {
          console.log('[useModelProperties] Properties changed (by ID or name)')
        } else {
          console.log('[useModelProperties] No changes detected')
        }
        return hasChanged ? _modelProperties : prev
      })
      setError(null)
      setIsLoading(false)
    } catch (error) {
      setError(error as Error)
      setIsLoading(false)
    }
  }, [modelNameForProperty, model, propertiesTableData, schemaIdOrModelId])

  // Fetch model properties on initial mount when client is ready
  useEffect(() => {
    if (!isClientReady) {
      return
    }
    // Initial fetch when client becomes ready
    fetchModelProperties()
  }, [isClientReady, fetchModelProperties])

  // Refetch model properties when table data actually changes (not just reference)
  useEffect(() => {
    if (!isClientReady || !propertiesTableData || !modelNameForProperty || !model || !schemaIdOrModelId) {
      return
    }

    // Extract identifying information from current properties in state
    const currentPropertiesSet = new Set<string>()
    for (const prop of modelProperties) {
      const context = (prop as any)._getSnapshotContext()
      const propertyFileId = context?.id
      if (propertyFileId) {
        currentPropertiesSet.add(propertyFileId)
      } else {
        // Fallback to name if propertyFileId not available
        const name = prop.name
        if (name) {
          currentPropertiesSet.add(name)
        }
      }
    }

    // Extract identifying information from propertiesTableData
    const tableDataPropertiesSet = new Set<string>()
    for (const dbProperty of propertiesTableData) {
      if (dbProperty.schemaFileId) {
        tableDataPropertiesSet.add(dbProperty.schemaFileId)
      } else {
        // Fallback to name if schemaFileId not available
        if (dbProperty.name) {
          tableDataPropertiesSet.add(dbProperty.name)
        }
      }
    }

    // Compare sets to detect changes
    const setsAreEqual = 
      currentPropertiesSet.size === tableDataPropertiesSet.size &&
      [...currentPropertiesSet].every(id => tableDataPropertiesSet.has(id))

    if (setsAreEqual) {
      // Properties in state match table data, skip refetch
      return
    }

    // Properties have changed - log for debugging
    console.log('[useModelProperties] propertiesTableData changed:', {
      currentCount: currentPropertiesSet.size,
      tableDataCount: tableDataPropertiesSet.size,
      currentIds: Array.from(currentPropertiesSet),
      tableDataIds: Array.from(tableDataPropertiesSet),
      tableDataNames: propertiesTableData.map(p => p.name),
      tableDataFull: propertiesTableData.map(p => ({ name: p.name, schemaFileId: p.schemaFileId })),
    })

    // Properties have changed, fetch updated properties
    fetchModelProperties()
  }, [isClientReady, propertiesTableData, modelProperties, fetchModelProperties, modelNameForProperty, model, schemaIdOrModelId])

  return {
    modelProperties,
    isLoading,
    error,
  }
}

export const useModelProperty = (modelName: string, propertyName: string) => {
  const [modelPropertyData, setModelPropertyData] = useImmer<ModelPropertyMachineContext | undefined>(undefined)
  const [modelProperty, setModelProperty] = useState<ModelProperty | undefined>(undefined)
  const [validationErrors, setValidationErrors] = useState<ValidationError[] | undefined>(undefined)
  const subscriptionRef = useRef<Subscription | undefined>(undefined)

  const isClientReady = useIsClientReady()

  const updateModelProperty = useCallback(async (modelName: string, propertyName: string) => {
    const modelPropertyData = await getPropertySchema(modelName, propertyName)
    if (modelPropertyData) {
      const modelProperty = ModelProperty.create({
        ...modelPropertyData,
        modelName,
      })
      setModelProperty(modelProperty)
      setValidationErrors(modelProperty.validationErrors)
      setModelPropertyData((draft) => {
        if (draft) {
          const context = modelProperty.getService().getSnapshot().context
          Object.assign(draft, context)
        } else {
          setModelPropertyData(modelProperty.getService().getSnapshot().context)
        }
      })
    }
  }, [])

  useEffect(() => {
    if (!isClientReady) {
      return
    }

    if (!modelProperty) {
      updateModelProperty(modelName, propertyName)
    }
  }, [modelName, propertyName, isClientReady, modelProperty, updateModelProperty])

  useEffect(() => {
    if (!modelProperty) {
      return
    }

    // Clean up previous subscription
    subscriptionRef.current?.unsubscribe()

    // Subscribe to service changes
    const subscription = modelProperty.getService().subscribe((snapshot) => {
      updateModelProperty(modelName, propertyName)
    })
    
    subscriptionRef.current = subscription

    return () => {
      subscriptionRef.current?.unsubscribe()
      subscriptionRef.current = undefined
    }
  }, [modelName, propertyName, modelProperty, updateModelProperty])

  return {
    modelPropertyData,
    modelProperty,
    validationErrors,
  }
}