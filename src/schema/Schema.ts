import { ActorRefFrom, createActor, SnapshotFrom } from 'xstate'
import { schemaMachine, SchemaMachineContext } from './service/schemaMachine'
import { listCompleteSchemaFiles, listLatestSchemaFiles, loadAllSchemasFromDb } from '@/helpers/schema'
import { updateModelProperties, convertPropertyToSchemaUpdate } from '@/helpers/updateSchema'
import { ModelProperty } from '@/ModelProperty/ModelProperty'
import { Model } from '@/Model/Model'
import { SchemaFileFormat } from '@/types/import'
import { BaseDb } from '@/db/Db/BaseDb'
import { schemas as schemasTable } from '@/seedSchema/SchemaSchema'
import { eq, desc, and } from 'drizzle-orm'
import { createReactiveProxy } from '@/helpers/reactiveProxy'
import { ConflictError, ConflictResult } from '@/Schema/errors'
import { isInternalSchema } from '@/helpers/constants'
import { waitForEntityIdle } from '@/helpers/waitForEntityIdle'
import { findEntity } from '@/helpers/entity/entityFind'
import { setupEntityLiveQuery } from '@/helpers/entity/entityLiveQuery'
import { unloadEntity } from '@/helpers/entity/entityUnload'
import debug from 'debug'

const logger = debug('seedSdk:schema:saveNewVersion')
const saveDraftLogger = debug('seedSdk:schema:saveDraftToDb')

type SchemaService = ActorRefFrom<typeof schemaMachine>
type SchemaSnapshot = SnapshotFrom<typeof schemaMachine>

// WeakMap to store non-serializable resources per Schema instance
// Only stores resources that cannot be serialized (subscriptions, timers, etc.)
const schemaInstanceState = new WeakMap<Schema, {
  liveQuerySubscription: { unsubscribe: () => void } | null // LiveQuery subscription for cross-instance model updates
}>()

// Cache client initialization state globally to avoid repeated checks
let cachedClientInitialized: boolean | null = null
let clientCheckTime: number = 0
const CLIENT_CHECK_CACHE_MS = 50 // Cache for 50ms to avoid excessive checks (reduced from 100ms for faster updates)

// Define tracked properties for the Proxy
// These properties will be read from/written to the actor context
const TRACKED_PROPERTIES = [
  'id', // schemaFileId (string) - public ID
  '$schema',
  'version',
  'metadata',
  'enums',
  'migrations',
  'name',        // metadata.name (flattened)
  'createdAt',   // metadata.createdAt (flattened)
  'updatedAt',   // metadata.updatedAt (flattened)
] as const

/**
 * Options for Schema.all() method
 */
export interface SchemaAllOptions {
  /**
   * If true, returns all versions of each schema. If false (default), returns only the latest version of each schema.
   * @default false
   */
  includeAllVersions?: boolean
  /**
   * If true, includes the internal Seed Protocol schema. If false (default), excludes it.
   * @default false
   */
  includeInternal?: boolean
}

export class Schema {
  // Cache by schemaFileId (primary key - doesn't change when name changes)
  protected static instanceCacheById: Map<
    string,
    { instance: Schema; refCount: number }
  > = new Map()
  // Temporary cache by schemaName (used until schemaFileId is available)
  protected static instanceCacheByName: Map<
    string,
    { instance: Schema; refCount: number }
  > = new Map()
  // Track which schemas are currently being saved to prevent concurrent saves
  protected static savingSchemas: Set<string> = new Set()
  protected readonly _service: SchemaService

  $schema?: string
  version?: number
  metadata?: {
    name: string
    createdAt: string
    updatedAt: string
  }
  models?: Model[]
  enums?: {
    [enumName: string]: any
  }
  migrations?: Array<{
    version: number
    timestamp: string
    description: string
    changes: any[]
  }>

  constructor(schemaName: string) {
    const serviceInput: Pick<SchemaMachineContext, 'schemaName'> = {
      schemaName,
    }

    this._service = createActor(schemaMachine as any, {
      input: serviceInput,
    }) as SchemaService

    this._service.start()

    console.log('started Schema service for schema:', schemaName)

    // Initialize instance state in WeakMap (only non-serializable resources)
    schemaInstanceState.set(this, {
      liveQuerySubscription: null,
    })
    
    // Set up liveQuery subscription for cross-instance model updates
    // This will be initialized once we have the schemaId
    this._setupLiveQuerySubscription()

    // Subscribe to schema context changes to update cache keys when schemaFileId becomes available
    this._service.subscribe((snapshot) => {
      console.log('Schema service subscribed to snapshot', snapshot.value)
      // Update cache to use id (schemaFileId) as key once we have it (only once)
      if (snapshot.value === 'idle' && snapshot.context.metadata?.name && snapshot.context.id) {
        // Use a static Set to track which schemas have had their cache key updated
        const cacheKeyUpdatedSet = (Schema as any)._cacheKeyUpdatedSet || new Set<string>()
        if (!(Schema as any)._cacheKeyUpdatedSet) {
          (Schema as any)._cacheKeyUpdatedSet = cacheKeyUpdatedSet
        }
        if (!cacheKeyUpdatedSet.has(snapshot.context.id)) {
          Schema._updateCacheKey(snapshot.context.schemaName, snapshot.context.id)
          cacheKeyUpdatedSet.add(snapshot.context.id)
        }
      }
    })

    // Note: Property getters/setters are now handled by the Proxy in create()
  }

