import { useMemo, useState, useEffect, useRef } from 'react'
import { Model } from '@/Model/Model'
import { useIsClientReady } from './client'
import { useSchema } from './schema'

/**
 * Hook to get all Model instances for a specific schema
 * @param schemaId - The schema ID (schema file ID) or schema name to get models from
 * @returns Array of Model instances belonging to the schema
 */
export const useModels = (schemaId: string | null | undefined): Model[] => {
  const {schema} = useSchema(schemaId)

  return schema ? schema?.models : []
  // const isClientReady = useIsClientReady()
  // const { schema } = useSchema(schemaId)
  // const [models, setModels] = useState<Model[]>([])
  // const previousModelIdsRef = useRef<Set<string>>(new Set())

  // // Load models from database and merge with schema instanceState
  // useEffect(() => {
  //   if (!isClientReady || !schemaId) {
  //     setModels([])
  //     previousModelIdsRef.current = new Set()
  //     return
  //   }

  //   const loadModels = async () => {
  //     try {
  //       // Wait for schema to be ready if it exists
  //       if (schema) {
  //         const schemaSnapshot = schema.getService().getSnapshot()
  //         // If schema is still loading, wait for it to be idle
  //         if (schemaSnapshot.value !== 'idle' && schemaSnapshot.value !== 'error') {
  //           await new Promise<void>((resolve) => {
  //             const subscription = schema.getService().subscribe((snapshot) => {
  //               if (snapshot.value === 'idle' || snapshot.value === 'error') {
  //                 subscription.unsubscribe()
  //                 resolve()
  //               }
  //             })
  //             // Timeout after 5 seconds
  //             setTimeout(() => {
  //               subscription.unsubscribe()
  //               resolve()
  //             }, 5000)
  //           })
  //         }
  //       }

  //       // Query DB directly for persisted models
  //       const dbModels = await Model.createBySchemaId(schemaId)
        
  //       // Also check schema.models for newly registered models that might not be in DB yet
  //       let allModels = dbModels
  //       if (schema) {
  //         const schemaModels = (schema.models || []) as Model[]
  //         // Merge: add any models from schema that aren't in DB results
  //         const dbModelIds = new Set(dbModels.map(m => m.id).filter((id): id is string => Boolean(id)))
  //         const schemaOnlyModels = schemaModels.filter(m => {
  //           const modelId = m.id
  //           return modelId && !dbModelIds.has(modelId)
  //         })
  //         allModels = [...dbModels, ...schemaOnlyModels]
  //       }
        
  //       // Update ref with current model IDs
  //       previousModelIdsRef.current = new Set(allModels.map(m => m.id).filter((id): id is string => Boolean(id)))
  //       setModels(allModels)
  //     } catch (error) {
  //       console.error('[useModels] Error loading models:', error)
  //       setModels([])
  //       previousModelIdsRef.current = new Set()
  //     }
  //   }

  //   loadModels()
  // }, [isClientReady, schemaId, schema])

  // // Subscribe to schema changes to detect when new models are registered
  // useEffect(() => {
  //   if (!schema || !schemaId) {
  //     return
  //   }

  //   let previousServiceState: string | undefined = undefined

  //   const subscription = schema.getService().subscribe((snapshot) => {
  //     const currentState = snapshot.value as string
  //     const contextModelNames = snapshot.context.models ? Object.keys(snapshot.context.models) : []
      
  //     // Check schema.models directly (getter returns array from instanceState)
  //     // This is more reliable than comparing context.models object keys
  //     const currentSchemaModels = (schema.models || []) as Model[]
  //     const currentModelIds = new Set(currentSchemaModels.map(m => m.id).filter((id): id is string => Boolean(id)))
      
  //     // Also check context.models object keys as a fallback
  //     const contextModelIds = new Set<string>()
  //     for (const modelName of contextModelNames) {
  //       const model = currentSchemaModels.find(m => m.modelName === modelName)
  //       if (model?.id) {
  //         contextModelIds.add(model.id)
  //       }
  //     }
      
  //     // Combine both sources of model IDs
  //     const allCurrentModelIds = new Set([...currentModelIds, ...contextModelIds])
      
  //     // Compare with previous model IDs to detect new models
  //     const hasNewModels = allCurrentModelIds.size > previousModelIdsRef.current.size ||
  //       Array.from(allCurrentModelIds).some(id => !previousModelIdsRef.current.has(id))
      
  //     // Also reload when service transitions to idle after validation (model registration completes)
  //     const transitionedToIdle = previousServiceState === 'validating' && currentState === 'idle'
      
  //     if (hasNewModels || transitionedToIdle) {
  //       console.log('[useModels] Detected model change:', {
  //         hasNewModels,
  //         transitionedToIdle,
  //         currentState,
  //         previousState: previousServiceState,
  //         currentModelIds: Array.from(allCurrentModelIds),
  //         previousModelIds: Array.from(previousModelIdsRef.current),
  //         contextModelNames,
  //         schemaModelsCount: currentSchemaModels.length,
  //       })
        
  //       // Re-query DB and merge with schema.models
  //       Model.createBySchemaId(schemaId!).then((dbModels) => {
  //         const schemaModels = (schema.models || []) as Model[]
  //         const dbModelIds = new Set(dbModels.map(m => m.id).filter((id): id is string => Boolean(id)))
  //         const schemaOnlyModels = schemaModels.filter(m => m.id && !dbModelIds.has(m.id))
  //         const allModels = [...dbModels, ...schemaOnlyModels]
          
  //         console.log('[useModels] Reloaded models:', {
  //           dbModelsCount: dbModels.length,
  //           schemaModelsCount: schemaModels.length,
  //           totalModelsCount: allModels.length,
  //           modelNames: allModels.map(m => m.modelName),
  //         })
          
  //         // Update ref with new model IDs
  //         previousModelIdsRef.current = new Set(allModels.map(m => m.id).filter((id): id is string => Boolean(id)))
  //         setModels(allModels)
  //       }).catch((error) => {
  //         console.error('[useModels] Error reloading models:', error)
  //       })
  //     }
      
  //     previousServiceState = currentState
  //   })

  //   return () => {
  //     subscription.unsubscribe()
  //   }
  // }, [schema, schemaId])

  // return models
}

