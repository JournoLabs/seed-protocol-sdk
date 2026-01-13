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
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const subscriptionRef = useRef<Subscription | null>(null)

  const isClientReady = useIsClientReady()

  console.log('[useSchema] isLoading:', isLoading)

  

  const loadSchema = useCallback((identifier: string) => {
    console.log(`[useSchema] loadSchema setting isLoading to true for schema: ${identifier}`)
    setIsLoading(true)
    setError(null)
    try {
      const schemaInstance = Schema.create(identifier)
      setSchema(schemaInstance)

      const service = schemaInstance.getService()
      const initialSnapshot = service.getSnapshot()

      if (initialSnapshot.value === 'idle') {
        console.log(`[useSchema] loadSchema setting isLoading to false for schema: ${identifier}`)
        setIsLoading(false)
        setError(null)
        return
      }

      subscriptionRef.current = service.subscribe((snapshot: SchemaSnapshot) => {
        if (snapshot.value === 'idle') {
          console.log(`[useSchema] loadSchema setting isLoading to false for schema: ${identifier}`)
          setIsLoading(false)
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
    console.log('[useSchema] useEffect', schemaIdentifier)
    
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
      const timestamp = Date.now()
      console.log(`[useSchemas.fetchSchemas] [${timestamp}] Starting fetch, schemasTableData count:`, schemasTableData?.length, 'schemas:', schemasTableData?.map(s => s.name))
      
      // Also check what's in the database directly before calling Schema.all()
      const db = BaseDb.getAppDb()
      if (db) {
        const directCheck = await db.select().from(schemasTable).orderBy(schemasTable.name, desc(schemasTable.version))
        console.log(`[useSchemas.fetchSchemas] [${timestamp}] Direct DB query before Schema.all():`, directCheck.length, 'schemas:', directCheck.map((s: any) => s.name))
      }
      
      const allSchemas = await Schema.all()
      console.log(`[useSchemas.fetchSchemas] [${timestamp}] Schema.all() returned:`, allSchemas.length, 'schemas:', allSchemas.map((s: any) => s.metadata?.name))
      
      setSchemas(prev => {
        // Check if anything actually changed
        if (prev.length !== allSchemas.length) {
          console.log('[useSchemas] Length changed:', prev.length, '->', allSchemas.length)
          return allSchemas
        }
        
        // Compare by some stable identifier
        const hasChanged = allSchemas.some((schema, i) => 
          !prev[i] || 
          schema.id !== prev[i].id || 
          schema.metadata?.updatedAt !== prev[i].metadata?.updatedAt
        )
        
        if (hasChanged) {
          console.log('[useSchemas] Schemas changed (by ID or updatedAt)')
        } else {
          console.log('[useSchemas] No changes detected')
        }
        return hasChanged ? allSchemas : prev
      })
      setError(null)
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

    // Extract identifying information from current schemas in state
    // Use schemaFileId if available, otherwise fall back to name+version
    const currentSchemasSet = new Set<string>()
    for (const schema of schemas) {
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

    // Schemas have changed - log for debugging
    console.log('[useSchemas] schemasTableData changed:', {
      currentCount: currentSchemasSet.size,
      tableDataCount: tableDataSchemasSet.size,
      currentIds: Array.from(currentSchemasSet),
      tableDataIds: Array.from(tableDataSchemasSet),
      tableDataNames: schemasTableData.map(s => s.name),
      tableDataFull: schemasTableData.map(s => ({ name: s.name, schemaFileId: s.schemaFileId, version: s.version, id: s.id })),
    })

    // Schemas have changed, fetch updated schemas
    fetchSchemas()
  }, [isClientReady, schemasTableData, schemas, fetchSchemas])

  return {
    schemas,
    isLoading,
    error,
  }

}

export const useCreateSchema = () => {
  const errorRef = useRef<Error | null>(null)
  const subscriptionRef = useRef<{ unsubscribe: () => void } | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const createSchema = useCallback((schemaName: string) => {
    setIsLoading(true)
    const schema = Schema.create(schemaName)
    const subscription = schema.getService().subscribe((snapshot: SchemaSnapshot) => {
      if (snapshot.value === 'error') {
        errorRef.current = new Error('Failed to create schema')
      }
      if (snapshot.value === 'idle') {
        setIsLoading(false)
      }
    })
    subscriptionRef.current = subscription
    return schema
  }, [setIsLoading])

  useEffect(() => {
    setError(errorRef.current)
  }, [errorRef.current])

  return {
    createSchema,
    isLoading,
    error,
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
  return useSchema(SEED_PROTOCOL_SCHEMA_NAME)
}