  static create(schemaName: string): Schema {
    if (!schemaName) {
      throw new Error('Schema name is required')
    }

    // First, check if we have an instance cached by name
    if (this.instanceCacheByName.has(schemaName)) {
      const { instance, refCount } = this.instanceCacheByName.get(schemaName)!
      this.instanceCacheByName.set(schemaName, {
        instance,
        refCount: refCount + 1,
      })
      return instance
    }

    // Create new instance
    const newInstance = new this(schemaName)
    
    // Wrap instance in Proxy for reactive property access
    const proxiedInstance = createReactiveProxy<Schema>({
      instance: newInstance,
      service: newInstance._service as any,
      trackedProperties: TRACKED_PROPERTIES,
      getContext: (instance) => {
        // Handle special cases like metadata.name, models array conversion
        const context = instance._getSnapshotContext()
        
        // Get the schema name, ensuring it's never the ID
        // Prefer metadata.name, then schemaName (but only if it's not the ID)
        const schemaFileId = context.id // id is now the schemaFileId (string)
        let name = context.metadata?.name
        
        // If metadata.name is not available, use schemaName but only if it's not the ID
        // This prevents returning the ID when the schema is still loading
        if (!name) {
          name = (context.schemaName && context.schemaName !== schemaFileId) 
            ? context.schemaName 
            : undefined
        }
        
        // Final fallback - if we still don't have a name, use schemaName (even if it might be the ID)
        // This handles edge cases during loading
        if (!name) {
          name = context.schemaName
        }
        
        // CRITICAL: Always create a new metadata object to ensure React detects changes
        // Even if the metadata content is the same, we need a new reference so React re-renders
        const metadata = context.metadata ? {
          ...context.metadata,
        } : undefined
        
        return {
          ...context,
          // Always return a new metadata object reference so React detects changes
          metadata,
          // Flatten metadata properties to top level for convenience
          // Fall back to schemaName if metadata.name is not available (handles loading states)
          name,
          createdAt: context.metadata?.createdAt,
          updatedAt: context.metadata?.updatedAt,
        }
      },
      sendUpdate: (instance, prop: string, value: any) => {
        // Handle special property updates
        if (prop === 'name') {
          // Update both metadata.name and schemaName
          const context = instance._getSnapshotContext()
          const currentMetadata = context.metadata || {
            name: schemaName,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }
          const oldName = currentMetadata.name || context.schemaName
          const newName = value as string
          
          // Only update if the name actually changed
          if (oldName !== newName) {
            logger(`Updating schema name from "${oldName}" to "${newName}"`)
            
            // Check if service is still running before sending events
            let snapshot = instance._service.getSnapshot()
            const wasServiceStopped = snapshot.status === 'stopped'
            
            if (wasServiceStopped) {
              // CRITICAL: Update the schemaName in the service context BEFORE restarting
              // This ensures that when loadOrCreateSchema runs, it looks for the schema with the NEW name
              // We need to do this by sending updateContext to a running service, but if it's stopped,
              // we need to restart it first, update, then it will reload with the new name
              logger(`Service is stopped, will update schemaName to "${newName}" then restart`)
              
              // Start the service first
              instance._service.start()
              
              // Immediately update the schemaName so loadOrCreateSchema uses the new name
              // This must happen before loadOrCreateSchema runs
              instance._service.send({
                type: 'updateContext',
                schemaName: newName,
              })
              
              logger(`Updated schemaName to "${newName}" before loadOrCreateSchema runs`)
              
              // Re-check snapshot after restart - service might be loading or already idle
              snapshot = instance._service.getSnapshot()
            }
            
            // Build the update event with the new name
            const updateEvent = {
              type: 'updateContext' as const,
              schemaName: newName,
              metadata: {
                ...(currentMetadata || {
                  name: newName,
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                }),
                name: newName, // Always use the new name
                updatedAt: new Date().toISOString(), // Always update timestamp
              },
            }
            
            // Check current state after potential restart
            const currentState = snapshot.value
            const isServiceLoading = currentState === 'loading'
            
            // If service is loading (or was just restarted and might be loading), wait for it to finish
            // Otherwise loadOrCreateSchemaSuccess might overwrite our update with old data
            if (isServiceLoading || wasServiceStopped) {
              logger(`Service is ${isServiceLoading ? 'loading' : 'was stopped'}, will send updateContext after loading completes (current state: ${currentState})`)
              
              // Helper function to send the update
              const sendUpdate = () => {
                logger(`Sending updateContext with newName="${newName}"`)
                instance._service.send(updateEvent)
                
                // Verify the update
                setTimeout(() => {
                  const verifySnapshot = instance._service.getSnapshot()
                  logger(`After updateContext: context schemaName="${verifySnapshot.context.schemaName}", metadata.name="${verifySnapshot.context.metadata?.name}"`)
                }, 0)
              }
              
              // Check if already idle (might have loaded synchronously)
              if (currentState === 'idle') {
                // Service is already idle, but loadOrCreateSchemaSuccess might have just fired
                // Use a small delay to ensure loadOrCreateSchemaSuccess has been processed
                logger(`Service is already idle after restart, will send updateContext after brief delay to ensure loadOrCreateSchemaSuccess processed`)
                setTimeout(() => {
                  sendUpdate()
                }, 10)
              } else {
                // Subscribe to wait for loading to complete, then send the update
                // Use a small delay after idle to ensure loadOrCreateSchemaSuccess has been processed
                const loadingSubscription = instance._service.subscribe((snapshot) => {
                  if (snapshot.value === 'idle') {
                    loadingSubscription.unsubscribe()
                    logger(`Service finished loading, will send updateContext with newName="${newName}" after brief delay`)
                    setTimeout(() => {
                      sendUpdate()
                    }, 10)
                  } else if (snapshot.value === 'error') {
                    loadingSubscription.unsubscribe()
                    logger(`Service failed to load, cannot update context`)
                  }
                })
              }
            } else {
              // Service is already idle, send update immediately
              logger(`Service is already idle, sending updateContext immediately: newName="${newName}", current context schemaName="${snapshot.context.schemaName}"`)
              instance._service.send(updateEvent)
              
              // Verify the update
              setTimeout(() => {
                const verifySnapshot = instance._service.getSnapshot()
                logger(`After updateContext: context schemaName="${verifySnapshot.context.schemaName}", metadata.name="${verifySnapshot.context.metadata?.name}"`)
              }, 0)
            }
            
            // Mark schema as draft when name changes
            instance._service.send({
              type: 'markAsDraft',
              propertyKey: 'schema:name', // Special key for schema name changes
            })
            
            // Save draft to database immediately so changes persist
            saveDraftLogger(`Name change detected, calling _saveDraftToDb (oldName: "${oldName}", newName: "${newName}")`)
            instance._saveDraftToDb(oldName, newName).catch((error) => {
              saveDraftLogger(`ERROR: Failed to save draft after name change: ${error instanceof Error ? error.message : String(error)}`)
              logger(`Failed to save draft to database: ${error instanceof Error ? error.message : String(error)}`)
            })
          } else {
            logger(`Schema name unchanged: "${oldName}"`)
          }
        } else if (prop === 'models') {
          // Models are read-only computed values from Model instances
          // Cannot be set directly - models are managed via Model instances
          throw new Error('Cannot set schema.models directly. Models are computed from Model instances.')
          // DISABLED: Array assignment to schema.models is temporarily disabled
          // 
          // REASON: This approach had race condition issues where _saveDraftToDb() would run
          // before Model instances were fully created, causing models to not be saved to the database.
          // 
          // NEW APPROACH: Use Model.create() instead:
          //   const model = Model.create('ModelName', schemaInstance, {
          //     properties: {...},
          //     description: '...'
          //   })
          // 
          // This ensures:
          //   1. Model instance is created first with its _modelFileId
          //   2. Model automatically registers with the schema
          //   3. Schema saves to database with complete model data
          //   4. No race conditions between model creation and schema persistence
          //
          // TODO: Re-enable this if we can fix the race condition, or if we need backward compatibility
          
          throw new Error(
            'Direct assignment to schema.models is disabled. ' +
            'Please use Model.create() instead: ' +
            'const model = Model.create("ModelName", schemaInstance, { properties: {...}, description: "..." })'
          )
          
          /* DISABLED CODE - See comment above
          // Convert array of Model instances or plain objects back to object format
          let modelsObject: { [key: string]: any }
          if (Array.isArray(value)) {
            modelsObject = {}
            const seenNames = new Set<string>()
            
            // Check for duplicate model names
            for (const model of value) {
              // Handle Model instances
              if (model instanceof Model) {
                const modelName = model.modelName!
                if (seenNames.has(modelName)) {
                  throw new Error(
                    `Duplicate model name detected: "${modelName}". Each model must have a unique name.`
                  )
                }
                seenNames.add(modelName)
                modelsObject[modelName] = {
                  properties: model.properties || {},
                }
              } else if (model && typeof model === 'object' && 'name' in model) {
                // Handle plain objects
                const modelName = model.name as string
                if (seenNames.has(modelName)) {
                  throw new Error(
                    `Duplicate model name detected: "${modelName}". Each model must have a unique name.`
                  )
                }
                seenNames.add(modelName)
                const { name, ...modelData } = model
                modelsObject[name] = modelData
              }
            }
          } else {
            modelsObject = value || {}
            // Check for duplicates in object format too
            const modelNames = Object.keys(modelsObject)
            const seenNames = new Set<string>()
            for (const modelName of modelNames) {
              if (seenNames.has(modelName)) {
                throw new Error(
                  `Duplicate model name detected: "${modelName}". Each model must have a unique name.`
                )
              }
              seenNames.add(modelName)
            }
          }
          
          const context = newInstance._getSnapshotContext()
          
          // Check if service is still running before sending events
          let snapshot = newInstance._service.getSnapshot()
          const wasServiceStopped = snapshot.status === 'stopped'
          
          if (wasServiceStopped) {
            logger(`Service is stopped, will restart before adding models`)
            newInstance._service.start()
            snapshot = newInstance._service.getSnapshot()
          }
          
          // Check current state after potential restart
          const currentState = snapshot.value
          const isServiceLoading = currentState === 'loading'
          
          // If service is loading, wait for it to finish before adding models
          if (isServiceLoading || wasServiceStopped) {
            logger(`Service is ${isServiceLoading ? 'loading' : 'was stopped'}, will add models after loading completes`)
            
            const loadingSubscription = newInstance._service.subscribe((snapshot) => {
              if (snapshot.value === 'idle') {
                loadingSubscription.unsubscribe()
                logger(`Service finished loading, sending addModels event`)
                newInstance._service.send({
                  type: 'addModels',
                  models: modelsObject,
                })
              } else if (snapshot.value === 'error') {
                loadingSubscription.unsubscribe()
                logger(`Service failed to load, cannot add models`)
              }
            })
          } else {
            // Service is ready, send addModels event immediately
            // The state machine will handle all the complexity (validation, instance creation, ID collection, persistence)
            logger(`Service is ready, sending addModels event`)
            newInstance._service.send({
              type: 'addModels',
              models: modelsObject,
            })
          }
          
          // Mark schema as draft when models change
          newInstance._service.send({
            type: 'markAsDraft',
            propertyKey: 'schema:models',
          })
          
          // Save draft to database immediately so changes persist
          newInstance._saveDraftToDb().catch((error) => {
            logger(`Failed to save draft to database: ${error instanceof Error ? error.message : String(error)}`)
          })
          
          // Update client context so useSchema and useSchemas hooks reflect the change
          newInstance._updateClientContext().catch(() => {
            // Silently fail if not in browser environment
          })
          */
        } else if (prop === 'createdAt' || prop === 'updatedAt') {
          // Update metadata object
          const metadataContext = newInstance._getSnapshotContext()
          const currentMetadata = metadataContext.metadata || {
            name: schemaName,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }
          newInstance._service.send({
            type: 'updateContext',
            metadata: {
              ...currentMetadata,
              [prop]: value,
              updatedAt: new Date().toISOString(),
            },
          })
        } else {
          // Standard property update
          newInstance._service.send({
            type: 'updateContext',
            [prop]: value,
          })
          
          // Mark schema as draft for other property changes
          newInstance._service.send({
            type: 'markAsDraft',
            propertyKey: prop,
          })
          
          // Save draft to database for tracked properties
          if (TRACKED_PROPERTIES.includes(prop as any)) {
            const trackedPropContext = newInstance._getSnapshotContext()
            const schemaName = trackedPropContext.metadata?.name || trackedPropContext.schemaName
            newInstance._saveDraftToDb(schemaName, schemaName).catch((error) => {
              logger(`Failed to save draft to database: ${error instanceof Error ? error.message : String(error)}`)
            })
          }
        }
      },
    })
    
    // Cache by name initially (will be moved to id-based cache once schemaFileId is available)
    this.instanceCacheByName.set(schemaName, {
      instance: proxiedInstance,
      refCount: 1,
    })
    // The proxiedInstance is Proxied<Schema> which preserves all methods
    // TypeScript recognizes this as Schema with all methods intact
    return proxiedInstance as Schema
  }

