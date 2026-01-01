import { loadAllSchemasFromDb, Schema as SchemaType, filterLatestSchemas } from "@/helpers/schema"
import { SchemaFileFormat } from "@/types/import"
import { useCallback, useEffect, useRef, useState } from "react"
import debug from "debug"
import { useIsClientReady } from "./client"
import { getClient } from "@/client/ClientManager"
import { useSelector } from "@xstate/react"
import { Schema } from "@/Schema/Schema"
import { SnapshotFrom } from "xstate"
import { schemaMachine } from "@/Schema/service/schemaMachine"
import { ClientManagerEvents } from "@/client/constants"
import { SEED_PROTOCOL_SCHEMA_NAME } from "@/helpers/constants"
import { generateId } from "@/helpers"
import { useImmer } from "use-immer"

const logger = debug('seedSdk:react:schema')

/**
 * Hook to get a Schema class instance (with setters) that is reactive
 * This allows you to edit schema properties directly like: schema.name = 'New name'
 * The schema instance uses a Proxy to ensure React re-renders when properties change
 * @param schemaIdentifier - The name of the schema or the schema file ID
 *   - If a name is provided, retrieves the latest version with that name
 *   - If an ID is provided, retrieves the specific schema by ID
 * @returns Object with schema instance
 */
// Global cache for schema instances by identifier to prevent loss during React render cycles
// This cache persists across React render cycles but gets validated before use
const schemaInstanceCache = new Map<string | null | undefined, Schema>()

