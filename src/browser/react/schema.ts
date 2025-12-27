import { loadAllSchemasFromDb, Schema as SchemaType, filterLatestSchemas } from "@/helpers/schema"
import { SchemaFileFormat } from "@/types/import"
import { useCallback, useEffect, useRef, useState } from "react"
import debug from "debug"
import { useIsClientReady } from "./client"
import { getClient } from "@/client/ClientManager"
import { useSelector } from "@xstate/react"
import { Schema } from "@/schema/Schema"
import { SnapshotFrom } from "xstate"
import { schemaMachine, SchemaMachineContext } from "@/schema/service/schemaMachine"
import { ClientManagerEvents } from "@/services/internal/constants"
import { generateId } from "@/helpers"
import { useImmer } from "use-immer"
import { produce } from "immer"
import { Subscription } from "xstate"

const logger = debug('seedSdk:react:schema')

/**
 * Hook to get a Schema class instance (with setters) and reactive schema data
 * This allows you to edit schema properties directly like: schema.name = 'New name'
 * The schemaData object will automatically update when version or metadata change
 * @param schemaName - The name of the schema to get
 * @returns Object with schema instance and schemaData (version, metadata, etc.)
 */
export const useSchema = (schemaName: string | null | undefined) => {
  const [schemaInstance, setSchemaInstance] = useState<Schema | null>(null)
  const [schemaData, setSchemaData] = useImmer<Pick<SchemaMachineContext, 'version' | 'metadata' | '$schema'> | undefined>(undefined)
  const schemaInstanceRef = useRef<Schema | null>(null)
  const subscriptionRef = useRef<Subscription | undefined>(undefined)
  const isClientReady = useIsClientReady()

  // Set up subscription for schema data updates
  useEffect(() => {
    if (!schemaInstance) {
      setSchemaData(undefined)
      return
    }

    // Clean up previous subscription
    if (subscriptionRef.current) {
      subscriptionRef.current.unsubscribe()
      subscriptionRef.current = undefined
    }

    // Initial data update
    const updateSchemaData = () => {
      const context = schemaInstance.getService().getSnapshot().context
      setSchemaData({
        version: context.version,
        metadata: context.metadata,
        $schema: context.$schema,
      })
    }

    // Subscribe to service changes to update schemaData
    const subscription = schemaInstance.getService().subscribe((snapshot) => {
      updateSchemaData()
    })

    subscriptionRef.current = subscription
    updateSchemaData()

    // Cleanup subscription on unmount or when schema changes
    return () => {
      if (subscriptionRef.current) {
        subscriptionRef.current.unsubscribe()
        subscriptionRef.current = undefined
      }
    }
  }, [schemaInstance, setSchemaData])

  // Create/cleanup schema instance
  useEffect(() => {
    if (!isClientReady || !schemaName) {
      if (schemaInstanceRef.current) {
        schemaInstanceRef.current.unload()
        schemaInstanceRef.current = null
      }
      setSchemaInstance(null)
      return
    }

    // If we already have an instance and the name matches, keep using it
    // This prevents recreating the instance when the name changes internally
    if (schemaInstanceRef.current && schemaInstanceRef.current.schemaName === schemaName) {
      return
    }

    // Cleanup old instance if it exists
    if (schemaInstanceRef.current) {
      schemaInstanceRef.current.unload()
      schemaInstanceRef.current = null
    }

    // Create Schema instance - this will automatically load from database
    const schema = Schema.create(schemaName)
    schemaInstanceRef.current = schema
    setSchemaInstance(schema)

    // Cleanup on unmount
    return () => {
      if (schemaInstanceRef.current) {
        schemaInstanceRef.current.unload()
        schemaInstanceRef.current = null
      }
    }
  }, [schemaName, isClientReady])

  return {
    schema: schemaInstance,
    schemaData,
  }
}

export const useSchemas = (options?: { returnLatest?: boolean }) => {
  const { returnLatest = true } = options || {}
  const isClientReady = useIsClientReady()
  const [schemaInstances, setSchemaInstances] = useImmer<Schema[]>([])
  const schemaInstancesRef = useRef<Map<string, Schema>>(new Map())

  const client = getClient()
  const clientService = client.getService()

  // Get schema names from client context
  // Use a stable selector that only changes when schema names actually change
  const schemaNamesRaw = useSelector(
    clientService,
    (snapshot) => {
      // Don't process schemas until the client is ready
      if (!isClientReady) {
        return []
      }
      
      if (snapshot && snapshot.context && snapshot.context.schemas) {
        // Convert object to array of SchemaFileFormat objects
        const schemaFileArray: SchemaFileFormat[] = Object.values(snapshot.context.schemas)
        
        // Filter to latest versions if requested
        const filteredSchemas = returnLatest 
          ? filterLatestSchemas(schemaFileArray)
          : schemaFileArray
        
        // Extract schema names and create a stable sorted array
        const names = filteredSchemas
          .map((schemaFile) => schemaFile.metadata?.name)
          .filter((name): name is string => !!name)
          .sort() // Sort for stable comparison
        
        return names
      }
      return []
    },
    // Custom equality function to prevent unnecessary re-renders
    (a, b) => {
      if (a.length !== b.length) return false
      return a.every((name, index) => name === b[index])
    }
  )

  // Use useImmer to store schema names with structural sharing
  // This prevents infinite loops by only updating when values actually change
  const [schemaNames, setSchemaNames] = useImmer<string[]>([])

  // Update schema names only if they actually changed
  // Use a ref to track previous values and avoid including schemaNames in deps
  const prevSchemaNamesRef = useRef<string>('')
  
  useEffect(() => {
    // Create a stable key for comparison
    const currentKey = [...schemaNamesRaw].sort().join(',')
    
    // Only update if the key actually changed
    if (currentKey !== prevSchemaNamesRef.current) {
      prevSchemaNamesRef.current = currentKey
      setSchemaNames((draft) => {
        draft.length = 0
        draft.push(...schemaNamesRaw)
      })
    }
    // If unchanged, we don't call setSchemaNames, so Immer keeps the same reference
  }, [schemaNamesRaw, setSchemaNames])

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