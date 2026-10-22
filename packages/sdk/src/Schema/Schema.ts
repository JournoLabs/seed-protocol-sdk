import { ActorRefFrom, createActor, SnapshotFrom } from 'xstate'
import { schemaMachine, SchemaMachineContext } from './service/schemaMachine'
import { loadAllSchemasFromDb } from '@/helpers/schema'
import { mergeSchemaFiles, writeNextSchemaVersion } from '@/helpers/schemaApply'
import { Model } from '@/Model/Model'
import { getDraftSaveError, queueDraftSave, trackDraftSave } from '@/helpers/entity/draftSaveErrors'
import { SchemaFileFormat } from '@/types/import'
import type { CreateWaitOptions } from '@/types'
import { BaseDb } from '@/db/Db/BaseDb'
import { schemas as schemasTable } from '@/seedSchema/SchemaSchema'
import { modelSchemas } from '@/seedSchema/ModelSchemaSchema'
import { models as modelsTable, properties as propertiesTable } from '@/seedSchema/ModelSchema'
import { eq, desc, and, inArray } from 'drizzle-orm'
import { createReactiveProxy } from '@/helpers/reactiveProxy'
import { ConflictError, ConflictResult } from '@/Schema/errors'
import { getClient } from '@/client/ClientManager'
import { ClientManagerState } from '@/client/constants'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { addSchemaToDb, broadcastSchemasInvalidate } from '@/helpers/db'
import { inDefinitionsTransaction, upsertSchemaRow } from '@/db/write/definitions'
import { generateId } from '@/helpers'
import { isInternalSchema } from '@/helpers/constants'
import { DEFAULT_READY_TIMEOUT_MS, waitForEntityIdle } from '@/helpers/waitForEntityIdle'
import { findEntity } from '@/helpers/entity/entityFind'
import { setupEntityLiveQuery } from '@/helpers/entity/entityLiveQuery'
import { unloadEntity } from '@/helpers/entity/entityUnload'
import { ActorKeyedState } from '@/helpers/entity/entityState'
import {
  clearDestroySubscriptions,
  forceRemoveFromCaches,
  runDestroyLifecycle,
} from '@/helpers/entity/entityDestroy'
import { Subscription } from 'rxjs'
import debug from 'debug'
import { currentEvictionEpoch, finishSchemaDestroy, recordSchemaDestroy } from '@/helpers/entity/evictionEpoch'

const logger = debug('seedSdk:schema:saveNewVersion')
const saveDraftLogger = debug('seedSdk:schema:saveDraftToDb')

type SchemaService = ActorRefFrom<typeof schemaMachine>
type SchemaSnapshot = SnapshotFrom<typeof schemaMachine>