export const useSchema = (schemaIdentifier: string | null | undefined) => {
  const [schema, setSchema] = useState<Schema | null>(null)

  const isClientReady = useIsClientReady()

  useEffect(() => {
    if (!isClientReady) {
      return
    }
    if (schemaIdentifier) {
      const schema = Schema.create(schemaIdentifier)
      setSchema(schema)
    } else {
      setSchema(null)
    }
  }, [schemaIdentifier, isClientReady])
  
  return {
    schema,
  }
  // const [schemaInstance, setSchemaInstance] = useState<Schema | null>(() => {
  //   // Initialize from cache if available
  //   return schemaInstanceCache.get(schemaIdentifier) || null
  // })
  // const schemaInstanceRef = useRef<Schema | null>(null)
  // const previousIdentifierRef = useRef<string | null | undefined>(undefined)
  // const isClientReady = useIsClientReady()

  // logger('[useSchema] Called with schemaIdentifier:', schemaIdentifier, 'isClientReady:', isClientReady, 'previous:', previousIdentifierRef.current, 'cached:', !!schemaInstanceCache.get(schemaIdentifier))

  // // Subscribe to service changes to trigger re-renders when metadata/context changes
  // // Use a state variable that updates on every service snapshot change
  // // This ensures React components re-render when the schema loads or properties change
  // const [, setRenderTrigger] = useState(0)
  // const subscriptionRef = useRef<{ unsubscribe: () => void } | undefined>(undefined)

  // useEffect(() => {
  //   if (!schemaInstance) {
  //     if (subscriptionRef.current) {
  //       subscriptionRef.current.unsubscribe()
  //       subscriptionRef.current = undefined
  //     }
  //     return
  //   }

  //   // Clean up previous subscription
  //   if (subscriptionRef.current) {
  //     subscriptionRef.current.unsubscribe()
  //     subscriptionRef.current = undefined
  //   }

  //   // Subscribe to ALL service snapshot changes to trigger re-renders
  //   // This ensures we catch any context updates, including metadata changes
  //   const subscription = schemaInstance.getService().subscribe((snapshot) => {
  //     // Trigger a re-render on every snapshot change
  //     // The actual data is accessed through the Proxy when the component re-renders
  //     setRenderTrigger((prev) => prev + 1)
  //   })

  //   subscriptionRef.current = subscription

  //   // Cleanup subscription on unmount or when schema changes
  //   return () => {
  //     if (subscriptionRef.current) {
  //       subscriptionRef.current.unsubscribe()
  //       subscriptionRef.current = undefined
  //     }
  //   }
  // }, [schemaInstance])

  // // Create/cleanup schema instance
  // useEffect(() => {
  //   const identifierChanged = previousIdentifierRef.current !== schemaIdentifier
  //   previousIdentifierRef.current = schemaIdentifier

  //   // If no identifier, clear the instance only if it changed
  //   if (!schemaIdentifier) {
  //     if (identifierChanged && schemaInstanceRef.current) {
  //       logger('[useSchema] Identifier changed to null, clearing instance')
  //       schemaInstanceRef.current = null
  //       schemaInstanceCache.delete(previousIdentifierRef.current || undefined)
  //       setSchemaInstance(null)
  //     }
  //     return
  //   }

  //   // If client not ready, wait but don't clear existing instance
  //   if (!isClientReady) {
  //     // If we have an instance for this identifier, keep it
  //     if (schemaInstanceRef.current) {
  //       const currentId = schemaInstanceRef.current.id
  //       const currentName = schemaInstanceRef.current.schemaName
  //       if (currentId === schemaIdentifier || currentName === schemaIdentifier) {
  //         // Ensure state is set even if client not ready yet
  //         if (schemaInstance !== schemaInstanceRef.current) {
  //           setSchemaInstance(schemaInstanceRef.current)
  //         }
  //       }
  //     }
  //     return
  //   }

  //   let cancelled = false

  //   // Helper to get or create schema instance
  //   const getOrCreateSchemaInstance = async () => {
  //     // First check if we already have the correct instance
  //     if (schemaInstanceRef.current && !identifierChanged) {
  //       const currentId = schemaInstanceRef.current.id
  //       const currentName = schemaInstanceRef.current.schemaName
  //       // If identifier matches current ID or name, keep using the same instance
  //       if (currentId === schemaIdentifier || currentName === schemaIdentifier) {
  //         logger('[useSchema] Reusing existing instance from ref:', currentId, currentName)
  //         // Always ensure state is set - React will deduplicate
  //         setSchemaInstance(schemaInstanceRef.current)
  //         return
  //       }
  //     }

  //     // If identifier changed, we need a new instance
  //     // First, try to get by ID (fast cache check)
  //     const cachedById = Schema.getById(schemaIdentifier)
  //     if (cachedById) {
  //       if (cancelled) return
  //       logger('[useSchema] Found cached instance by ID:', cachedById.id)
  //       schemaInstanceRef.current = cachedById
  //       schemaInstanceCache.set(schemaIdentifier, cachedById)
  //       setSchemaInstance(cachedById)
  //       return
  //     }

  //     // Try to create by ID (will query database if not cached)
  //     try {
  //       const schemaById = await Schema.createById(schemaIdentifier)
  //       if (cancelled) {
  //         schemaById.unload()
  //         return
  //       }
  //       logger('[useSchema] Created schema by ID:', schemaById.id)
  //       schemaInstanceRef.current = schemaById
  //       schemaInstanceCache.set(schemaIdentifier, schemaById)
  //       setSchemaInstance(schemaById)
  //       return
  //     } catch (error) {
  //       // If createById fails, treat it as a name instead
  //       logger('[useSchema] createById failed, treating as name:', error)
  //     }

  //     // Fall back to creating by name (treats identifier as schema name)
  //     // Schema.create() uses a cache, so it will return the same instance if called multiple times
  //     logger('[useSchema] Creating schema by name:', schemaIdentifier)
  //     try {
  //       const schemaByName = Schema.create(schemaIdentifier)
  //       if (!schemaByName) {
  //         console.error('[useSchema] Schema.create() returned undefined for:', schemaIdentifier)
  //         return
  //       }
  //       logger('[useSchema] Created/retrieved schema instance:', schemaByName?.id, schemaByName?.schemaName)
  //       if (cancelled) {
  //         // Don't unload here - Schema manages its own cache
  //         return
  //       }
  //       // Always update the ref, cache, and state - Schema.create() will return the cached instance if it exists
  //       schemaInstanceRef.current = schemaByName
  //       schemaInstanceCache.set(schemaIdentifier, schemaByName)
  //       // Always set state to ensure it's not null - React will handle deduplication
  //       setSchemaInstance(schemaByName)
  //       logger('[useSchema] Set schema instance:', schemaByName?.id)
  //     } catch (error) {
  //       console.error('[useSchema] Error creating schema by name:', error)
  //       // Don't set state on error - let it remain as is
  //     }
  //   }

  //   getOrCreateSchemaInstance()

  //   // Cleanup only runs when dependencies change or component unmounts
  //   // We don't clear the ref here because Schema manages its own cache
  //   // The ref will be updated on the next render if needed
  //   return () => {
  //     logger('[useSchema] Cleanup - schemaIdentifier:', schemaIdentifier, 'identifierChanged:', identifierChanged)
  //     cancelled = true
  //     // Don't clear the ref - let the next effect run determine what to do
  //     // This prevents the schema from being lost during React's render cycle
  //   }
  // }, [schemaIdentifier, isClientReady])

  // // Always return from cache if available, even if state hasn't updated yet
  // // This prevents null returns during React's render cycle
  // // Use our cache as a fallback - don't call Schema.create() here as it might cause side effects
  // let currentSchema = schemaInstance
  
  // // Only use cache if we have a valid identifier (not null/undefined)
  // if (!currentSchema && schemaIdentifier) {
  //   // Use our cache as fallback
  //   const cachedSchema = schemaInstanceCache.get(schemaIdentifier)
  //   if (cachedSchema) {
  //     try {
  //       // Validate the cached instance is still usable
  //       const snapshot = cachedSchema.getService().getSnapshot()
  //       if (snapshot.status !== 'stopped') {
  //         currentSchema = cachedSchema
  //       } else {
  //         // Instance was unloaded, remove from cache
  //         schemaInstanceCache.delete(schemaIdentifier)
  //       }
  //     } catch (error) {
  //       // Instance is invalid, remove from cache
  //       schemaInstanceCache.delete(schemaIdentifier)
  //     }
  //   }
  // }
  
  // // If schemaIdentifier is null/undefined, ensure we return null (don't use cache)
  // if (!schemaIdentifier) {
  //   currentSchema = null
  // }

  // logger('[useSchema] Returning schema instance:', currentSchema?.id, currentSchema?.schemaName, 'from state:', !!schemaInstance, 'from ref:', !!schemaInstanceRef.current)
  // return {
  //   schema: currentSchema,
  // }
}