  /**
   * Update the cache to use schemaFileId as the key instead of schemaName
   * This should be called once the schema is loaded and we have the schemaFileId
   * We keep the instance in BOTH caches for efficient lookups by either name or ID
   */
  private static _updateCacheKey(schemaName: string, schemaFileId: string): void {
    // If we already have an entry with this id, skip (already processed)
    if (this.instanceCacheById.has(schemaFileId)) {
      return
    }
    
    // If we have an instance cached by name, also add it to id-based cache
    // Keep it in both caches for efficient lookups
    if (this.instanceCacheByName.has(schemaName)) {
      const cacheEntry = this.instanceCacheByName.get(schemaName)!
      // Add to ID cache (don't remove from name cache)
      this.instanceCacheById.set(schemaFileId, {
        instance: cacheEntry.instance,
        refCount: cacheEntry.refCount, // Use same refCount
      })
      logger(`Added schema cache entry to id "${schemaFileId}" (kept in name cache: "${schemaName}")`)
    }
  }

  /**
   * Get schema instance by schemaFileId (preferred method)
   * Returns null if not found in cache
   */
  static getById(schemaFileId: string): Schema | null {
    if (this.instanceCacheById.has(schemaFileId)) {
      const { instance, refCount } = this.instanceCacheById.get(schemaFileId)!
      this.instanceCacheById.set(schemaFileId, {
        instance,
        refCount: refCount + 1,
      })
      return instance
    }
    return null
  }

  /**
   * Clear all cached Schema instances.
   * This is primarily useful for test cleanup.
   * All cached instances will be unloaded and removed from both caches.
   */
  static clearCache(): void {
    // Collect all unique instances from both caches
    const instances = new Set<Schema>()
    
    // Collect from ID-based cache
    for (const { instance } of this.instanceCacheById.values()) {
      instances.add(instance)
    }
    
    // Collect from name-based cache
    for (const { instance } of this.instanceCacheByName.values()) {
      instances.add(instance)
    }
    
    // Unload all instances (this will properly clean up services and state)
    for (const instance of instances) {
      try {
        instance.unload()
      } catch (error) {
        // Ignore errors during cleanup (instance might already be unloaded)
      }
    }
    
    // Clear both caches explicitly
    this.instanceCacheById.clear()
    this.instanceCacheByName.clear()
  }

  /**
   * Create or get schema instance by schemaFileId
   * Queries the database to find the schema name if not cached
   * @param schemaFileId - The schema file ID
   * @returns Schema instance
   */
  static async createById(schemaFileId: string): Promise<Schema> {
    if (!schemaFileId) {
      throw new Error('Schema file ID is required')
    }

    // First, check if we have an instance cached by ID
    const cachedInstance = this.getById(schemaFileId)
    if (cachedInstance) {
      return cachedInstance
    }

    // Query database to get schema name from ID
    const { BaseDb } = await import('@/db/Db/BaseDb')
    const { schemas: schemasTable } = await import('@/seedSchema/SchemaSchema')

    const db = BaseDb.getAppDb()
    if (!db) {
      throw new Error('Database not available')
    }

    const dbSchemas = await db
      .select()
      .from(schemasTable)
      .where(eq(schemasTable.schemaFileId, schemaFileId))
      .orderBy(desc(schemasTable.version))
      .limit(1)

    if (dbSchemas.length === 0) {
      throw new Error(`Schema with ID "${schemaFileId}" not found in database`)
    }

    const dbSchema = dbSchemas[0]
    const schemaName = dbSchema.name

    if (!schemaName) {
      throw new Error(`Schema with ID "${schemaFileId}" has no name in database`)
    }

    // Create schema using the name (this will load from database/file)
    return this.create(schemaName)
  }

  /**
   * Find schema instance by schemaFileId
   * Waits for the schema to be fully loaded (idle state) by default
   * @param options - Find options including schemaFileId and wait configuration
   * @returns Schema instance if found, undefined otherwise
   */
  static async find({
    schemaFileId,
    waitForReady = true,
    readyTimeout = 5000,
  }: {
    schemaFileId: string
    waitForReady?: boolean
    readyTimeout?: number
  }): Promise<Schema | undefined> {
    if (!schemaFileId) {
      return undefined
    }

    try {
      return await findEntity<Schema>(
        {
          getById: (id) => Schema.getById(id),
          createById: (id) => Schema.createById(id),
        },
        { id: schemaFileId },
        {
          waitForReady,
          readyTimeout,
        }
      )
    } catch (error) {
      return undefined
    }
  }

  /**
   * Get instantiated Schema objects for all schemas (from database and files)
   * By default, returns only the latest version of each schema and excludes the internal Seed Protocol schema.
   * Uses loadAllSchemasFromDb() as the single source of truth, which intelligently merges database and file data.
   * 
   * @param options - Configuration options
   * @param options.includeAllVersions - If true, returns all versions of each schema. Default: false
   * @param options.includeInternal - If true, includes the internal Seed Protocol schema. Default: false
   * @returns Array of Schema instances
   */
  static async all(options: SchemaAllOptions = {}): Promise<Schema[]> {
    const { includeAllVersions = false, includeInternal = false } = options
    
    try {
      // Use loadAllSchemasFromDb as single source of truth
      // This intelligently merges database and file data, including drafts
      const allSchemasData = await loadAllSchemasFromDb()
      
      // Filter internal schemas unless explicitly included
      let filteredSchemas = includeInternal
        ? allSchemasData
        : allSchemasData.filter(schemaData => {
            const schema = schemaData.schema
            // Check if this is an internal schema by name or ID
            return !isInternalSchema(
              schema.metadata?.name || '',
              schema.id
            )
          })
      
      // Filter to latest versions if needed
      if (!includeAllVersions) {
        // Group by schema name and keep only the latest version of each
        const schemaMap = new Map<string, typeof filteredSchemas[0]>()
        for (const schemaData of filteredSchemas) {
          const schemaName = schemaData.schema.metadata?.name || ''
          if (!schemaName) continue
          
          const existing = schemaMap.get(schemaName)
          if (!existing || schemaData.schema.version > existing.schema.version) {
            schemaMap.set(schemaName, schemaData)
          } else if (schemaData.schema.version === existing.schema.version) {
            // If versions are equal, use updatedAt as tiebreaker
            const currentUpdatedAt = new Date(schemaData.schema.metadata?.updatedAt || 0).getTime()
            const existingUpdatedAt = new Date(existing.schema.metadata?.updatedAt || 0).getTime()
            if (currentUpdatedAt > existingUpdatedAt) {
              schemaMap.set(schemaName, schemaData)
            }
          }
        }
        filteredSchemas = Array.from(schemaMap.values())
      }
      
      // Create Schema instances using the schemaFileId from filtered data to ensure correct version
      const schemaInstances: Schema[] = []
      const processedSchemaNames = new Set<string>()
      
      for (const schemaData of filteredSchemas) {
        const schemaName = schemaData.schema.metadata?.name
        const schemaFileId = schemaData.schema.id
        const expectedVersion = schemaData.schema.version
        
        if (!schemaName) continue
        
        // Skip if we've already processed this schema name (to avoid duplicates)
        if (processedSchemaNames.has(schemaName)) {
          continue
        }
        processedSchemaNames.add(schemaName)
        
        // Try to use schemaFileId to ensure we load the correct version
        // First check if we have a cached instance by schemaFileId
        if (schemaFileId) {
          const cachedById = this.getById(schemaFileId)
          if (cachedById) {
            // Verify the cached instance has the correct version
            const cachedContext = cachedById.getService().getSnapshot().context
            if (cachedContext.version === expectedVersion) {
              schemaInstances.push(cachedById)
              continue
            }
          }
        }
        
        // If no cached instance by ID, check by name but verify version
        const cachedByName = this.instanceCacheByName.get(schemaName)
        if (cachedByName) {
          const cachedContext = cachedByName.instance.getService().getSnapshot().context
          // Only use cached instance if it has the correct version
          if (cachedContext.version === expectedVersion && (!schemaFileId || cachedContext.id === schemaFileId)) {
            schemaInstances.push(cachedByName.instance)
            continue
          }
        }
        
        // Create new instance - it will load from database
        // The loadOrCreateSchema actor should query by name and get the latest version
        // But to ensure we get the correct version, we'll use createById if we have the schemaFileId
        if (schemaFileId) {
          try {
            const instance = await this.createById(schemaFileId)
            schemaInstances.push(instance)
          } catch (error) {
            // Fallback to creating by name if createById fails
            schemaInstances.push(this.create(schemaName))
          }
        } else {
          schemaInstances.push(this.create(schemaName))
        }
      }
      
      return schemaInstances
    } catch (error) {
      // Fallback to file-based approach if database is unavailable
      // This maintains backward compatibility for environments without database
      logger(`Error loading schemas from database, falling back to files: ${error instanceof Error ? error.message : String(error)}`)
      
      // Use existing file-based implementation as fallback
      const allSchemaFiles = await listCompleteSchemaFiles()
      
      // Filter out internal schemas unless explicitly included
      const filteredSchemas = includeInternal
        ? allSchemaFiles
        : allSchemaFiles.filter(schema => {
            // Check if this is an internal schema by name or ID
            return !isInternalSchema(schema.name, schema.schemaFileId)
          })
      
      // If includeAllVersions is false, filter to only latest version of each schema
      const schemasToUse = includeAllVersions
        ? filteredSchemas
        : (() => {
            // Group by schema name and keep only the latest version of each
            const schemaMap = new Map<string, typeof filteredSchemas[0]>()
            for (const schema of filteredSchemas) {
              const existing = schemaMap.get(schema.name)
              if (!existing || schema.version > existing.version) {
                schemaMap.set(schema.name, schema)
              }
            }
            return Array.from(schemaMap.values())
          })()
      
      // Get unique schema names (one instance per schema name)
      const uniqueSchemaNames = new Set<string>()
      for (const schema of schemasToUse) {
        uniqueSchemaNames.add(schema.name)
      }
      
      // Create Schema instances for each unique schema name
      const schemaInstances: Schema[] = []
      for (const schemaName of uniqueSchemaNames) {
        schemaInstances.push(this.create(schemaName))
      }
      
      return schemaInstances
    }
  }

