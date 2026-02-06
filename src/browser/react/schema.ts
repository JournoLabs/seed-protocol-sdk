import { loadAllSchemasFromDb, } from "@/helpers/schema"
import { useCallback, useEffect, useRef, useState, useMemo } from "react"
import debug from "debug"
import { useIsClientReady } from "./client"
import { Schema } from "@/Schema/Schema"
import { SnapshotFrom, Subscription } from "xstate"
import { schemaMachine } from "@/Schema/service/schemaMachine"
import { SEED_PROTOCOL_SCHEMA_NAME } from "@/helpers/constants"
import { useLiveQuery } from "./liveQuery"
import { BaseDb } from "@/db/Db/BaseDb"
import { schemas as schemasTable } from "@/seedSchema/SchemaSchema"
import { desc } from "drizzle-orm"
import type { SchemaType as DbSchemaType } from "@/seedSchema/SchemaSchema"

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
export const useSchema = (schemaIdentifier: string | null | undefined) => {
  const [schema, setSchema] = useState<Schema | null>(null)
  const [isLoading, setIsLoading] = useState(schemaIdentifier ? true : false)
  const [error, setError] = useState<Error | null>(null)
  const subscriptionRef = useRef<Subscription | null>(null)

  const isClientReady = useIsClientReady()

  const loadSchema = useCallback((identifier: string) => {
    setIsLoading(true)
    setError(null)
    try {
      const schemaInstance = Schema.create(identifier, {
        waitForReady: false,
      }) as Schema
      setSchema(schemaInstance)

      const service = schemaInstance.getService()
      const initialSnapshot = service.getSnapshot()

      // Set initial loading state based on whether status is 'idle'
      const isIdle = initialSnapshot.value === 'idle'
      setIsLoading(!isIdle)
      if (isIdle) {
        setError(null)
      }

      // Subscribe to all status changes and update isLoading based on whether status is 'idle'
      subscriptionRef.current = service.subscribe((snapshot: SchemaSnapshot) => {
        const isIdle = snapshot.value === 'idle'
        setIsLoading(!isIdle)
        if (isIdle) {
          setError(null)
        }
      })

    } catch (error) {
      logger('[useSchema] Error creating schema:', error)
      setError(error as Error)
      setSchema(null)
      setIsLoading(false)
      return null
    }
  }, [])

  useEffect(() => {
    // Clean up previous subscription before starting a new load
    if (subscriptionRef.current) {
      subscriptionRef.current.unsubscribe()
      subscriptionRef.current = null
    }
    
    if (!isClientReady) {
      setSchema(null)
      setError(null)
      setIsLoading(false)
      return
    }
    if (!schemaIdentifier) {
      setSchema(null)
      setError(null)
      setIsLoading(false)
      return
    }

    loadSchema(schemaIdentifier)
    
    // Cleanup function to unsubscribe when effect re-runs or component unmounts
    return () => {
      if (subscriptionRef.current) {
        subscriptionRef.current.unsubscribe()
        subscriptionRef.current = null
      }
    }
  }, [schemaIdentifier, isClientReady, loadSchema])
  
  return {
    schema,
    isLoading,
    error,
  }

}