export const useSchemas = (options?: { returnLatest?: boolean }) => {
  const { returnLatest = true } = options || {}
  const isClientReady = useIsClientReady()
  const [schemaInstances, setSchemaInstances] = useImmer<Schema[]>([])
  const schemaInstancesRef = useRef<Map<string, Schema>>(new Map())
  const [schemaNames, setSchemaNames] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // Fetch schema names from database instead of client context
  useEffect(() => {
    if (!isClientReady) {
      setIsLoading(false)
      setSchemaNames([])
      return
    }

    let cancelled = false

    const fetchSchemaNames = async () => {
      try {
        setIsLoading(true)
        // Use loadAllSchemasFromDb to get all schemas from database
        const allSchemasData = await loadAllSchemasFromDb()
        
        if (cancelled) return

        // Filter to latest versions if requested
        const filteredSchemas = returnLatest 
          ? filterLatestSchemas(allSchemasData.map(s => s.schema))
          : allSchemasData.map(s => s.schema)
        
        // Extract schema names and create a stable sorted array
        // Filter out internal SDK schemas (e.g., Seed Protocol) - these should not appear in useSchemas
        const names = filteredSchemas
          .map((schemaFile) => schemaFile.metadata?.name)
          .filter((name): name is string => !!name && name !== SEED_PROTOCOL_SCHEMA_NAME)
          .sort() // Sort for stable comparison
        
        setSchemaNames(names)
      } catch (error) {
        logger('Error fetching schema names from database:', error)
        if (!cancelled) {
          setSchemaNames([])
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    fetchSchemaNames()

    return () => {
      cancelled = true
    }
  }, [isClientReady, returnLatest])

  // Create/update Schema instances when schema names change
  useEffect(() => {
    if (!isClientReady || schemaNames.length === 0) {
      // Cleanup all instances if client not ready or no schemas
      schemaInstancesRef.current.forEach((instance) => {
        instance.unload()
      })
      schemaInstancesRef.current.clear()
      setSchemaInstances([])
      return
    }

    // Check if we already have all the required instances
    // This prevents unnecessary Schema.create calls that could trigger context updates
    const hasAllInstances = schemaNames.every(name => schemaInstancesRef.current.has(name))
    const hasNoExtraInstances = Array.from(schemaInstancesRef.current.keys()).every(name => schemaNames.includes(name))
    
    // If we already have all the instances we need and no extras, skip creating new ones
    if (hasAllInstances && hasNoExtraInstances) {
      return
    }

    // Create instances for new schema names
    const currentInstances = new Map<string, Schema>()
    
    for (const schemaName of schemaNames) {
      // Reuse existing instance if it exists
      if (schemaInstancesRef.current.has(schemaName)) {
        const existingInstance = schemaInstancesRef.current.get(schemaName)!
        currentInstances.set(schemaName, existingInstance)
      } else {
        // Create new instance
        const schema = Schema.create(schemaName)
        currentInstances.set(schemaName, schema)
      }
    }

    // Cleanup instances that are no longer needed
    for (const [name, instance] of schemaInstancesRef.current.entries()) {
      if (!schemaNames.includes(name)) {
        instance.unload()
      }
    }

    // Update ref and state
    schemaInstancesRef.current = currentInstances
    const newInstances = Array.from(currentInstances.values())
    
    // Only update if the instances actually changed (avoid unnecessary re-renders)
    setSchemaInstances((draft) => {
      // Check if arrays are different
      if (
        draft.length !== newInstances.length ||
        draft.some((instance, index) => instance !== newInstances[index])
      ) {
        draft.length = 0
        draft.push(...newInstances)
      }
      // If unchanged, Immer keeps the same reference
    })

    // Cleanup on unmount
    return () => {
      schemaInstancesRef.current.forEach((instance) => {
        instance.unload()
      })
      schemaInstancesRef.current.clear()
    }
  }, [schemaNames, isClientReady])

  return schemaInstances

}

export const useAllSchemaVersions = () => {
  const [schemaInstances, setSchemaInstances] = useState<Schema[] | undefined | null>()
  const schemaInstancesRef = useRef<Map<string, Schema>>(new Map())
  const isClientReady = useIsClientReady()

  const fetchSchemas = useCallback(async () => {
    if (!isClientReady) {
      return
    }

    try {
      // Use DB-first approach: load all schemas from database
      // This will also import any missing schemas from files
      const allSchemasData = await loadAllSchemasFromDb()

      // Extract unique schema names
      const schemaNames = new Set<string>()
      for (const schemaData of allSchemasData) {
        const schemaName = schemaData.schema.metadata?.name
        if (schemaName) {
          schemaNames.add(schemaName)
        }
      }

      // Create/update Schema instances
      const currentInstances = new Map<string, Schema>()
      
      for (const schemaName of schemaNames) {
        // Reuse existing instance if it exists
        if (schemaInstancesRef.current.has(schemaName)) {
          const existingInstance = schemaInstancesRef.current.get(schemaName)!
          currentInstances.set(schemaName, existingInstance)
        } else {
          // Create new instance
          const schema = Schema.create(schemaName)
          currentInstances.set(schemaName, schema)
        }
      }

      // Cleanup instances that are no longer needed
      for (const [name, instance] of schemaInstancesRef.current.entries()) {
        if (!schemaNames.has(name)) {
          instance.unload()
        }
      }

      // Update ref and state
      schemaInstancesRef.current = currentInstances
      setSchemaInstances(Array.from(currentInstances.values()))
    } catch (error) {
      logger('Error fetching all schema versions from database:', error)
      setSchemaInstances(null)
    }
  }, [isClientReady])

  useEffect(() => {
    if (!isClientReady) {
      return
    }
    fetchSchemas()
  }, [isClientReady, fetchSchemas])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      schemaInstancesRef.current.forEach((instance) => {
        instance.unload()
      })
      schemaInstancesRef.current.clear()
    }
  }, [])

  return schemaInstances
}