  getService(): SchemaService {
    return this._service
  }

  private _getSnapshot(): SchemaSnapshot {
    return this._service.getSnapshot() as SchemaSnapshot
  }

  private _getSnapshotContext(): SchemaMachineContext {
    return this._getSnapshot().context
  }

  get schemaName(): string {
    const context = this._getSnapshotContext()
    const schemaFileId = context.id // id is now the schemaFileId (string)
    
    // Prefer metadata.name if available (most reliable)
    if (context.metadata?.name) {
      return context.metadata.name
    }
    
    // If metadata.name is not available, use schemaName but only if it's not the ID
    // This prevents returning the ID when the schema is still loading or if an ID was mistakenly passed
    if (context.schemaName && context.schemaName !== schemaFileId) {
      return context.schemaName
    }
    
    // Final fallback - return schemaName even if it might be the ID
    // This handles edge cases during loading, but should be rare
    return context.schemaName || ''
  }

  get schemaFileId(): string | undefined {
    return this._getSnapshotContext().id // id is now the schemaFileId (string)
  }

  get id(): string | undefined {
    return this._getSnapshotContext().id // id is now the schemaFileId (string)
  }

  /**
   * Returns Model instances for this schema
   * This is a computed property that reads from the service context
   * Note: This is NOT reactive - use useModels() hook for reactivity
   */
  get models(): Model[] {
    const context = this._getSnapshotContext()
    
    // Get model IDs from service context (reactive state)
    const liveQueryIds = context._liveQueryModelIds || []
    
    // Get pending model IDs (not yet in DB)
    // Note: schemaId lookup is async, so we skip pending IDs here
    // They will be included when schemaId is available asynchronously
    const pendingIds: string[] = []
    
    // Combine and deduplicate
    const allModelIds = [...new Set([...liveQueryIds, ...pendingIds])]
    
    // Get Model instances from static cache
    const modelInstances: Model[] = []
    for (const modelFileId of allModelIds) {
      const model = Model.getById(modelFileId)
      if (model) {
        modelInstances.push(model)
      }
      // Note: Cannot create models asynchronously in this synchronous getter
      // Models will be created elsewhere when needed
    }
    
    // Return a new array reference (snapshot at time of access)
    return [...modelInstances]
  }

  get status() {
    return this._getSnapshot().value
  }

  get isEdited() {
    const context = this._getSnapshotContext()
    // First check in-memory state
    if (context._isEdited !== undefined) {
      return context._isEdited
    }
    // Fall back to reading from database if we have _dbId
    if (context._dbId) {
      // Load from database asynchronously (fire-and-forget for now)
      // For synchronous getter, we'll need to cache it or make it async
      // For now, return false if not in context
      return false
    }
    return false
  }

  get validationErrors() {
    return this._getSnapshotContext()._validationErrors || []
  }

  get isValid() {
    const errors = this.validationErrors
    return errors.length === 0
  }

  /**
   * Validate the schema
   * @returns Validation result
   */
  async validate(): Promise<{ isValid: boolean; errors: any[] }> {
    return new Promise((resolve) => {
      let resolved = false
      const subscription = this._service.subscribe((snapshot) => {
        if (snapshot.value === 'idle' || snapshot.value === 'error') {
          if (!resolved) {
            resolved = true
            subscription.unsubscribe()
            const errors = snapshot.context._validationErrors || []
            resolve({
              isValid: errors.length === 0,
              errors,
            })
          }
        }
      })

      this._service.send({ type: 'validateSchema' })
      
      // Timeout fallback to ensure we always resolve (15 seconds - longer than actor timeout)
      setTimeout(() => {
        if (!resolved) {
          resolved = true
          subscription.unsubscribe()
          const errors = this._getSnapshotContext()._validationErrors || []
          resolve({
            isValid: errors.length === 0,
            errors,
          })
        }
      }, 15000)
    })
  }