export const useSchemas = () => {
  const [schemas, setSchemas] = useState<Schema[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const isClientReady = useIsClientReady()
  const previousSchemasTableDataRef = useRef<DbSchemaType[] | undefined>(undefined)
  const schemasRef = useRef<Schema[]>([]) // Track schemas for comparison without triggering effects

  // Watch the schemas table for changes
  // Memoize the query so it's stable across renders - this is critical for distinctUntilChanged to work
  const db = isClientReady ? BaseDb.getAppDb() : null
  const schemasQuery = useMemo(() => {
    if (!db) return null
    return db.select().from(schemasTable).orderBy(schemasTable.name, desc(schemasTable.version))
  }, [db, isClientReady])
  const schemasTableData = useLiveQuery<DbSchemaType>(schemasQuery)

  const fetchSchemas = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)

      const allSchemas = await Schema.all({ waitForReady: true })

      setSchemas(allSchemas)
      schemasRef.current = allSchemas
      setIsLoading(false)
    } catch (error) {
      setError(error as Error)
      setIsLoading(false)
    }
  }, [])

  // Fetch schemas on initial mount when client is ready
  useEffect(() => {
    if (!isClientReady) {
      return
    }
    // Initial fetch when client becomes ready
    fetchSchemas()
  }, [isClientReady, fetchSchemas])

  // Refetch schemas when table data actually changes (not just reference)
  useEffect(() => {
    if (!isClientReady || !schemasTableData) {
      return
    }

    // Check if schemasTableData actually changed by comparing with previous value
    const prevData = previousSchemasTableDataRef.current
    const prevDataJson = prevData ? JSON.stringify(prevData) : 'undefined'
    const currDataJson = schemasTableData ? JSON.stringify(schemasTableData) : 'undefined'

    if (prevDataJson === currDataJson && prevData !== undefined) {
      // Data hasn't actually changed, skip refetch
      return
    }

    // Update ref with current data
    previousSchemasTableDataRef.current = schemasTableData

    // Extract identifying information from current schemas in state (using ref to avoid dependency)
    // Use schemaFileId if available, otherwise fall back to name+version
    const currentSchemasSet = new Set<string>()
    for (const schema of schemasRef.current) {
      const schemaFileId = schema.id || schema.schemaFileId
      if (schemaFileId) {
        currentSchemasSet.add(schemaFileId)
      } else {
        // Fallback to name+version if schemaFileId not available
        const name = schema.metadata?.name
        const version = schema.version
        if (name && version !== undefined) {
          currentSchemasSet.add(`${name}:${version}`)
        }
      }
    }

    // Extract identifying information from schemasTableData
    const tableDataSchemasSet = new Set<string>()
    for (const dbSchema of schemasTableData) {
      // Skip internal Seed Protocol schema for comparison (it's filtered out by Schema.all())
      if (dbSchema.name === 'Seed Protocol') {
        continue
      }
      if (dbSchema.schemaFileId) {
        tableDataSchemasSet.add(dbSchema.schemaFileId)
      } else {
        // Fallback to name+version if schemaFileId not available
        if (dbSchema.name && dbSchema.version !== undefined) {
          tableDataSchemasSet.add(`${dbSchema.name}:${dbSchema.version}`)
        }
      }
    }

    // Compare sets to detect changes
    const setsAreEqual = 
      currentSchemasSet.size === tableDataSchemasSet.size &&
      [...currentSchemasSet].every(id => tableDataSchemasSet.has(id))

    if (setsAreEqual) {
      // Schemas in state match table data, skip refetch
      return
    }

    // Schemas have changed, fetch updated schemas
    fetchSchemas()
  }, [isClientReady, schemasTableData, fetchSchemas])

  return {
    schemas,
    isLoading,
    error,
  }

}

export const useCreateSchema = () => {
  const subscriptionRef = useRef<{ unsubscribe: () => void } | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const resetError = useCallback(() => setError(null), [])

  const createSchema = useCallback((schemaName: string) => {
    setError(null)
    setIsLoading(true)
    subscriptionRef.current?.unsubscribe()
    subscriptionRef.current = null
    const schema = Schema.create(schemaName, {
      waitForReady: false,
    }) as Schema
    const subscription = schema.getService().subscribe((snapshot: SchemaSnapshot) => {
      if (snapshot.value === 'error') {
        const err = snapshot.context._loadingError?.error
        setError(err instanceof Error ? err : new Error('Failed to create schema'))
        setIsLoading(false)
      }
      if (snapshot.value === 'idle') {
        setError(null)
        setIsLoading(false)
      }
    })
    subscriptionRef.current = subscription
    return schema
  }, [])

  useEffect(() => {
    return () => {
      subscriptionRef.current?.unsubscribe()
      subscriptionRef.current = null
    }
  }, [])

  return {
    createSchema,
    isLoading,
    error,
    resetError,
  }
}

export type UseDestroySchemaReturn = {
  destroy: (schema: Schema) => Promise<void>
  isLoading: boolean
  error: Error | null
  resetError: () => void
}

export const useDestroySchema = (): UseDestroySchemaReturn => {
  const [currentInstance, setCurrentInstance] = useState<Schema | null>(null)
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

  const destroy = useCallback(async (schema: Schema) => {
    if (!schema) return
    setCurrentInstance(schema)
    await schema.destroy()
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
          const schema = Schema.create(schemaName, {
            waitForReady: false,
          }) as Schema
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
  return useSchema(SEED_PROTOCOL_SCHEMA_NAME)
}