type SchemaSnapshot = SnapshotFrom<typeof schemaMachine>


/**
 * Hook to get the internal Seed Protocol schema (SDK-only schema)
 * This schema is managed by the SDK and should not be edited by app developers
 * @returns Object with schema instance and schemaData (version, metadata, etc.)
 */
export const useSeedProtocolSchema = () => {
  const { SEED_PROTOCOL_SCHEMA_NAME } = require('@/helpers/constants')
  return useSchema(SEED_PROTOCOL_SCHEMA_NAME)
}

export const useCreateSchema = () => {
  const [currentSchema, setCurrentSchema] = useState<Schema | null>(null)
  const errorRef = useRef<Error | null>(null)
  const subscriptionRef = useRef<{ unsubscribe: () => void } | null>(null)
  const isClientReady = useIsClientReady()

  // Get the schema service if we have a current schema
  const schemaService = currentSchema?.getService()

  // Use useSelector to get the state and derive isLoading and error
  const state = useSelector(schemaService, (snapshot: SchemaSnapshot | undefined) => {
    if (!snapshot) {
      return null
    }
    return snapshot.value
  })

  // Derive isLoading from the state
  const isLoading = state === 'loading' || state === 'validating'

  // Derive error from the state
  const error = state === 'error' ? errorRef.current : null

  // Subscribe to state changes to capture errors and update client context
  useEffect(() => {
    if (!schemaService) {
      return
    }

    const subscription = schemaService.subscribe((snapshot: SchemaSnapshot) => {
      if (snapshot.value === 'error') {
        // Set a generic error if we're in error state
        if (!errorRef.current) {
          errorRef.current = new Error('Failed to create schema')
        }
      } else if (snapshot.value === 'idle') {
        // Clear error when we successfully transition to idle
        if (errorRef.current) {
          errorRef.current = null
        }

        // Update client context with the new schema so useSchemas can see it
        const context = snapshot.context
        if (context && context.metadata?.name) {
          // Use async function to get schema from database with id
          const updateContext = async () => {
            try {
              const client = getClient()
              const clientService = client.getService()
              const currentContext = clientService.getSnapshot().context

              const schemaName = context.metadata!.name

              // Get the schema from database to ensure we have the id
              const allSchemasData = await loadAllSchemasFromDb()
              const matchingSchema = allSchemasData.find(
                (s) => s.schema.metadata?.name === schemaName
              )

              if (matchingSchema) {
                // Update client context with the new schema
                const updatedSchemas = {
                  ...(currentContext.schemas || {}),
                  [schemaName]: matchingSchema.schema,
                }

                clientService.send({
                  type: ClientManagerEvents.UPDATE_CONTEXT,
                  context: {
                    schemas: updatedSchemas,
                  },
                })

                logger(`Updated client context with new schema: ${schemaName}`)
              } else {
                // Fallback: build schema from context if not found in DB
                if (context.metadata) {
                  const schemaFile: SchemaFileFormat = {
                    $schema: context.$schema || 'https://seedprotocol.org/schemas/data-model/v1',
                    version: context.version || 1,
                    id: generateId(),
                    metadata: context.metadata,
                    models: context.models || {},
                    enums: context.enums || {},
                    migrations: context.migrations || [],
                  }

                  const updatedSchemas = {
                    ...(currentContext.schemas || {}),
                    [schemaName]: schemaFile,
                  }

                  clientService.send({
                    type: ClientManagerEvents.UPDATE_CONTEXT,
                    context: {
                      schemas: updatedSchemas,
                    },
                  })

                  logger(`Updated client context with new schema (fallback): ${schemaName}`)
                }
              }
            } catch (error) {
              logger('Error updating client context with new schema:', error)
            }
          }

          updateContext()
        }
      }
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [schemaService])

  // Cleanup subscription when component unmounts or schema changes
  useEffect(() => {
    return () => {
      if (subscriptionRef.current) {
        subscriptionRef.current.unsubscribe()
        subscriptionRef.current = null
      }
    }
  }, [])

  const createSchema = useCallback(
    (schemaName: string) => {
      if (!isClientReady) {
        logger('Client not ready, cannot create schema')
        return
      }

      if (!schemaName) {
        logger('Schema name is required')
        errorRef.current = new Error('Schema name is required')
        return
      }

      try {
        // Cleanup previous subscription if it exists
        if (subscriptionRef.current) {
          subscriptionRef.current.unsubscribe()
          subscriptionRef.current = null
        }

        // Clear previous error
        errorRef.current = null

        // Create the schema instance (this will automatically start loading)
        const schema = Schema.create(schemaName)
        setCurrentSchema(schema)

        // Listen for error events to capture the actual error
        const service = schema.getService()
        const subscription = service.subscribe((snapshot: SchemaSnapshot) => {
          if (snapshot.value === 'error') {
            // Try to capture the error from the last event
            // Since the machine doesn't store error in context, we'll use a generic message
            errorRef.current = new Error(`Failed to create schema: ${schemaName}`)
          }
        })

        subscriptionRef.current = subscription
      } catch (err) {
        logger('Error creating schema:', err)
        errorRef.current = err instanceof Error ? err : new Error('Unknown error creating schema')
        setCurrentSchema(null)
      }
    },
    [isClientReady]
  )

  return {
    createSchema,
    isLoading,
    error,
  }
}