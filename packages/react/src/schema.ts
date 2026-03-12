import { loadAllSchemasFromDb } from '@seedprotocol/sdk'
import { useCallback, useEffect, useRef, useState, useMemo } from "react"
import { flushSync } from "react-dom"
import debug from "debug"
import { useIsClientReady } from "./client"
import { Schema } from '@seedprotocol/sdk'
import { SnapshotFrom, Subscription } from "xstate"
import { schemaMachine, SEED_PROTOCOL_SCHEMA_NAME } from '@seedprotocol/sdk'
import { useLiveQuery } from "./liveQuery"
import { BaseDb, schemas as schemasTable } from '@seedprotocol/sdk'
import { desc } from "drizzle-orm"
import type { SchemaType as DbSchemaType } from '@seedprotocol/sdk'
import { useQuery, useQueryClient } from "@tanstack/react-query"

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
      if (isIdle) {
        flushSync(() => setIsLoading(false))
        setError(null)
      } else {
        setIsLoading(true)
      }

      // Subscribe to all status changes and update isLoading based on whether status is 'idle'
      subscriptionRef.current = service.subscribe((snapshot: SchemaSnapshot) => {
        const isIdle = snapshot.value === 'idle'
        if (isIdle) {
          flushSync(() => setIsLoading(false))
          setError(null)
        } else {
          setIsLoading(true)
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

const SEED_SCHEMAS_QUERY_KEY = ['seed', 'schemas'] as const

export const useSchemas = () => {
  const isClientReady = useIsClientReady()
  const queryClient = useQueryClient()
  const previousSchemasTableDataRef = useRef<DbSchemaType[] | undefined>(undefined)
  const schemasRef = useRef<Schema[]>([])

  const {
    data: schemas = [],
    isLoading,
    error: queryError,
  } = useQuery({
    queryKey: SEED_SCHEMAS_QUERY_KEY,
    queryFn: () => Schema.all({ waitForReady: true }),
    enabled: isClientReady,
  })
  schemasRef.current = schemas

  // Watch the schemas table for changes and invalidate so useQuery refetches
  const db = isClientReady ? BaseDb.getAppDb() : null
  const schemasQuery = useMemo(() => {
    if (!db) return null
    return db.select().from(schemasTable).orderBy(schemasTable.name, desc(schemasTable.version))
  }, [db, isClientReady])
  const schemasTableData = useLiveQuery<DbSchemaType>(schemasQuery)

  // When a schema is created, addSchemaToDb posts to this channel; live query often doesn't re-run when schemas table is inserted.
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return
    const ch = new BroadcastChannel('seed-schemas-invalidate')
    const onMessage = () => {
      queryClient.invalidateQueries({ queryKey: SEED_SCHEMAS_QUERY_KEY })
    }
    ch.addEventListener('message', onMessage)
    return () => {
      ch.removeEventListener('message', onMessage)
      ch.close()
    }
  }, [queryClient])

  useEffect(() => {
    if (!isClientReady || !schemasTableData) {
      return
    }

    const prevData = previousSchemasTableDataRef.current
    const prevDataJson = prevData ? JSON.stringify(prevData) : 'undefined'
    const currDataJson = schemasTableData ? JSON.stringify(schemasTableData) : 'undefined'

    if (prevDataJson === currDataJson && prevData !== undefined) {
      return
    }

    previousSchemasTableDataRef.current = schemasTableData

    const currentSchemasSet = new Set<string>()
    for (const schema of schemasRef.current) {
      const schemaFileId = schema.id || schema.schemaFileId
      if (schemaFileId) {
        currentSchemasSet.add(schemaFileId)
      } else {
        const name = schema.metadata?.name
        const version = schema.version
        if (name && version !== undefined) {
          currentSchemasSet.add(`${name}:${version}`)
        }
      }
    }

    const tableDataSchemasSet = new Set<string>()
    for (const dbSchema of schemasTableData) {
      if (dbSchema.name === 'Seed Protocol') continue
      if (dbSchema.schemaFileId) {
        tableDataSchemasSet.add(dbSchema.schemaFileId)
      } else if (dbSchema.name != null && dbSchema.version !== undefined) {
        tableDataSchemasSet.add(`${dbSchema.name}:${dbSchema.version}`)
      }
    }

    const setsAreEqual =
      currentSchemasSet.size === tableDataSchemasSet.size &&
      [...currentSchemasSet].every((id) => tableDataSchemasSet.has(id))

    // Only invalidate when we have data and the table has rows we might be missing (live query saw new data).
    // Skip during initial load (currentSchemasSet empty) to avoid disrupting loading state.
    // Do NOT invalidate when we have more than the table: the live query may not have updated
    // yet, and refetching could overwrite cache with stale/empty data.
    const tableHasNewRows =
      currentSchemasSet.size > 0 &&
      tableDataSchemasSet.size > 0 &&
      [...tableDataSchemasSet].some((id) => !currentSchemasSet.has(id))

    if (!setsAreEqual && tableHasNewRows) {
      queryClient.invalidateQueries({ queryKey: SEED_SCHEMAS_QUERY_KEY })
    }
  }, [isClientReady, schemasTableData, queryClient])

  return {
    schemas,
    isLoading,
    error: queryError as Error | null,
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