  /**
   * Build models object from Model instances (for persistence)
   * Model instances are the source of truth for model data
   */
  private _buildModelsFromInstances(): { [modelName: string]: any } {
    const context = this._getSnapshotContext()
    const models: { [modelName: string]: any } = {}
    
    // Get model IDs from service context (reactive state)
    const modelIds = context._liveQueryModelIds || []
    
    // Iterate through Model instances from static cache
    for (const modelFileId of modelIds) {
      const modelInstance = Model.getById(modelFileId)
      if (!modelInstance) continue
      try {
        const modelName = modelInstance.modelName
        
        if (!modelName) {
          logger(`Model instance with ID ${modelFileId} has no modelName, skipping`)
          continue
        }
        
        // Build model definition from Model instance context
        // CRITICAL: Read properties from ModelProperty instances, not from Model's properties context
        // ModelProperty instances are the source of truth for property data
        const propertiesFromInstances = (modelInstance as any)._buildPropertiesFromInstances?.() || modelInstance.properties || {}
        
        models[modelName] = {
          properties: propertiesFromInstances,
        }
        
        logger(`Built model "${modelName}" from Model instance (ID: ${modelFileId})`)
      } catch (error) {
        logger(`Error building model from instance (ID: ${modelFileId}): ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    
    logger(`Built ${Object.keys(models).length} models from Model instances`)
    return models
  }

  /**
   * Saves all edited properties to a new schema version.
   * This writes the changes to a new JSON file and clears the draft flags.
   * Validates the schema before saving.
   * Transitions schema from draft (DB-only) to published (file + DB).
   * @returns The file path of the new schema version
   */
  async saveNewVersion(): Promise<string> {
    // Check for conflicts before saving
    const conflictCheck = await this._checkForConflicts()
    if (conflictCheck.hasConflict) {
      const errorMessage = conflictCheck.message || 'Database was updated externally. Please reload the schema and try again.'
      logger(`CONFLICT DETECTED: ${errorMessage}`)
      throw new ConflictError(errorMessage, conflictCheck)
    }
    
    const context = this._getSnapshotContext()
    const { BaseDb } = await import('@/db/Db/BaseDb')
    const { schemas: schemasTable } = await import('@/seedSchema/SchemaSchema')
    const { addSchemaToDb } = await import('@/helpers/db')
    
    if (!context._isDraft || !context._editedProperties || context._editedProperties.size === 0) {
      logger('No changes to save')
      return ''
    }

    // Validate schema before saving
    const validationResult = await this.validate()
    if (!validationResult.isValid) {
      logger(`Schema validation failed with ${validationResult.errors.length} errors`)
      throw new Error(`Cannot save schema: validation failed. Errors: ${validationResult.errors.map(e => e.message).join(', ')}`)
    }

    logger(`Saving new version for schema ${this.schemaName} with ${context._editedProperties.size} edited properties`)

    // STEP 1: Ensure draft exists in database and update it with current state
    const db = BaseDb.getAppDb()
    if (!db) {
      throw new Error('Database not found')
    }

    // Build current schema state from context
    // CRITICAL: Read models from Model instances, not from Schema context
    // Model instances are the source of truth for model data
    const modelsFromInstances = this._buildModelsFromInstances()
    
    const currentSchema: SchemaFileFormat = {
      $schema: context.$schema || 'https://seedprotocol.org/schemas/data-model/v1',
      version: context.version || 1,
      metadata: context.metadata || {
        name: this.schemaName,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      models: modelsFromInstances, // Read from Model instances, not context.models
      enums: context.enums || {},
      migrations: context.migrations || [],
    }

    // Update draft in database with current state
    await addSchemaToDb(
      {
        name: this.schemaName,
        version: currentSchema.version,
        createdAt: new Date(currentSchema.metadata.createdAt).getTime(),
        updatedAt: new Date(currentSchema.metadata.updatedAt).getTime(),
      },
      currentSchema.id,
      JSON.stringify(currentSchema, null, 2),
      true, // isDraft = true (still a draft until file is written)
    )

    // Collect all edited properties and convert them to SchemaPropertyUpdate format
    const propertyUpdates = []
    
    for (const propertyKey of context._editedProperties) {
      // Skip schema-level changes (like schema name changes)
      if (propertyKey === 'schema:name') {
        // Schema name changes are handled by using the updated schemaName in the file path
        continue
      }
      
      const [modelName, propertyName] = propertyKey.split(':')
      
      if (!modelName || !propertyName) {
        logger(`Invalid property key format: ${propertyKey}`)
        continue
      }

      // Get ModelProperty instance from cache
      const cacheKey = `${modelName}:${propertyName}`
      const ModelPropertyClass = ModelProperty as typeof ModelProperty & {
        instanceCache: Map<string, { instance: ModelProperty; refCount: number }>
      }
      
      const cachedInstance = ModelPropertyClass.instanceCache.get(cacheKey)
      
      if (!cachedInstance) {
        logger(`ModelProperty instance not found for ${cacheKey}`)
        continue
      }

      const modelProperty = cachedInstance.instance
      const propertyContext = modelProperty.getService().getSnapshot().context

      // Convert to SchemaPropertyUpdate
      const propertyUpdate = await convertPropertyToSchemaUpdate(
        propertyContext,
        modelName,
        propertyName,
      )
      
      propertyUpdates.push(propertyUpdate)
    }

    if (propertyUpdates.length === 0) {
      logger('No valid property updates to save')
      return ''
    }

    // STEP 2: Save to new schema version (writes file)
    const newFilePath = await updateModelProperties(this.schemaName, propertyUpdates)

    // STEP 3: After file is written, update database to mark as published (isDraft = false)
    // Load the file to get the final schema with IDs
    const { BaseFileManager } = await import('@/helpers/FileManager/BaseFileManager')
    const fileContent = await BaseFileManager.readFileAsString(newFilePath)
    const publishedSchema = JSON.parse(fileContent) as SchemaFileFormat

    // Update database record: set isDraft = false and update schemaFileId
    const dbSchema = await db
      .select()
      .from(schemasTable)
      .where(eq(schemasTable.name, this.schemaName))
      .limit(1)

    if (dbSchema.length > 0) {
      await db
        .update(schemasTable)
        .set({
          isDraft: false,
          isEdited: false, // Clear isEdited flag after saving to file
          schemaFileId: publishedSchema.id,
          schemaData: JSON.stringify(publishedSchema, null, 2),
          version: publishedSchema.version,
          updatedAt: new Date(publishedSchema.metadata.updatedAt).getTime(),
        })
        .where(eq(schemasTable.id, dbSchema[0].id!))
    } else {
      // Create new record if it doesn't exist (shouldn't happen, but safety)
      await addSchemaToDb(
        {
          name: this.schemaName,
          version: publishedSchema.version,
          createdAt: new Date(publishedSchema.metadata.createdAt).getTime(),
          updatedAt: new Date(publishedSchema.metadata.updatedAt).getTime(),
        },
        publishedSchema.id,
        JSON.stringify(publishedSchema, null, 2),
        false, // isDraft = false (published)
        false, // isEdited = false (published)
      )
    }

    // Clear draft flags on Schema and update conflict detection metadata
    this._service.send({ 
      type: 'clearDraft',
      _dbUpdatedAt: new Date(publishedSchema.metadata.updatedAt).getTime(),
      _dbVersion: publishedSchema.version,
    } as any)

    // Clear edited flags on all ModelProperty instances and in database
    const { properties: propertiesTable, models: modelsTable } = await import('@/seedSchema')
    
    for (const propertyKey of context._editedProperties) {
      const [modelName, propertyName] = propertyKey.split(':')
      const cacheKey = `${modelName}:${propertyName}`
      
      const ModelPropertyClass = ModelProperty as typeof ModelProperty & {
        instanceCache: Map<string, { instance: ModelProperty; refCount: number }>
      }
      
      const cachedInstance = ModelPropertyClass.instanceCache.get(cacheKey)
      
      if (cachedInstance) {
        const modelProperty = cachedInstance.instance
        const propertyContext = modelProperty.getService().getSnapshot().context
        
        // Update original values to current values and clear edited flag
        modelProperty.getService().send({
          type: 'clearEdited',
        })
        
        // Clear isEdited flag in database
        try {
          if (db && modelName && propertyName) {
            // Find model by name
            const modelRecords = await db
              .select({ id: modelsTable.id })
              .from(modelsTable)
              .where(eq(modelsTable.name, modelName))
              .limit(1)
            
            if (modelRecords.length > 0) {
              // Find property by name and modelId
              const propertyRecords = await db
                .select({ id: propertiesTable.id })
                .from(propertiesTable)
                .where(
                  and(
                    eq(propertiesTable.name, propertyName),
                    eq(propertiesTable.modelId, modelRecords[0].id)
                  )
                )
                .limit(1)
              
              if (propertyRecords.length > 0) {
                // Clear isEdited flag in database
                await db
                  .update(propertiesTable)
                  .set({ isEdited: false })
                  .where(eq(propertiesTable.id, propertyRecords[0].id!))
              }
            }
          }
        } catch (error) {
          logger(`Error clearing isEdited flag in database for property ${propertyKey}: ${error}`)
        }
      }
    }
    
    // Clear isEdited flags for all models in this schema
    try {
      if (db && context._dbId) {
        // Get all models for this schema
        const { modelSchemas, models: modelsTable } = await import('@/seedSchema')
        const modelRecords = await db
          .select({ id: modelsTable.id })
          .from(modelSchemas)
          .innerJoin(modelsTable, eq(modelSchemas.modelId, modelsTable.id))
          .where(eq(modelSchemas.schemaId, context._dbId))
        
        // Clear isEdited flag for all models
        for (const modelRecord of modelRecords) {
          if (modelRecord.id) {
            await db
              .update(modelsTable)
              .set({ isEdited: false })
              .where(eq(modelsTable.id, modelRecord.id))
          }
        }
      }
    } catch (error) {
      logger(`Error clearing isEdited flags for models: ${error}`)
    }

    logger(`Successfully saved new version for schema ${this.schemaName} and published to file`)
    return newFilePath
  }

  /**
   * Check for conflicts between actor context and database
   * @returns ConflictResult indicating if a conflict exists
   */
  private async _checkForConflicts(): Promise<ConflictResult> {
    const context = this._getSnapshotContext()
    
    // If we don't have load metadata, can't check for conflicts
    if (!context._dbUpdatedAt || !context.id) {
      return { hasConflict: false }
    }
    
    try {
      const db = BaseDb.getAppDb()
      if (!db) {
        return { hasConflict: false } // Can't check without DB
      }
      
      // Get current DB record
      const dbSchemas = await db
        .select()
        .from(schemasTable)
        .where(eq(schemasTable.schemaFileId, context.id)) // id is now the schemaFileId (string)
        .orderBy(desc(schemasTable.version))
        .limit(1)
      
      if (dbSchemas.length === 0) {
        return { hasConflict: false } // No DB record, no conflict
      }
      
      const dbRecord = dbSchemas[0]
      
      // Check if DB was updated after we loaded
      const dbUpdatedAt = dbRecord.updatedAt || 0
      const localUpdatedAt = context._dbUpdatedAt
      
      if (dbUpdatedAt > localUpdatedAt) {
        return {
          hasConflict: true,
          localVersion: context.version,
          dbVersion: dbRecord.version,
          localUpdatedAt: context.metadata?.updatedAt,
          dbUpdatedAt: new Date(dbUpdatedAt).toISOString(),
          message: `Database was updated externally. Local version: ${context.version}, DB version: ${dbRecord.version}`,
        }
      }
      
      return { hasConflict: false }
    } catch (error) {
      logger(`Error checking for conflicts: ${error instanceof Error ? error.message : String(error)}`)
      return { hasConflict: false } // On error, assume no conflict to allow save
    }
  }

  /**
   * Reload schema from database
   * This refreshes the actor context with the latest data from the database
   */
  async reload(): Promise<void> {
    logger(`Reloading schema ${this.schemaName} from database`)
    
    // Send reload event to machine
    this._service.send({ type: 'reloadFromDb' })
    
    // Wait for reload to complete
    return new Promise((resolve, reject) => {
      const subscription = this._service.subscribe((snapshot) => {
        if (snapshot.value === 'idle') {
          subscription.unsubscribe()
          resolve()
        } else if (snapshot.value === 'error') {
          subscription.unsubscribe()
          reject(new Error('Failed to reload schema from database'))
        }
      })
      
      // Timeout after 10 seconds
      setTimeout(() => {
        subscription.unsubscribe()
        reject(new Error('Timeout waiting for schema reload'))
      }, 10000)
    })
  }

  /**
   * Save the current schema state to the database as a draft
   * This persists changes immediately without creating a new file version
   * @param oldName - Optional old name to look up existing record before name change
   * @param newName - Optional new name to use (if not provided, uses this.schemaName)
   */
  private async _saveDraftToDb(oldName?: string, newName?: string): Promise<void> {
    saveDraftLogger(`_saveDraftToDb called for schema (oldName: "${oldName}", newName: "${newName}")`)
    
    // Don't save during initialization - schemas are being loaded from files, not created as drafts
    // Check this FIRST before doing any expensive work like _getSnapshotContext()
    if (typeof window !== 'undefined') {
      const now = Date.now()
      // Use cached check to avoid expensive operations
      // Always check if cache is stale or if we previously got false (to allow recovery)
      const cacheIsStale = cachedClientInitialized === null || (now - clientCheckTime) > CLIENT_CHECK_CACHE_MS
      const shouldRecheck = cacheIsStale || cachedClientInitialized === false
      
      saveDraftLogger(`Client check: cacheIsStale=${cacheIsStale}, shouldRecheck=${shouldRecheck}, cachedValue=${cachedClientInitialized}, timeSinceCheck=${now - clientCheckTime}ms`)
      
      if (shouldRecheck) {
        try {
          // Use dynamic import for browser compatibility (require() doesn't work in browsers)
          const { getClient } = await import('@/client/ClientManager')
          const { ClientManagerState } = await import('@/client/constants')
          const client = getClient()
          const clientSnapshot = client.getService().getSnapshot()
          // Check if state is IDLE (primary check) - isInitialized is set in entry action so should be true
          // But we check it as a secondary safeguard
          const isIdle = clientSnapshot.value === ClientManagerState.IDLE
          const isInitialized = clientSnapshot.context.isInitialized
          // If state is IDLE, trust it even if isInitialized isn't set yet (entry action should set it)
          // This aligns with useIsClientReady which only checks the state value
          cachedClientInitialized = isIdle && (isInitialized !== false)
          clientCheckTime = now
          saveDraftLogger(`Client state checked: state=${clientSnapshot.value}, isIdle=${isIdle}, isInitialized=${isInitialized}, result=${cachedClientInitialized}`)
        } catch (error) {
          // If we can't check client state, assume not initialized to be safe
          // But only cache for a short time to allow recovery
          cachedClientInitialized = false
          clientCheckTime = now
          saveDraftLogger(`Error checking client state: ${error instanceof Error ? error.message : String(error)}, setting cachedClientInitialized=false`)
        }
      } else {
        saveDraftLogger(`Using cached client state: cachedClientInitialized=${cachedClientInitialized}`)
      }
      
      if (!cachedClientInitialized) {
        saveDraftLogger(`Client not initialized, skipping save (oldName: "${oldName}", newName: "${newName}")`)
        // Skip silently during initialization to avoid log spam and reduce overhead
        return
      }
    }
    
    saveDraftLogger(`Client is initialized, proceeding with save (oldName: "${oldName}", newName: "${newName}")`)
    
    // Check for conflicts before saving
    const conflictCheck = await this._checkForConflicts()
    if (conflictCheck.hasConflict) {
      const errorMessage = conflictCheck.message || 'Database was updated externally. Please reload the schema and try again.'
      saveDraftLogger(`CONFLICT DETECTED: ${errorMessage}`)
      throw new ConflictError(errorMessage, conflictCheck)
    }
    
    const context = this._getSnapshotContext()
    const schemaName = newName || context.schemaName || oldName || ''
    const schemaFileId = context.id || '' // id is now the schemaFileId (string)
    
    // Use schemaFileId as the key if available, otherwise use schemaName
    const saveKey = schemaFileId || schemaName
    
    // Prevent concurrent saves for the same schema
    if (Schema.savingSchemas.has(saveKey)) {
      saveDraftLogger(`Schema ${schemaName} (key: ${saveKey}) is already being saved, skipping concurrent save`)
      return
    }
    
    Schema.savingSchemas.add(saveKey)
    saveDraftLogger(`Starting save for schema ${schemaName} (key: ${saveKey}, schemaFileId: ${schemaFileId})`)
    
    try {
      // Get context - if service is stopped, use the last known context or build from metadata
      let context: SchemaMachineContext
      try {
        context = this._getSnapshotContext()
      } catch (error) {
        // Service might be stopped, build context from what we know
        logger(`Service stopped, building context from available data`)
        context = {
          schemaName: newName || oldName || '',
          metadata: {
            name: newName || oldName || '',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          version: 1,
          _isDraft: true,
          _editedProperties: new Set<string>(),
        } as SchemaMachineContext
      }
      const { addSchemaToDb } = await import('@/helpers/db')
      const { generateId } = await import('@/helpers')
      const { BaseDb } = await import('@/db/Db/BaseDb')
      const { schemas: schemasTable } = await import('@/seedSchema/SchemaSchema')

      const db = BaseDb.getAppDb()
      if (!db) {
        throw new Error('Database not found')
      }

      // Use provided newName or fall back to context schemaName (avoid getter which might be stale)
      const finalNewName = newName || context.schemaName || this.schemaName
      // CRITICAL: If name changed, we MUST look up by old name to find the existing record
      // Don't use finalNewName if oldName is provided - that would look up by the new name and not find the old record
      const lookupName = oldName && oldName !== finalNewName ? oldName : finalNewName

      // Try to get existing schema ID from database to preserve it
      // PRIMARY: Look up by schemaFileId (most reliable, independent of name changes)
      // FALLBACK: Look up by old name if name changed, otherwise by current name
      let existingSchemaId: string | undefined
      let existingSchemaRecord: typeof schemasTable.$inferSelect | undefined
      
      // PRIMARY: Look up by schemaFileId if we have it (this is the most reliable way)
      if (context.id) {
        logger(`Looking up schema by schemaFileId: ${context.id}`)
        const schemasById = await db
          .select()
          .from(schemasTable)
          .where(eq(schemasTable.schemaFileId, context.id)) // id is now the schemaFileId (string)
          .limit(1)
        
        if (schemasById.length > 0) {
          const foundRecord = schemasById[0]
          existingSchemaRecord = foundRecord
          existingSchemaId = foundRecord.schemaFileId || context.id
          logger(`Found schema by schemaFileId: ${context.id} (id: ${foundRecord.id}, name: ${foundRecord.name})`)
        } else {
          logger(`No schema found by schemaFileId: ${context.id}`)
        }
      } else {
        logger(`No id (schemaFileId) in context, will look up by name`)
      }
      
      // FALLBACK: If not found by schemaFileId, try by name (for newly created schemas that don't have schemaFileId yet)
      if (!existingSchemaRecord) {
        logger(`Looking up schema by name "${lookupName}" (oldName: ${oldName}, finalNewName: ${finalNewName})`)
        const existingSchemas = await db
          .select()
          .from(schemasTable)
          .where(eq(schemasTable.name, lookupName))
          .limit(10) // Get multiple to find drafts
        
        logger(`Found ${existingSchemas.length} records with name "${lookupName}"`)
        
        // If name changed, prefer draft records; otherwise prefer any record
        if (existingSchemas.length > 0) {
          if (oldName && oldName !== finalNewName) {
            // When name changes, prefer draft records
            const draftRecord = existingSchemas.find((s: typeof schemasTable.$inferSelect) => s.isDraft === true)
            const selectedRecord = draftRecord || existingSchemas[0]
            existingSchemaRecord = selectedRecord
            logger(`Selected ${draftRecord ? 'draft' : 'first'} record (id: ${selectedRecord.id}, isDraft: ${selectedRecord.isDraft})`)
          } else {
            const selectedRecord = existingSchemas[0]
            existingSchemaRecord = selectedRecord
            logger(`Selected first record (id: ${selectedRecord.id}, isDraft: ${selectedRecord.isDraft})`)
          }
          
          if (existingSchemaRecord?.schemaFileId) {
            existingSchemaId = existingSchemaRecord.schemaFileId
          }
        } else {
          logger(`No records found with name "${lookupName}"`)
        }
      }
      
      if (existingSchemaRecord) {
        logger(`Using existing record (id: ${existingSchemaRecord.id}, name: ${existingSchemaRecord.name}, isDraft: ${existingSchemaRecord.isDraft}, schemaFileId: ${existingSchemaRecord.schemaFileId || 'none'})`)
      } else {
        logger(`No existing record found`)
      }

      // Build current schema state from context
      // Use existing schemaFileId if we found one, otherwise use the one from context, or generate new
      const schemaFileId = existingSchemaId || context.id || generateId() // id is now the schemaFileId (string)
      
      // Build metadata - if name changed, use newName, otherwise use context metadata
      // Always ensure metadata.name matches finalNewName to prevent inconsistencies
      const currentMetadata = context.metadata ? {
        ...context.metadata,
        name: finalNewName, // Always use the final name (from newName parameter or context)
        updatedAt: new Date().toISOString(), // Always update timestamp when saving
      } : {
        name: finalNewName,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      
      // CRITICAL: Ensure schema.id always matches schemaFileId (database is source of truth)
      // Use existingSchemaRecord.schemaFileId if available, otherwise use the calculated schemaFileId
      const finalSchemaFileId = existingSchemaRecord?.schemaFileId || schemaFileId
      
      // CRITICAL: Read models from Model instances, not from Schema context
      // Model instances are the source of truth for model data
      const modelsFromInstances = this._buildModelsFromInstances()
      
      const currentSchema: SchemaFileFormat = {
        $schema: context.$schema || 'https://seedprotocol.org/schemas/data-model/v1',
        version: context.version || 1,
        id: finalSchemaFileId, // Always use schemaFileId from database as source of truth
        metadata: currentMetadata,
        models: modelsFromInstances, // Read from Model instances, not context.models
        enums: context.enums || {},
        migrations: context.migrations || [],
      }
      
      // Log if there was a mismatch that we're fixing
      if (existingSchemaRecord?.schemaFileId && context.id && context.id !== finalSchemaFileId) {
        saveDraftLogger(`Fixed schema ID mismatch: context.id="${context.id}" does not match DB schemaFileId="${finalSchemaFileId}". Using DB value.`)
      }
      
      saveDraftLogger(`Building schema with metadata.name="${currentMetadata.name}", finalNewName="${finalNewName}"`)

      // If name changed, we MUST update the existing record (don't create a new one)
      if (oldName && oldName !== finalNewName) {
        if (existingSchemaRecord && existingSchemaRecord.id) {
          logger(`Updating existing schema record (id: ${existingSchemaRecord.id}) from "${oldName}" to "${finalNewName}"`)
          
          // Update the existing record with the new name
          const schemaDataString = JSON.stringify(currentSchema, null, 2)
          saveDraftLogger(`Saving schemaData with metadata.name="${currentSchema.metadata.name}", schemaData length=${schemaDataString.length}`)
          
          // CRITICAL: Ensure schemaFileId column matches schema.id (schema.id is now guaranteed to match finalSchemaFileId)
          // Always update schemaFileId to match the id in the schema JSON to maintain consistency
          const updateData: any = {
            name: finalNewName,
            schemaData: schemaDataString,
            schemaFileId: finalSchemaFileId, // Always set to match schema.id
            version: currentSchema.version,
            updatedAt: new Date(currentSchema.metadata.updatedAt).getTime(),
            isDraft: true, // Ensure it's marked as a draft when saving via _saveDraftToDb
          }
          
          // Log if we're fixing a mismatch
          if (existingSchemaRecord.schemaFileId && existingSchemaRecord.schemaFileId !== finalSchemaFileId) {
            saveDraftLogger(`Fixing schemaFileId mismatch: DB had "${existingSchemaRecord.schemaFileId}", schema.id is "${finalSchemaFileId}". Updating DB to match schema.id.`)
          } else if (!existingSchemaRecord.schemaFileId && finalSchemaFileId) {
            saveDraftLogger(`Setting schemaFileId to ${finalSchemaFileId} (was null)`)
          }
          
          await db
            .update(schemasTable)
            .set(updateData)
            .where(eq(schemasTable.id, existingSchemaRecord.id))
          
          // Verify what was saved by reading it back
          const verifyRecord = await db
            .select()
            .from(schemasTable)
            .where(eq(schemasTable.id, existingSchemaRecord.id))
            .limit(1)
          
          if (verifyRecord.length > 0 && verifyRecord[0].schemaData) {
            try {
              const savedSchema = JSON.parse(verifyRecord[0].schemaData) as SchemaFileFormat
              saveDraftLogger(`Verified saved schemaData: metadata.name="${savedSchema.metadata?.name}", name column="${verifyRecord[0].name}", isDraft=${verifyRecord[0].isDraft}, schemaFileId="${verifyRecord[0].schemaFileId}"`)
              
              if (verifyRecord[0].isDraft !== true) {
                saveDraftLogger(`ERROR: isDraft is not true after save! Expected true, got ${verifyRecord[0].isDraft}. This will cause the schema to load from file instead of database!`)
                // Try to fix it immediately
                await db
                  .update(schemasTable)
                  .set({ isDraft: true })
                  .where(eq(schemasTable.id, existingSchemaRecord.id))
                saveDraftLogger(`Attempted to fix isDraft by setting it to true again`)
                
                // Verify the fix
                const fixedRecord = await db
                  .select()
                  .from(schemasTable)
                  .where(eq(schemasTable.id, existingSchemaRecord.id))
                  .limit(1)
                if (fixedRecord.length > 0) {
                  saveDraftLogger(`After fix attempt: isDraft=${fixedRecord[0].isDraft}`)
                }
              }
            } catch (error) {
              saveDraftLogger(`Error parsing saved schemaData for verification: ${error}`)
            }
          } else {
            saveDraftLogger(`WARNING: Could not verify saved record - record not found or has no schemaData`)
          }
          
          // Update the context's id (schemaFileId) and conflict detection metadata
          try {
            const snapshot = this._service.getSnapshot()
            if (snapshot.status !== 'stopped') {
              // Use finalSchemaFileId which matches the schema.id
              // Also update conflict detection metadata after successful save
              this._service.send({
                type: 'updateContext',
                id: finalSchemaFileId, // id is now the schemaFileId (string)
                _dbUpdatedAt: new Date(currentSchema.metadata.updatedAt).getTime(),
                _dbVersion: currentSchema.version,
              })
            }
          } catch (error) {
            // Service might be stopped, ignore
            logger(`Could not update id (schemaFileId) in context: ${error instanceof Error ? error.message : String(error)}`)
          }
          
          logger(`Successfully updated schema name from "${oldName}" to "${finalNewName}" in database`)
          Schema.savingSchemas.delete(saveKey)
          return
        } else {
          // Name changed but we didn't find the existing record - try harder to find it
          logger(`WARNING: Name changed from "${oldName}" to "${finalNewName}" but existing record not found. Trying additional lookups...`)
          
          // Try to find by looking for ANY draft with the old name (even if it doesn't match exactly)
          const allDrafts = await db
            .select()
            .from(schemasTable)
            .where(eq(schemasTable.name, oldName))
            .limit(1)
          
          if (allDrafts.length > 0 && allDrafts[0].id) {
            const foundRecord = allDrafts[0]
            logger(`Found existing record by old name "${oldName}" (id: ${foundRecord.id}), updating to new name "${finalNewName}"`)
            
            // Update the existing record with the new name
              // CRITICAL: Ensure schemaFileId matches schema.id
              await db
              .update(schemasTable)
              .set({
                name: finalNewName,
                schemaData: JSON.stringify(currentSchema, null, 2),
                schemaFileId: finalSchemaFileId, // Always set to match schema.id
                version: currentSchema.version,
                updatedAt: new Date(currentSchema.metadata.updatedAt).getTime(),
                isDraft: true, // Ensure it's marked as a draft when saving via _saveDraftToDb
              })
              .where(eq(schemasTable.id, foundRecord.id))
            
            // Update context with id (schemaFileId) and conflict detection metadata
            try {
              const snapshot = this._service.getSnapshot()
              if (snapshot.status !== 'stopped' && finalSchemaFileId) {
                this._service.send({
                  type: 'updateContext',
                  id: finalSchemaFileId, // id is now the schemaFileId (string)
                  _dbUpdatedAt: new Date(currentSchema.metadata.updatedAt).getTime(),
                  _dbVersion: currentSchema.version,
                })
              }
            } catch (error) {
              // Service might be stopped, ignore
            }
            
            logger(`Successfully updated schema name from "${oldName}" to "${finalNewName}" in database (found by old name)`)
            Schema.savingSchemas.delete(saveKey)
            return
          }
          
          // If we still can't find it, this is an error - don't create a duplicate
          logger(`ERROR: Could not find existing schema record with name "${oldName}". Cannot update name to "${finalNewName}" without creating a duplicate.`)
          Schema.savingSchemas.delete(saveKey)
          throw new Error(`Cannot update schema name: existing schema with name "${oldName}" not found in database`)
        }
      }

      // If name changed, we should have already updated the record above and returned
      // Only call addSchemaToDb if name didn't change (normal save scenario)
      if (oldName && oldName !== finalNewName) {
        // This should never happen - we should have updated above and returned
        // But if we get here, it means the update path didn't work, so we need to handle it
        logger(`ERROR: Name changed from "${oldName}" to "${finalNewName}" but update path didn't complete. This should not occur.`)
        Schema.savingSchemas.delete(saveKey)
        throw new Error(`Failed to update schema name: existing record not found or update failed`)
      }

      // Otherwise, use addSchemaToDb which will handle create/update logic (for normal saves, not name changes)
      await addSchemaToDb(
        {
          name: finalNewName,
          version: currentSchema.version,
          createdAt: new Date(currentSchema.metadata.createdAt).getTime(),
          updatedAt: new Date(currentSchema.metadata.updatedAt).getTime(),
        },
        currentSchema.id, // schemaFileId
        JSON.stringify(currentSchema, null, 2), // schemaData
        true, // isDraft = true
      )

      // Update conflict detection metadata after successful save
      try {
        const snapshot = this._service.getSnapshot()
        if (snapshot.status !== 'stopped') {
          this._service.send({
            type: 'updateContext',
            _dbUpdatedAt: new Date(currentSchema.metadata.updatedAt).getTime(),
            _dbVersion: currentSchema.version,
          })
        }
      } catch (error) {
        // Service might be stopped, ignore
      }
      
      saveDraftLogger(`Successfully saved draft schema "${finalNewName}" to database (key: ${saveKey})`)
      logger(`Saved draft schema ${finalNewName} to database`)
    } catch (error) {
      saveDraftLogger(`ERROR: Failed to save draft to database for schema "${schemaName}" (key: ${saveKey}): ${error instanceof Error ? error.message : String(error)}`)
      logger(`Failed to save draft to database: ${error instanceof Error ? error.message : String(error)}`)
      throw error
    } finally {
      // Always remove from saving set, even if there was an error
      Schema.savingSchemas.delete(saveKey)
      saveDraftLogger(`Removed schema from saving set (key: ${saveKey})`)
    }
  }


  unload(): void {
    try {
      const context = this._getSnapshotContext()
      const cacheKeys: string[] = []
      
      if (context.id) {
        cacheKeys.push(context.id)
      }
      if (context.schemaName) {
        cacheKeys.push(context.schemaName)
      }
      
      unloadEntity(this, {
        getCacheKeys: () => cacheKeys,
        caches: [Schema.instanceCacheById, Schema.instanceCacheByName],
        instanceState: schemaInstanceState,
        getService: (instance) => instance._service,
        onUnload: () => {
          // Clean up WeakMap entry
          schemaInstanceState.delete(this)
        },
      })
    } catch (error) {
      // Service might be stopped, can't get context - that's okay
      logger(`Could not get context during unload: ${error instanceof Error ? error.message : String(error)}`)
      // Still try to clean up what we can
      const instanceState = schemaInstanceState.get(this)
      if (instanceState?.liveQuerySubscription) {
        instanceState.liveQuerySubscription.unsubscribe()
        instanceState.liveQuerySubscription = null
      }
      schemaInstanceState.delete(this)
      try {
        this._service.stop()
      } catch {
        // Service might already be stopped
      }
    }
  }

  /**
   * Set up liveQuery subscription to watch for model changes in the database
   * This enables cross-instance synchronization (e.g., changes in other tabs/windows)
   */
  private _setupLiveQuerySubscription(): void {
    // Only set up in browser environment where liveQuery is available
    if (typeof window === 'undefined') {
      return
    }

    setupEntityLiveQuery(this, {
      getEntityId: async (schema) => {
        const { BaseDb } = await import('@/db/Db/BaseDb')
        const { schemas: schemasTable } = await import('@/seedSchema')
        const { eq } = await import('drizzle-orm')
        
        const db = BaseDb.getAppDb()
        if (!db) {
          return undefined
        }

        const context = schema._getSnapshotContext()
        const schemaName = context.metadata?.name
        if (!schemaName) {
          return undefined
        }

        const schemaRecords = await db
          .select()
          .from(schemasTable)
          .where(eq(schemasTable.name, schemaName))
          .limit(1)

        if (schemaRecords.length === 0 || !schemaRecords[0].id) {
          return undefined
        }

        return schemaRecords[0].id
      },
      buildQuery: async (schemaId) => {
        const { BaseDb } = await import('@/db/Db/BaseDb')
        const { modelSchemas, models: modelsTable } = await import('@/seedSchema')
        const { eq } = await import('drizzle-orm')
        
        const db = BaseDb.getAppDb()
        if (!db) {
          throw new Error('Database not available')
        }
        return BaseDb.liveQuery<{ 
          modelId: number
          modelName: string
          modelFileId: string
        }>(
          db
            .select({
              modelId: modelSchemas.modelId,
              modelName: modelsTable.name,
              modelFileId: modelsTable.schemaFileId,
            })
            .from(modelSchemas)
            .innerJoin(modelsTable, eq(modelSchemas.modelId, modelsTable.id))
            .where(eq(modelSchemas.schemaId, schemaId))
        )
      },
      extractEntityIds: (rows) => rows.map(row => row.modelFileId).filter(Boolean) as string[],
      updateContext: (schema, ids) => {
        // Helper function to send updateContext event with model IDs
        const sendUpdateContext = () => {
          // Double-check instance state still exists
          const verifyInstanceState = schemaInstanceState.get(schema)
          if (!verifyInstanceState) {
            logger(`[Schema._setupLiveQuerySubscription] Instance state cleaned up before sending updateContext`)
            return
          }
          
          try {
            const snapshot = schema._service.getSnapshot()
            if (snapshot.status === 'stopped') {
              logger(`[Schema._setupLiveQuerySubscription] Service stopped before sending, skipping`)
              return
            }
            
            // Send updateContext with liveQueryModelIds in service context for reactive updates
            schema._service.send({
              type: 'updateContext',
              _liveQueryModelIds: ids, // Store in service context for reactivity
              _modelsUpdated: Date.now(), // Internal field for tracking
            })
            logger(`[Schema._setupLiveQuerySubscription] Sent updateContext event with ${ids.length} model IDs`)
          } catch (error) {
            logger(`[Schema._setupLiveQuerySubscription] Error sending updateContext: ${error}`)
          }
        }
        
        // Check if service is stopped before sending events
        const snapshot = schema._service.getSnapshot()
        const isServiceStopped = snapshot.status === 'stopped'
        
        if (isServiceStopped) {
          logger(`[Schema._setupLiveQuerySubscription] Service is stopped, restarting before sending updateContext`)
          // Restart the service first
          schema._service.start()
          
          // Wait for service to be ready (idle state) before sending event
          setTimeout(() => {
            const delayedInstanceState = schemaInstanceState.get(schema)
            if (!delayedInstanceState) {
              logger(`[Schema._setupLiveQuerySubscription] Instance state cleaned up during restart delay`)
              return
            }
            
            const newSnapshot = schema._service.getSnapshot()
            if (newSnapshot.status !== 'stopped') {
              sendUpdateContext()
            } else {
              logger(`[Schema._setupLiveQuerySubscription] Service still stopped after restart attempt`)
            }
          }, 10)
        } else {
          // Service is running, send immediately
          sendUpdateContext()
        }
      },
      createChildInstances: async (ids) => {
        const { Model } = await import('@/Model/Model')
        for (const id of ids) {
          await Model.createById(id)
        }
      },
      queryInitialData: async (schemaId) => {
        const { BaseDb } = await import('@/db/Db/BaseDb')
        const { modelSchemas, models: modelsTable } = await import('@/seedSchema')
        const { eq } = await import('drizzle-orm')
        
        const db = BaseDb.getAppDb()
        if (!db) {
          return []
        }

        // Retry logic for initial query
        const queryInitialModels = async (retries = 3): Promise<any[]> => {
          try {
            const initialModels = await db
              .select({
                modelId: modelSchemas.modelId,
                modelName: modelsTable.name,
                modelFileId: modelsTable.schemaFileId,
              })
              .from(modelSchemas)
              .innerJoin(modelsTable, eq(modelSchemas.modelId, modelsTable.id))
              .where(eq(modelSchemas.schemaId, schemaId))
            
            logger(`[Schema._setupLiveQuerySubscription] Initial query found ${initialModels.length} models`)
            
            if (initialModels.length > 0) {
              return initialModels.map((row: { modelId: number; modelName: string; modelFileId: string | null }) => ({
                modelId: row.modelId,
                modelName: row.modelName,
                modelFileId: row.modelFileId || '',
              }))
            } else if (retries > 0) {
              logger(`[Schema._setupLiveQuerySubscription] No models found, retrying... (${retries} retries left)`)
              await new Promise(resolve => setTimeout(resolve, 100))
              return queryInitialModels(retries - 1)
            } else {
              logger(`[Schema._setupLiveQuerySubscription] No models found in initial query after retries`)
              return []
            }
          } catch (error) {
            if (retries > 0) {
              logger(`[Schema._setupLiveQuerySubscription] Error querying initial models, retrying... (${retries} retries left): ${error}`)
              await new Promise(resolve => setTimeout(resolve, 100))
              return queryInitialModels(retries - 1)
            } else {
              logger(`[Schema._setupLiveQuerySubscription] Error querying initial models after retries: ${error}`)
              return []
            }
          }
        }
        
        return queryInitialModels()
      },
      instanceState: schemaInstanceState,
      loggerName: 'seedSdk:schema:liveQuery',
      isReady: (schema) => {
        const snapshot = schema._service.getSnapshot()
        return snapshot.value === 'idle' && !!snapshot.context.metadata?.name
      },
    })
  }

}