// Non-serializable resources per Schema instance (subscriptions, timers, etc.)
export const schemaInstanceState = new ActorKeyedState<Schema, {
  liveQuerySubscription: Subscription | null // LiveQuery subscription for cross-instance model updates
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
  /**
   * If true, wait for each schema to reach idle state before returning.
   * @default false
   */
  waitForReady?: boolean
  /**
   * Timeout in ms for waiting for each schema to be ready (when waitForReady is true).
   * @default 5000
   */
  readyTimeout?: number
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
  // Deduplicate concurrent Schema.create(schemaName) calls - prevents many parallel loads for same schema
  private static pendingSchemaByName: Map<string, Promise<Schema>> = new Map()
  protected readonly _service: SchemaService

  $schema?: string
  /** The schema's name (metadata.name). Assigning it renames the schema and saves a draft. */
  name?: string
  version?: number
  metadata?: {
    name: string
    createdAt: string
    updatedAt: string
  }
  _models?: Model[] // Internal models array (use getter for public access)
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

    // Initialize instance state in WeakMap (only non-serializable resources)
    schemaInstanceState.set(this, {
      liveQuerySubscription: null,
    })
    
    // Set up liveQuery subscription for cross-instance model updates
    // This will be initialized once we have the schemaId
    this._setupLiveQuerySubscription()

    // Subscribe to schema context changes to update cache keys when schemaFileId becomes available
    this._service.subscribe((snapshot) => {
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

  /**
   * Returns the cached schema for `schemaName`, or loads it (creating a draft for an unknown name).
   * Each call takes a hold on the instance; release it with `unload()`.
   */
  static create(
    schemaName: string,
    options: {
      waitForReady: false
      /** @internal SDK lookups pass false: see the implementation signature */
      hold?: false
    },
  ): Schema
  static create(
    schemaName: string,
    options?: {
      waitForReady?: true
      readyTimeout?: number
      /** @internal SDK lookups pass false: see the implementation signature */
      hold?: false
    },
  ): Promise<Schema>
  static create(
    schemaName: string,
    options?: CreateWaitOptions & {
      /**
       * @internal false for SDK code that only looks the schema up: no hold is taken, and a schema
       * loaded here is cached with none, so its users' last unload still stops it.
       */
      hold?: false
    },
  ): Schema | Promise<Schema> {
    if (!schemaName) {
      throw new Error('Schema name is required')
    }

    const waitForReady = options?.waitForReady !== false
    const readyTimeout = options?.readyTimeout ?? DEFAULT_READY_TIMEOUT_MS

    const holds = options?.hold === false ? 0 : 1

    // First, check if we have an instance cached by name
    const cached = this.instanceCacheByName.get(schemaName)
    if (cached) {
      cached.refCount += holds
      const { instance } = cached
      if (!waitForReady) return instance
      return waitForEntityIdle(instance, { timeout: readyTimeout }).then(
        () => instance,
      )
    }

    // Deduplicate concurrent creates for same schema (prevents many parallel loads).
    // The name cache is set before a pending load is recorded, so a hold was already taken above.
    if (waitForReady) {
      const pending = this.pendingSchemaByName.get(schemaName)
      if (pending) {
        return pending
      }
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
            
            // A schema still loading would overwrite the update with what it loads: send it once idle
            if (wasServiceStopped || snapshot.value === 'loading') {
              waitForEntityIdle(instance).then(
                () => instance._service.send(updateEvent),
                () => logger(`Schema failed to load, cannot rename it to "${newName}"`),
              )
            } else {
              instance._service.send(updateEvent)
            }
            
            // Mark schema as draft when name changes
            instance._service.send({
              type: 'markAsDraft',
              propertyKey: 'schema:name', // Special key for schema name changes
            })
            
            // Save draft to database immediately so changes persist
            saveDraftLogger(`Name change detected, calling _saveDraftToDb (oldName: "${oldName}", newName: "${newName}")`)
            trackDraftSave(instance._service, instance._saveDraftToDb(oldName, newName), `Schema "${newName}"`)
          } else {
            logger(`Schema name unchanged: "${oldName}"`)
          }
        } else if (prop === 'models') {
          // Models are read-only, computed from Model instances. Array assignment was removed because
          // the draft save could run before the new Model instances existed, losing them.
          throw new Error(
            'Cannot set schema.models directly. Models are computed from Model instances; ' +
              'use Model.create(modelName, schema, { properties }) to add one.',
          )
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
            trackDraftSave(newInstance._service, newInstance._saveDraftToDb(schemaName, schemaName), `Schema "${schemaName}"`)
          }
        }
      },
    })
    
    // Cache by name initially (will be moved to id-based cache once schemaFileId is available)
    this.instanceCacheByName.set(schemaName, {
      instance: proxiedInstance,
      refCount: holds,
    })
    const schema = proxiedInstance as Schema
    if (!waitForReady) return schema
    const readyPromise = waitForEntityIdle(schema, { timeout: readyTimeout }).then(
      () => schema,
    )
    this.pendingSchemaByName.set(schemaName, readyPromise)
    // Clear on both outcomes without a .finally() chain: that derived promise would reject unhandled
    // whenever readyPromise does, even when the caller handles the rejection.
    const clearPending = () => {
      this.pendingSchemaByName.delete(schemaName)
    }
    readyPromise.then(clearPending, clearPending)
    return readyPromise
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
    // Keep it in both caches for efficient lookups, as one entry: one hold count for both keys
    if (this.instanceCacheByName.has(schemaName)) {
      const cacheEntry = this.instanceCacheByName.get(schemaName)!
      // Add to ID cache (don't remove from name cache)
      this.instanceCacheById.set(schemaFileId, cacheEntry)
      logger(`Added schema cache entry to id "${schemaFileId}" (kept in name cache: "${schemaName}")`)
    }
  }

  /**
   * Get schema instance by schemaFileId (preferred method)
   * Returns null if not found in cache
   */
  static getById(schemaFileId: string): Schema | null {
    const entry = this.instanceCacheById.get(schemaFileId)
    if (!entry) return null
    entry.refCount += 1
    return entry.instance
  }

  /**
   * The cached schema with this file id or name, without taking a hold. For SDK code that reads
   * the schema and doesn't hand it to a caller; callers that keep it use `create` or `find`.
   */
  static peek(schemaFileIdOrName: string): Schema | undefined {
    return (
      this.instanceCacheById.get(schemaFileIdOrName)?.instance ??
      this.instanceCacheByName.get(schemaFileIdOrName)?.instance
    )
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
      } catch {
        // Ignore errors during cleanup (instance might already be unloaded)
      }
    }
    
    // Clear both caches and pending map
    this.instanceCacheById.clear()
    this.instanceCacheByName.clear()
    this.pendingSchemaByName.clear()
  }

  /**
   * Create or get schema instance by schemaFileId
   * Queries the database to find the schema name if not cached
   * @param schemaFileId - The schema file ID
   * @returns Schema instance, with a hold taken (unless `hold: false`)
   */
  static async createById(
    schemaFileId: string,
    /** @internal `hold: false` as for `create` */
    options?: { hold?: false },
  ): Promise<Schema> {
    if (!schemaFileId) {
      throw new Error('Schema file ID is required')
    }

    // First, check if we have an instance cached by ID
    const cachedInstance = options?.hold === false ? this.peek(schemaFileId) : this.getById(schemaFileId)
    if (cachedInstance) {
      return cachedInstance
    }

    // Query database to get schema name from ID
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
    return this.create(schemaName, options?.hold === false ? { hold: false } : undefined)
  }

  /**
   * Find a schema by schemaFileId or by name. Read-only: a name with no schema row gives undefined
   * and creates nothing (`Schema.create` creates a draft for an unknown name). By name, the cached
   * instance is used, else the stored schema is loaded. Waits for the schema to be fully loaded
   * (idle state) by default. Takes a hold unless `hold: false`.
   * @returns Schema instance if found, undefined otherwise
   */
  static async find({
    schemaFileId,
    schemaName,
    waitForReady = true,
    readyTimeout = DEFAULT_READY_TIMEOUT_MS,
    hold,
  }: {
    waitForReady?: boolean
    readyTimeout?: number
    /** @internal `hold: false` as for `create` */
    hold?: false
  } & ({ schemaFileId: string; schemaName?: undefined } | { schemaName: string; schemaFileId?: undefined })): Promise<
    Schema | undefined
  > {
    if (schemaName) {
      return this.findByName(schemaName, { waitForReady, readyTimeout, hold })
    }
    if (!schemaFileId) {
      return undefined
    }

    try {
      return await findEntity<Schema>(
        {
          getById: (id) => (hold === false ? Schema.peek(id) : (Schema.getById(id) ?? undefined)),
          createById: (id) => Schema.createById(id, hold === false ? { hold: false } : undefined),
        },
        { id: schemaFileId },
        {
          waitForReady,
          readyTimeout,
        }
      )
    } catch {
      return undefined
    }
  }

  private static async findByName(
    schemaName: string,
    options: { waitForReady: boolean; readyTimeout: number; hold?: false },
  ): Promise<Schema | undefined> {
    const createOptions = { readyTimeout: options.readyTimeout, ...(options.hold === false && { hold: false as const }) }
    const loadOrCached = () =>
      options.waitForReady
        ? this.create(schemaName, { ...createOptions, waitForReady: true })
        : this.create(schemaName, { ...createOptions, waitForReady: false })
    if (this.instanceCacheByName.has(schemaName)) return loadOrCached()

    const db = BaseDb.getAppDb()
    if (!db) return undefined
    const rows = await db
      .select({ id: schemasTable.id })
      .from(schemasTable)
      .where(eq(schemasTable.name, schemaName))
      .limit(1)
    if (rows.length === 0) return undefined
    return loadOrCached()
  }

  /**
   * Get instantiated Schema objects for all schemas (from database and files)
   * By default, returns only the latest version of each schema and excludes the internal Seed Protocol schema.
   * Uses loadAllSchemasFromDb() as the single source of truth, which intelligently merges database and file data.
   * Takes no holds on the instances it returns: a caller that keeps one uses `Schema.create` or `Schema.find`.
   * 
   * @param options - Configuration options
   * @param options.includeAllVersions - If true, returns all versions of each schema. Default: false
   * @param options.includeInternal - If true, includes the internal Seed Protocol schema. Default: false
   * @returns Array of Schema instances
   */
  static async all(options: SchemaAllOptions = {}): Promise<Schema[]> {
    const {
      includeAllVersions = false,
      includeInternal = false,
      waitForReady = false,
      readyTimeout = DEFAULT_READY_TIMEOUT_MS,
    } = options
    
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
      // First check if we have a cached instance by schemaFileId. Schema.all takes no holds: it
      // lists schemas (useSchemas caches the list and never unloads it).
      if (schemaFileId) {
        const cachedById = this.peek(schemaFileId)
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
          const instance = await this.createById(schemaFileId, { hold: false })
          schemaInstances.push(instance)
        } catch {
          // Fallback to creating by name if createById fails
          schemaInstances.push(this.create(schemaName, { waitForReady: false, hold: false }))
        }
      } else {
        schemaInstances.push(this.create(schemaName, { waitForReady: false, hold: false }))
      }
    }

    if (waitForReady && schemaInstances.length > 0) {
      await Promise.all(
        schemaInstances.map((s) =>
          waitForEntityIdle(s as Parameters<typeof waitForEntityIdle>[0], {
            timeout: readyTimeout,
          }),
        ),
      )
    }

    return schemaInstances
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
    const schemaName = context.schemaName

    // Get model IDs from service context (reactive state)
    const liveQueryIds = context._liveQueryModelIds || []

    // Get pending model IDs (not yet in DB)
    // Note: schemaId lookup is async, so we skip pending IDs here
    // They will be included when schemaId is available asynchronously
    const pendingIds: string[] = []

    // Combine and deduplicate
    const allModelIds = [...new Set([...liveQueryIds, ...pendingIds])]

    // Get Model instances from static cache (from schema load)
    const seen = new Set<string>()
    const modelInstances: Model[] = []
    for (const modelFileId of allModelIds) {
      const model = Model.peek(modelFileId)
      if (model && modelFileId && !seen.has(modelFileId)) {
        modelInstances.push(model)
        seen.add(modelFileId)
      }
    }

    // Include models created at runtime via Model.create() that belong to this schema
    // (they may not be in _liveQueryModelIds until schema context is updated)
    if (schemaName) {
      const cachedForSchema = Model.getCachedInstancesForSchema(schemaName)
      for (const model of cachedForSchema) {
        const id = model.id
        if (id && !seen.has(id)) {
          modelInstances.push(model)
          seen.add(id)
        }
      }
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

  /**
   * The error from the last draft save that an assignment started (e.g. `schema.name = ...`),
   * such as a ConflictError; undefined once a later one succeeds.
   */
  get lastSaveError(): Error | undefined {
    return getDraftSaveError(this._service)
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
    // Validate the loaded schema, not the empty context of one still loading
    await waitForEntityIdle(this, { throwOnError: false })
    this._service.send({ type: 'validateSchema' })
    const errors = this._getSnapshotContext()._validationErrors || []
    return { isValid: errors.length === 0, errors }
  }


  /**
   * Build the file-format `models` object from this schema's Model instances: every model
   * (those created at runtime too), each property as its file definition ({ id, type, model,
   * ref, refValueType, required, storage, validation, ... }).
   */
  private async _buildModelsFromInstances(): Promise<SchemaFileFormat['models']> {
    const context = this._getSnapshotContext()
    const { convertPropertyToSchemaUpdate } = await import('@/helpers/updateSchema')
    const models: SchemaFileFormat['models'] = {}

    for (const modelInstance of this.models) {
      try {
        const modelName = modelInstance.modelName
        if (!modelName) continue

        const properties: SchemaFileFormat['models'][string]['properties'] = {}
        let propertyContexts: any[] = (modelInstance.properties ?? []).map(
          (property: any) => property.getService().getSnapshot().context,
        )
        // model.properties can still be empty for a model created at runtime (the browser fills
        // it from a live query): read the rows, preferring each row's cached instance.
        const modelDbId = (modelInstance.getService().getSnapshot().context as { _dbId?: number })._dbId
        const db = BaseDb.getAppDb()
        if (propertyContexts.length === 0 && modelDbId && db) {
          const { ModelProperty } = await import('../ModelProperty/ModelProperty')
          const rows = await db.select().from(propertiesTable).where(eq(propertiesTable.modelId, modelDbId))
          propertyContexts = rows.map((row: typeof propertiesTable.$inferSelect) => {
            const cached = row.schemaFileId ? ModelProperty.getById(row.schemaFileId) : undefined
            return cached
              ? cached.getService().getSnapshot().context
              : {
                  ...row,
                  id: row.schemaFileId ?? undefined,
                  refModelId: row.refModelId ?? undefined,
                  refValueType: row.refValueType ?? undefined,
                  storageType: row.storageType ?? undefined,
                  localStorageDir: row.localStorageDir ?? undefined,
                  filenameSuffix: row.filenameSuffix ?? undefined,
                }
          })
        }
        const contextModel = context.models?.[modelName]
        const fromContext = contextModel?.properties
        // nameMatch lives only in the schema file (ADR 0009): keep each property's, found by id
        // first so a renamed property keeps it.
        const contextNameMatch = (ctx: { id?: string; name: string }) => {
          const defs = Object.values(fromContext ?? {}) as { id?: string; nameMatch?: unknown }[]
          const def = (ctx.id ? defs.find((d) => d?.id === ctx.id) : undefined) ?? fromContext?.[ctx.name]
          return def?.nameMatch
        }
        for (const ctx of propertyContexts) {
          if (!ctx.name) continue
          const { updates } = await convertPropertyToSchemaUpdate(ctx as any, modelName, ctx.name)
          const nameMatch = contextNameMatch(ctx)
          properties[ctx.name] = {
            ...(ctx.id ? { id: ctx.id } : {}),
            ...updates,
            ...(ctx.validation ? { validation: ctx.validation } : {}),
            ...(ctx.htmlEmbeddedDataUriPolicy ? { htmlEmbeddedDataUriPolicy: ctx.htmlEmbeddedDataUriPolicy } : {}),
            ...(nameMatch !== undefined ? { nameMatch } : {}),
          }
        }

        // No property instances loaded for this model: keep the definitions the schema has.
        models[modelName] = {
          ...(modelInstance.id ? { id: modelInstance.id } : {}),
          ...(contextModel?.nameMatch !== undefined ? { nameMatch: contextModel.nameMatch } : {}),
          properties: Object.keys(properties).length > 0 || !fromContext ? properties : fromContext,
        }
      } catch (error) {
        logger(`Error building model from instance: ${error instanceof Error ? error.message : String(error)}`)
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
    const modelsFromInstances = await this._buildModelsFromInstances()
    
    const currentSchema: SchemaFileFormat = {
      id: context.id,
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
      ...(context.nameMatch !== undefined && { nameMatch: context.nameMatch }),
    }

    // Check we have something to save: schema:models (new models) or modelName:propertyName (property edits)
    const hasSchemaModels = context._editedProperties.has('schema:models')
    const hasPropertyEdits = [...context._editedProperties].some((key) => {
      const [modelName, propertyName] = key.split(':')
      return modelName && propertyName && key !== 'schema:name'
    })
    if (!hasSchemaModels && !hasPropertyEdits) {
      logger('No valid property updates to save')
      return ''
    }

    // The draft row holds the current state until the version file is written
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

    // The next version file: the previous one with the instances' models merged in by id, so
    // fields the instances don't carry (validation, descriptions, ...) stay. Applying it publishes
    // the row.
    const { schemaFile: publishedSchema, filePath: newFilePath } = await writeNextSchemaVersion(
      currentSchema.id ?? this.schemaName,
      (previous) => mergeSchemaFiles(previous, currentSchema),
      {
        description: 'New schema version (e.g. new models added)',
        changes: [{ type: 'full_schema_write' as const }],
      },
    )
    // Clear edited flags on the cached ModelProperty instances of the edited keys, then on the rows
    // (schema, those properties, the schema's models) in one transaction.
    const modelPropertyMod = await import('../ModelProperty/ModelProperty')
    const { ModelProperty } = modelPropertyMod
    const ModelPropertyClass = ModelProperty as typeof ModelProperty & {
      instanceCache: Map<string, { instance: InstanceType<typeof ModelProperty>; refCount: number }>
    }
    const thisSchemaName = this.schemaName
    const clearedKeys: Array<{ modelName: string; propertyName: string }> = []
    for (const propertyKey of context._editedProperties) {
      const [modelName, propertyName] = propertyKey.split(':')
      if (!modelName || !propertyName) continue
      // Model names are only unique per schema: pick this schema's instance, which may be keyed by id.
      const cachedInstance = [...ModelPropertyClass.instanceCache.values()].find(({ instance }) => {
        const ctx = instance.getService().getSnapshot().context
        return (
          ctx.modelName === modelName &&
          ctx.name === propertyName &&
          (!ctx._schemaName || ctx._schemaName === thisSchemaName)
        )
      })
      if (!cachedInstance) continue
      cachedInstance.instance.getService().send({ type: 'clearEdited' })
      clearedKeys.push({ modelName, propertyName })
    }

    const { resolveModelRecord } = await import('../db/read/resolveModelRecord')
    await inDefinitionsTransaction(async (tx) => {
      await tx
        .update(schemasTable)
        .set({ isEdited: false })
        .where(eq(schemasTable.schemaFileId, publishedSchema.id!))
      for (const { modelName, propertyName } of clearedKeys) {
        const modelRecord = await resolveModelRecord(modelName, { schemaName: thisSchemaName }, tx)
        if (!modelRecord) continue
        await tx
          .update(propertiesTable)
          .set({ isEdited: false })
          .where(and(eq(propertiesTable.name, propertyName), eq(propertiesTable.modelId, modelRecord.id)))
      }
      if (context._dbId) {
        const linked = tx
          .select({ id: modelSchemas.modelId })
          .from(modelSchemas)
          .where(eq(modelSchemas.schemaId, context._dbId))
        await tx.update(modelsTable).set({ isEdited: false }).where(inArray(modelsTable.id, linked))
      }
    })

    // Clear draft flags on Schema and update conflict detection metadata
    this._service.send({ 
      type: 'clearDraft',
      _dbUpdatedAt: new Date(publishedSchema.metadata.updatedAt).getTime(),
      _dbVersion: publishedSchema.version,
      savedSchema: publishedSchema,
    } as any)

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
      // Cleared once the reload settles: a pending timer kept Node scripts alive for 10 s.
      const timer = setTimeout(() => {
        subscription.unsubscribe()
        reject(new Error('Timeout waiting for schema reload'))
      }, 10000)
      const subscription = this._service.subscribe((snapshot) => {
        if (snapshot.value === 'idle') {
          clearTimeout(timer)
          subscription.unsubscribe()
          resolve()
        } else if (snapshot.value === 'error') {
          clearTimeout(timer)
          subscription.unsubscribe()
          reject(new Error('Failed to reload schema from database'))
        }
      })
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
    
    const initialContext = this._getSnapshotContext()
    // schemaFileId when known, else the name
    const saveKey = initialContext.id || newName || initialContext.schemaName || oldName || ''

    // A save started while another for this schema runs waits for it, so renames land in order.
    await queueDraftSave(saveKey, async () => {
      const conflictCheck = await this._checkForConflicts()
      if (conflictCheck.hasConflict) {
        const errorMessage = conflictCheck.message || 'Database was updated externally. Please reload the schema and try again.'
        saveDraftLogger(`CONFLICT DETECTED: ${errorMessage}`)
        throw new ConflictError(errorMessage, conflictCheck)
      }

      // Get context - if service is stopped, build it from what we know
      let context: SchemaMachineContext
      try {
        context = this._getSnapshotContext()
      } catch {
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

      const db = BaseDb.getAppDb()
      if (!db) {
        throw new Error('Database not found')
      }

      const finalNewName = newName || context.schemaName || this.schemaName
      const isRename = !!oldName && oldName !== finalNewName

      // The row: by schemaFileId, else by name (the old name for a rename, preferring a draft).
      let existingSchemaRecord: typeof schemasTable.$inferSelect | undefined
      if (context.id) {
        ;[existingSchemaRecord] = await db
          .select()
          .from(schemasTable)
          .where(eq(schemasTable.schemaFileId, context.id))
          .limit(1)
      }
      if (!existingSchemaRecord) {
        const byName = await db
          .select()
          .from(schemasTable)
          .where(eq(schemasTable.name, isRename ? oldName! : finalNewName))
          .limit(10)
        existingSchemaRecord =
          (isRename ? byName.find((row: typeof schemasTable.$inferSelect) => row.isDraft === true) : undefined) ?? byName[0]
      }

      // A published schema's rename is its next version file, under the new name (ADR 0016).
      // A row-only rename was undone at the next init, which matched the files by their old name.
      if (isRename && existingSchemaRecord?.schemaFileId && existingSchemaRecord.isDraft !== true) {
        const { schemaFile } = await writeNextSchemaVersion(
          existingSchemaRecord.schemaFileId,
          (previous) => ({ ...previous, metadata: { ...previous.metadata, name: finalNewName } }),
          {
            description: `Renamed schema ${oldName} to ${finalNewName}`,
            changes: [{ type: 'schema_rename', oldName: oldName!, newName: finalNewName }],
          },
        )
        const savedAt = new Date(schemaFile.metadata.updatedAt).getTime()
        this._service.send({
          type: 'updateContext',
          id: schemaFile.id,
          version: schemaFile.version,
          _dbUpdatedAt: savedAt,
          _dbVersion: schemaFile.version,
        })
        const otherEdits = [...(context._editedProperties ?? [])].some((key) => key !== 'schema:name')
        if (!otherEdits) {
          saveDraftLogger(`Renamed schema "${oldName}" to "${finalNewName}" in v${schemaFile.version}`)
          return
        }
        // Other edits stay a draft of the new version
        context = this._getSnapshotContext()
        ;[existingSchemaRecord] = await db
          .select()
          .from(schemasTable)
          .where(eq(schemasTable.schemaFileId, existingSchemaRecord.schemaFileId))
          .limit(1)
      }

      if (isRename && !existingSchemaRecord) {
        throw new Error(`Cannot update schema name: existing schema with name "${oldName}" not found in database`)
      }

      // The database's schemaFileId is the schema's id
      const finalSchemaFileId = existingSchemaRecord?.schemaFileId || context.id || generateId()
      const currentMetadata = context.metadata
        ? { ...context.metadata, name: finalNewName, updatedAt: new Date().toISOString() }
        : { name: finalNewName, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }

      // Model instances are the source of truth for model data
      const modelsFromInstances = await this._buildModelsFromInstances()
      const currentSchema: SchemaFileFormat = {
        $schema: context.$schema || 'https://seedprotocol.org/schemas/data-model/v1',
        version: context.version || 1,
        id: finalSchemaFileId,
        metadata: currentMetadata,
        models: modelsFromInstances,
        enums: context.enums || {},
        migrations: context.migrations || [],
        ...(context.nameMatch !== undefined && { nameMatch: context.nameMatch }),
      }

      // A rename writes the row it found under the old name; other saves find the row by id or name.
      const { inserted } = await inDefinitionsTransaction((tx) =>
        upsertSchemaRow(
          tx,
          {
            name: finalNewName,
            version: currentSchema.version,
            createdAt: new Date(currentSchema.metadata.createdAt).getTime(),
            updatedAt: new Date(currentSchema.metadata.updatedAt).getTime(),
            schemaFileId: finalSchemaFileId,
            schemaData: JSON.stringify(currentSchema, null, 2),
            isDraft: true,
          },
          isRename ? { rowId: existingSchemaRecord!.id } : {},
        ),
      )
      if (inserted) broadcastSchemasInvalidate()

      try {
        if (this._service.getSnapshot().status !== 'stopped') {
          this._service.send({
            type: 'updateContext',
            ...(isRename && { id: finalSchemaFileId }),
            _dbUpdatedAt: new Date(currentSchema.metadata.updatedAt).getTime(),
            _dbVersion: currentSchema.version,
          })
        }
      } catch {
        // Service might be stopped, ignore
      }
      saveDraftLogger(`Saved draft schema "${finalNewName}" (key: ${saveKey})`)
    })
  }


  /**
   * Force-evict the cached Schema instance(s) named `schemaName`, ignoring refCounts: stop their live
   * query and service. Schema.destroy does the same for itself. For code that deletes a schema's rows
   * without destroying it (test cleanup): a live Schema keeps re-creating its models from its live
   * query while their rows are being deleted.
   */
  static evict(schemaName: string): void {
    const instances = new Set<Schema>()
    for (const { instance } of Schema.instanceCacheById.values()) instances.add(instance)
    for (const { instance } of Schema.instanceCacheByName.values()) instances.add(instance)
    for (const instance of instances) {
      let context: SchemaMachineContext
      try {
        context = instance._getSnapshotContext()
      } catch {
        continue
      }
      if (context.schemaName !== schemaName) continue
      clearDestroySubscriptions(instance, {
        instanceState: schemaInstanceState,
        onUnload: () => schemaInstanceState.delete(instance),
      })
      forceRemoveFromCaches(instance, {
        getCacheKeys: () => [context.id, context.schemaName].filter((k): k is string => !!k),
        caches: [
          Schema.instanceCacheById as Map<string, unknown>,
          Schema.instanceCacheByName as Map<string, unknown>,
        ],
      })
      try {
        instance._service.stop()
      } catch {
        // Service might already be stopped
      }
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
          if (context.schemaName) Model.releaseSchemaHolds(context.schemaName)
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
   * Destroy the schema instance completely: remove from caches, delete from database (cascade),
   * and stop the service. Uses shared destroy helpers.
   */
  async destroy(): Promise<void> {
    const context = this._getSnapshotContext()
    const schemaFileId = context.id
    const schemaName = context.schemaName

    clearDestroySubscriptions(this, {
      instanceState: schemaInstanceState,
      onUnload: () => schemaInstanceState.delete(this),
    })

    const cacheKeys: string[] = []
    if (schemaFileId) cacheKeys.push(schemaFileId)
    if (schemaName) cacheKeys.push(schemaName)
    forceRemoveFromCaches(this, {
      getCacheKeys: () => cacheKeys,
      caches: [
        Schema.instanceCacheById as Map<string, unknown>,
        Schema.instanceCacheByName as Map<string, unknown>,
      ],
    })

    // Until its rows are gone, nothing may re-create this schema's models. Its own actor stays live
    // till then, and its live query reacting to destroyStarted could read a model row the drained
    // write had just landed and re-create (and re-write) that model after the delete below.
    if (schemaName) recordSchemaDestroy(schemaName)
    try {
      await this._destroyRows(schemaFileId, schemaName, context.metadata?.name)
    } finally {
      if (schemaName) finishSchemaDestroy(schemaName)
    }
  }

  private async _destroyRows(
    schemaFileId: string | undefined,
    schemaName: string | undefined,
    metadataName: string | undefined,
  ): Promise<void> {
    // The rows for this schema's models and properties are deleted below; evict their cached
    // instances too, or a re-import would get them back with dangling _dbIds.
    if (schemaName) {
      const evictedModelNames = Model.evictForSchema(schemaName)
      const { ModelProperty } = await import('../ModelProperty/ModelProperty')
      ModelProperty.evictForModels(evictedModelNames, schemaName)
      // Evicting stops new writes but not ones already running; let those land before deleting their rows
      const { waitForInFlightWrites } = await import('../db/write/saveDefinition')
      await waitForInFlightWrites()
    }

    await runDestroyLifecycle(this, {
      getService: (instance) =>
        instance._service as { send: (ev: unknown) => void; stop: () => void },
      doDestroy: async () => {
        const db = BaseDb.getAppDb()
        if (!db || !schemaFileId) return

        const { detachModelRows } = await import('@/helpers/entity/detachRowsBeforeDelete')
        // The schema's rows go together or not at all
        const deleted = await inDefinitionsTransaction(async (tx) => {
          const schemaRecords = await tx
            .select({ id: schemasTable.id })
            .from(schemasTable)
            .where(eq(schemasTable.schemaFileId, schemaFileId))

          if (schemaRecords.length === 0) return false

          const schemaIds = schemaRecords
            .map((r: { id: number | null }) => r.id)
            .filter((id: number | null): id is number => id != null)
          if (schemaIds.length === 0) return false

          const joinRows = await tx
            .select({ modelId: modelSchemas.modelId })
            .from(modelSchemas)
            .where(inArray(modelSchemas.schemaId, schemaIds))
          const modelIds = [
            ...new Set(
              joinRows
                .map((r: { modelId: number | null }) => r.modelId)
                .filter((id: number | null): id is number => id != null),
            ),
          ] as number[]

          await detachModelRows(tx, modelIds)

          await tx.delete(modelSchemas).where(inArray(modelSchemas.schemaId, schemaIds))

          for (const modelId of modelIds) {
            await tx.delete(propertiesTable).where(eq(propertiesTable.modelId, modelId))
          }
          for (const modelId of modelIds) {
            await tx.delete(modelsTable).where(eq(modelsTable.id, modelId))
          }
          await tx.delete(schemasTable).where(eq(schemasTable.schemaFileId, schemaFileId))
          return true
        })
        if (!deleted) return

        // Delete the SDK's own copies of this schema's files (all versions) in the working dir.
        // loadAllSchemasFromDb imports any schema file without a DB row, so leaving them brought
        // the destroyed schema back on the next Schema.all().
        // Match on name as well as id: versions imported from complete schema files can each
        // have their own id, and any version left behind would bring the schema back.
        const { listCompleteSchemaFiles } = await import('@/helpers/schema')
        const files = await listCompleteSchemaFiles().catch(() => [])
        const fs = await BaseFileManager.getFs()
        const names = new Set([schemaName, metadataName].filter(Boolean))
        for (const file of files) {
          if (file.schemaFileId === schemaFileId || names.has(file.name)) {
            await fs.promises.unlink(file.filePath).catch(() => {})
          }
        }
      },
    })
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
            .where(eq(modelSchemas.schemaId, typeof schemaId === 'string' ? parseInt(schemaId, 10) : schemaId))
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
        // One at a time: an eviction of this schema part way through stops the rest
        const evictionEpoch = currentEvictionEpoch()
        for (const id of ids) {
          await Model.createById(id, { evictionEpoch, hold: false })
        }
      },
      queryInitialData: async (schemaId) => {
        const db = BaseDb.getAppDb()
        if (!db) {
          return []
        }

        // The schema is idle, so its load (and any import it waited for) wrote these rows already
        const initialModels = await db
          .select({
            modelId: modelSchemas.modelId,
            modelName: modelsTable.name,
            modelFileId: modelsTable.schemaFileId,
          })
          .from(modelSchemas)
          .innerJoin(modelsTable, eq(modelSchemas.modelId, modelsTable.id))
          .where(eq(modelSchemas.schemaId, typeof schemaId === 'string' ? parseInt(schemaId, 10) : schemaId))
        return initialModels.map((row: { modelId: number; modelName: string; modelFileId: string | null }) => ({
          modelId: row.modelId,
          modelName: row.modelName,
          modelFileId: row.modelFileId || '',
        }))
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