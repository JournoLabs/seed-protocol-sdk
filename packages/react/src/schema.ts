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
import { desc, eq, or } from "drizzle-orm"
import type { SchemaType as DbSchemaType } from '@seedprotocol/sdk'
import { useQuery } from "@tanstack/react-query"
import { useSeedQueryClient } from "./queryClient"
import { useCreateState } from "./useCreateState"
import { useHeldEntities } from "./useHeldEntities"

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
  const isClientReady = useIsClientReady()

  // Each load takes a hold on the instance it shows (Schema.create with hold); its cleanup releases it.
  const loadSchema = useCallback(async (identifier: string, load: SchemaLoad) => {
    setIsLoading(true)
    setError(null)
    try {
      // Look the schema up only: Schema.create would add a draft schema for a name that doesn't
      // exist (e.g. a typo), so check the schemas table first.
      if (!(await schemaExists(identifier))) {
        if (!load.current) return
        setSchema(null)
        setIsLoading(false)
        return
      }
      if (!load.current) return
      const schemaInstance = Schema.create(identifier, {
        waitForReady: false,
        hold: true,
      }) as Schema
      load.instance = schemaInstance
      setSchema(schemaInstance)

      const service = schemaInstance.getService()
      // The schema's status changes reach its actor's subscribers (Schema status is mirrored there)
      const apply = (snapshot: SchemaSnapshot) => {
        if (schemaInstance.status === 'ready') {
          flushSync(() => setIsLoading(false))
          setError(null)
        } else if (schemaInstance.status === 'error') {
          // A failed load used to report isLoading: true, error: null forever.
          const err = snapshot.context._loadingError?.error
          setIsLoading(false)
          setError(err instanceof Error ? err : new Error(`Failed to load schema "${identifier}"`))
        } else {
          setIsLoading(true)
        }
      }
      apply(service.getSnapshot())
      load.subscription = service.subscribe(apply)
    } catch (error) {
      logger('[useSchema] Error creating schema:', error)
      if (!load.current) return
      setError(error as Error)
      setSchema(null)
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
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

    const load: SchemaLoad = { current: true, instance: null, subscription: null }
    void loadSchema(schemaIdentifier, load)

    // On unmount or identifier change: stop following the instance and release this load's hold.
    return () => {
      load.current = false
      load.subscription?.unsubscribe()
      load.subscription = null
      load.instance?.unload()
      load.instance = null
    }
  }, [schemaIdentifier, isClientReady, loadSchema])
  
  return {
    schema,
    isLoading,
    error,
  }

}

type SchemaLoad = {
  current: boolean
  instance: Schema | null
  subscription: Subscription | null
}

/** Whether a schema with this name or schema file id is stored (or is the built-in one). */
async function schemaExists(identifier: string): Promise<boolean> {
  if (identifier === SEED_PROTOCOL_SCHEMA_NAME) return true
  const db = BaseDb.getAppDb()
  if (!db) return true // can't tell yet: let Schema.create resolve it
  const rows = await db
    .select({ id: schemasTable.id })
    .from(schemasTable)
    .where(or(eq(schemasTable.name, identifier), eq(schemasTable.schemaFileId, identifier)))
    .limit(1)
  return rows.length > 0
}

const SEED_SCHEMAS_QUERY_KEY = ['seed', 'schemas'] as const
const NO_SCHEMAS: Schema[] = []
/** Schema.retain, stable for useHeldEntities. */
const retainSchema = (schema: Schema) => Schema.retain(schema)

export const useSchemas = () => {
  const isClientReady = useIsClientReady()
  const queryClient = useSeedQueryClient()
  const previousSchemasTableDataRef = useRef<DbSchemaType[] | undefined>(undefined)
  const schemasRef = useRef<Schema[]>([])

  const {
    data: schemas = NO_SCHEMAS,
    isLoading,
    error: queryError,
  } = useQuery({
    queryKey: SEED_SCHEMAS_QUERY_KEY,
    queryFn: () => Schema.all({ waitForReady: true }),
    enabled: isClientReady,
  }, queryClient)
  schemasRef.current = schemas

  // One hold per mounted hook on each schema it lists. A schema that can't be held, or stops while
  // listed (destroyed, evicted, client stop), is listed again.
  const refetch = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: SEED_SCHEMAS_QUERY_KEY })
  }, [queryClient])
  useHeldEntities(schemas, retainSchema, refetch)

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
      if (schema.metadata?.name === SEED_PROTOCOL_SCHEMA_NAME) continue
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

    // A listed schema whose rows are gone was deleted (Schema.destroy): refetch so it leaves.
    const tableLostRows = [...currentSchemasSet].some((id) => !tableDataSchemasSet.has(id))

    if (!setsAreEqual && (tableHasNewRows || tableLostRows)) {
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
  const { run, isLoading, error, resetError } = useCreateState('Failed to create schema')

  const createSchema = useCallback(
    (schemaName: string) =>
      run(() => Schema.create(schemaName, { waitForReady: false }) as Schema),
    [run],
  )

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
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  // Loading state is tracked here: the schema's service doesn't record destroy progress, and
  // destroy() stops the service, often within a few microtasks.
  const destroy = useCallback(async (schema: Schema) => {
    if (!schema) return
    setError(null)
    setIsLoading(true)
    try {
      await schema.destroy()
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

/**
 * One Schema instance per stored schema name, each at its latest version (despite the name, not
 * one per version). Instances are released on unmount; ones other hooks also use keep running.
 */
export const useAllSchemaVersions = () => {
  const [schemaInstances, setSchemaInstances] = useState<Schema[] | undefined | null>()
  const schemaInstancesRef = useRef<Map<string, Schema>>(new Map())
  const isClientReady = useIsClientReady()

  const fetchSchemas = useCallback(async () => {
    if (!isClientReady) {
      return
    }

    try {
      // One entry per schema row (reads only; init applies schema files)
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
          // Held until it leaves the list or the hook unmounts (below)
          const schema = Schema.create(schemaName, {
            waitForReady: false,
            hold: true,
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