/**
 * Hook to get a specific Model instance
 * Can be called in two ways:
 * 1. With schemaId and modelName: useModel(schemaId, modelName)
 * 2. With modelId: useModel(modelId)
 * 
 * @param schemaIdOrModelId - The schema ID (schema file ID) OR the model ID (modelFileId)
 * @param modelName - The name of the model to retrieve (required if first param is schemaId)
 * @returns The Model instance if found, undefined otherwise
 */
export const useModel = (
  schemaIdOrModelId: string | null | undefined,
  modelName?: string | null | undefined
): Model | undefined => {
  const isClientReady = useIsClientReady()
  const [model, setModel] = useState<Model | undefined>(undefined)

  // If modelName is provided, treat first param as schemaId
  // Otherwise, treat first param as modelId
  const isModelIdLookup = modelName === undefined || modelName === null

  // Lookup model by ID if needed
  useEffect(() => {
    if (!isClientReady || !isModelIdLookup || !schemaIdOrModelId) {
      setModel(undefined)
      return
    }

    const lookupModelById = async () => {
      try {
        // Use Model.createById which handles cache + DB lookup
        const foundModel = await Model.createById(schemaIdOrModelId)
        setModel(foundModel || undefined)
      } catch (error) {
        console.error('[useModel] Error looking up model by ID:', error)
        setModel(undefined)
      }
    }

    lookupModelById()
  }, [isClientReady, isModelIdLookup, schemaIdOrModelId])

  // If doing modelId lookup, return the model directly
  if (isModelIdLookup) {
    return model
  }

  // Otherwise, use schemaId + modelName lookup via useModels
  const models = useModels(schemaIdOrModelId)
  return useMemo(() => {
    if (!modelName) {
      return undefined
    }
    // Try both modelName property and name getter for compatibility
    return models.find((m) => {
      const mName = m.modelName ?? (m as any).name
      return mName === modelName
    })
  }, [models, modelName])
}