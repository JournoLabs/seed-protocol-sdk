import { ActorRefFrom, createActor, SnapshotFrom } from 'xstate'
import { immerable } from 'immer'
import { schemaMachine, SchemaMachineContext } from './service/schemaMachine'
import { listCompleteSchemaFiles, listLatestSchemaFiles } from '@/helpers/schema'
import { updateModelProperties, convertPropertyToSchemaUpdate } from '@/helpers/updateSchema'
import { ModelProperty } from '@/ModelProperty/ModelProperty'
import { Model } from '@/schema/model/Model'
import { SchemaFileFormat } from '@/types/import'
import { BaseDb } from '@/db/Db/BaseDb'
import { schemas as schemasTable } from '@/seedSchema/SchemaSchema'
import { eq } from 'drizzle-orm'
import { addSchemaToDb, renameModelInDb } from '@/helpers/db'
import { createReactiveProxy } from '@/helpers/reactiveProxy'
import debug from 'debug'

const logger = debug('seedSdk:schema:saveNewVersion')
const contextLogger = debug('seedSdk:schema:updateClientContext')

type SchemaService = ActorRefFrom<typeof schemaMachine>
type SchemaSnapshot = SnapshotFrom<typeof schemaMachine>

// WeakMap to store mutable state per Schema instance
// This avoids issues with read-only properties when instances are frozen by Immer
const schemaInstanceState = new WeakMap<Schema, {
  lastContextUpdate: number
  contextUpdateTimeout: ReturnType<typeof setTimeout> | null
  lastContextHash: string | null
  cacheKeyUpdated: boolean // Track if cache key has been updated to avoid repeated calls
  lastModelsHash: string | null // Track models hash to avoid unnecessary Model instance updates
  modelInstances: Map<string, Model> // Store Model instances here to avoid Immer freezing
  isClientInitialized: boolean | null // Cache client initialization state to avoid repeated checks
}>()

// Cache client initialization state globally to avoid repeated checks
let cachedClientInitialized: boolean | null = null
let clientCheckTime: number = 0
const CLIENT_CHECK_CACHE_MS = 100 // Cache for 100ms to avoid excessive checks

// Define tracked properties for the Proxy
// These properties will be read from/written to the actor context
const TRACKED_PROPERTIES = [
  '$schema',
  'version',
  'metadata',
  'enums',
  'migrations',
  'models',
  'name',        // metadata.name (flattened)
  'createdAt',   // metadata.createdAt (flattened)
  'updatedAt',   // metadata.updatedAt (flattened)
] as const

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
  declare [immerable]: boolean

  $schema?: string
  version?: number
  metadata?: {
    name: string
    createdAt: string
    updatedAt: string
  }
  models?: Array<{
    name: string
    description?: string
    properties: {
      [propertyName: string]: any
    }
    indexes?: string[]
  }>
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
    // Set immerable in constructor to ensure 'this' is properly bound
    this[immerable] = true
    
    const serviceInput: Pick<SchemaMachineContext, 'schemaName'> = {
      schemaName,
    }

    this._service = createActor(schemaMachine as any, {
      input: serviceInput,
    }) as SchemaService

    this._service.start()

    // Initialize instance state in WeakMap (avoids read-only property issues with Immer)
    schemaInstanceState.set(this, {
      lastContextUpdate: 0,
      contextUpdateTimeout: null,
      lastContextHash: null,
      cacheKeyUpdated: false,
      lastModelsHash: null,
      modelInstances: new Map<string, Model>(),
      isClientInitialized: null,
    })

    // Subscribe to schema context changes to keep client context in sync
    // This ensures useSchema and useSchemas hooks reflect schema changes
    this._service.subscribe((snapshot) => {
      // Update client context when schema is loaded or when in idle state with metadata
      if (snapshot.value === 'idle' && snapshot.context.metadata?.name) {
        // Only update if client is fully initialized (prevents loops during initialization)
        // Use cached check to avoid expensive synchronous require() calls on every snapshot
        if (typeof window !== 'undefined') {
          const now = Date.now()
          // Check cache first (refresh every 100ms)
          if (cachedClientInitialized === null || (now - clientCheckTime) > CLIENT_CHECK_CACHE_MS) {
            try {
              const { getClient } = require('@/client/ClientManager')
              const { ClientManagerState } = require('@/services/internal/constants')
              const client = getClient()
              const clientSnapshot = client.getService().getSnapshot()
              cachedClientInitialized = clientSnapshot.value === ClientManagerState.IDLE && clientSnapshot.context.isInitialized
              clientCheckTime = now
            } catch (error) {
              // If we can't check client state, assume not initialized to be safe
              cachedClientInitialized = false
              clientCheckTime = now
            }
          }
          
          if (!cachedClientInitialized) {
            return // Skip updates during initialization
          }
        }
        
        // Get instance state from WeakMap (avoids read-only property issues)
        const instanceState = schemaInstanceState.get(this)
        if (!instanceState) return
        
        // Create a hash of the relevant context fields to detect actual changes
        // Only track fields that affect the schema content (not internal state)
        const contextHash = JSON.stringify({
          $schema: snapshot.context.$schema,
          version: snapshot.context.version,
          metadata: snapshot.context.metadata,
          models: snapshot.context.models,
          enums: snapshot.context.enums,
          migrations: snapshot.context.migrations,
        })
        
        // Update cache to use schemaFileId as key once we have it (only once)
        if (snapshot.context._schemaFileId && !instanceState.cacheKeyUpdated) {
          Schema._updateCacheKey(snapshot.context.schemaName, snapshot.context._schemaFileId)
          instanceState.cacheKeyUpdated = true
        }
        
        // Only process updates if context content has actually changed
        if (instanceState.lastContextHash === contextHash) {
          return
        }
        
        // Update hash immediately to prevent reprocessing the same change
        instanceState.lastContextHash = contextHash
        
        // Create/update Model instances when schema context changes
        // Only update if models actually changed to avoid unnecessary work
        // BUT: Skip during initialization to prevent cascading Schema instance creation
        // (Models will be created on-demand when accessed via Model.create())
        const modelsHash = JSON.stringify(snapshot.context.models || {})
        if (instanceState.lastModelsHash !== modelsHash) {
          instanceState.lastModelsHash = modelsHash
          // Only create model instances after client is fully initialized
          // During initialization, skip to prevent infinite loops from cascading Schema creation
          // The guard above already checked that client is initialized, so it's safe to create models here
          this._updateModelInstances(snapshot.context)
        }
        
        // Debounce updates to avoid too many context updates (max once per 100ms)
        const now = Date.now()
        if (now - instanceState.lastContextUpdate > 100) {
          instanceState.lastContextUpdate = now
          // Clear any pending timeout
          if (instanceState.contextUpdateTimeout) {
            clearTimeout(instanceState.contextUpdateTimeout)
          }
          // Schedule update
          instanceState.contextUpdateTimeout = setTimeout(() => {
            this._updateClientContext().catch(() => {
              // Silently fail if not in browser environment
            })
            instanceState.contextUpdateTimeout = null
          }, 50) // Small delay to batch rapid updates
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
      getContext: () => {
        // Handle special cases like metadata.name, models array conversion
        const context = newInstance._getSnapshotContext()
        return {
          ...context,
          // Flatten metadata properties to top level for convenience
          name: context.metadata?.name,
          createdAt: context.metadata?.createdAt,
          updatedAt: context.metadata?.updatedAt,
          // Return Model instances instead of plain objects
          models: Array.from((schemaInstanceState.get(newInstance)?.modelInstances || new Map()).values()),
        }
      },
      sendUpdate: (prop: string, value: any) => {
        // Handle special property updates
        if (prop === 'name') {
          // Update both metadata.name and schemaName
          const context = newInstance._getSnapshotContext()
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
            const snapshot = newInstance._service.getSnapshot()
            const isServiceStopped = snapshot.status === 'stopped'
            
            if (!isServiceStopped) {
              newInstance._service.send({
                type: 'updateContext',
                schemaName: newName, // Update the schemaName identifier
                metadata: {
                  ...currentMetadata,
                  name: newName,
                  updatedAt: new Date().toISOString(),
                },
              })
              
              // Mark schema as draft when name changes
              newInstance._service.send({
                type: 'markAsDraft',
                propertyKey: 'schema:name', // Special key for schema name changes
              })
            } else {
              logger(`Service is stopped, skipping context update but will still save to database`)
            }
            
            // Save draft to database immediately so changes persist
            newInstance._saveDraftToDb(oldName, newName).catch((error) => {
              logger(`Failed to save draft to database: ${error instanceof Error ? error.message : String(error)}`)
            })
            
            // Update client context so useSchema and useSchemas hooks reflect the change
            newInstance._updateClientContext(newName, oldName)
          } else {
            logger(`Schema name unchanged: "${oldName}"`)
          }
        } else if (prop === 'models') {
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
                  description: model.description,
                  properties: model.properties || {},
                  indexes: model.indexes,
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
          
          newInstance._service.send({
            type: 'updateContext',
            models: modelsObject,
          })
          
          // Update Model instances cache
          newInstance._updateModelInstances({
            ...context,
            models: modelsObject,
          })
          
          // Mark schema as draft when models change
          newInstance._service.send({
            type: 'markAsDraft',
            propertyKey: 'schema:models',
          })
          
          // Save draft to database immediately so changes persist
          newInstance._saveDraftToDb().catch((error) => {
            logger(`Failed to save draft to database: ${error instanceof Error ? error.message : String(error)}`)
          })
          
          // Create Model classes and add to store for new models
          newInstance._addModelsToStore(modelsObject, context.models || {}).catch((error) => {
            logger(`Failed to add models to store: ${error instanceof Error ? error.message : String(error)}`)
          })
          
          // Trigger validation automatically
          newInstance._service.send({ type: 'validateSchema' })
          
          // Update client context so useSchema and useSchemas hooks reflect the change
          newInstance._updateClientContext().catch(() => {
            // Silently fail if not in browser environment
          })
        } else if (prop === 'createdAt' || prop === 'updatedAt') {
          // Update metadata object
          const context = newInstance._getSnapshotContext()
          const currentMetadata = context.metadata || {
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
          newInstance._updateClientContext().catch(() => {
            // Silently fail if not in browser environment
          })
        } else {
          // Standard property update
          newInstance._service.send({
            type: 'updateContext',
            [prop]: value,
          })
        }
      },
    })
    
    // Cache by name initially (will be moved to id-based cache once schemaFileId is available)
    this.instanceCacheByName.set(schemaName, {
      instance: proxiedInstance,
      refCount: 1,
    })
    return proxiedInstance
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
   * Get instantiated Schema objects for all complete schema files
   * Returns one instance per unique schema name (uses latest version if multiple exist)
   * @returns Array of Schema instances
   */
  static async all(): Promise<Schema[]> {
    const completeSchemas = await listCompleteSchemaFiles()
    
    // Get unique schema names (if multiple versions exist, we'll use the latest)
    const uniqueSchemaNames = new Set<string>()
    for (const schema of completeSchemas) {
      uniqueSchemaNames.add(schema.name)
    }
    
    // Create Schema instances for each unique schema name
    const schemaInstances: Schema[] = []
    for (const schemaName of uniqueSchemaNames) {
      schemaInstances.push(this.create(schemaName))
    }
    
    return schemaInstances
  }

  /**
   * Get instantiated Schema objects for only the most recent version of each complete schema file
   * @returns Array of Schema instances (one per schema name, using latest version)
   */
  static async latest(): Promise<Schema[]> {
    const latestSchemas = await listLatestSchemaFiles()
    
    // Create Schema instances for each latest schema
    const schemaInstances: Schema[] = []
    for (const schema of latestSchemas) {
      schemaInstances.push(this.create(schema.name))
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
    return this._getSnapshotContext().schemaName
  }

  get status() {
    return this._getSnapshot().value
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
      const subscription = this._service.subscribe((snapshot) => {
        if (snapshot.value === 'idle' || snapshot.value === 'error') {
          subscription.unsubscribe()
          const errors = snapshot.context._validationErrors || []
          resolve({
            isValid: errors.length === 0,
            errors,
          })
        }
      })

      this._service.send({ type: 'validateSchema' })
    })
  }

  /**
   * Saves all edited properties to a new schema version.
   * This writes the changes to a new JSON file and clears the draft flags.
   * Validates the schema before saving.
   * Transitions schema from draft (DB-only) to published (file + DB).
   * @returns The file path of the new schema version
   */
  async saveNewVersion(): Promise<string> {
    const context = this._getSnapshotContext()
    const { BaseDb } = await import('@/db/Db/BaseDb')
    const { schemas: schemasTable } = await import('@/seedSchema/SchemaSchema')
    const { eq } = await import('drizzle-orm')
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
    const currentSchema: SchemaFileFormat = {
      $schema: context.$schema || 'https://seedprotocol.org/schemas/data-model/v1',
      version: context.version || 1,
      metadata: context.metadata || {
        name: this.schemaName,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      models: context.models || {},
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
      )
    }

    // Clear draft flags on Schema
    this._service.send({ type: 'clearDraft' })

    // Clear edited flags on all ModelProperty instances
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
      }
    }

    logger(`Successfully saved new version for schema ${this.schemaName} and published to file`)
    return newFilePath
  }

  /**
   * Save the current schema state to the database as a draft
   * This persists changes immediately without creating a new file version
   * @param oldName - Optional old name to look up existing record before name change
   * @param newName - Optional new name to use (if not provided, uses this.schemaName)
   */
  private async _saveDraftToDb(oldName?: string, newName?: string): Promise<void> {
    // Don't save during initialization - schemas are being loaded from files, not created as drafts
    // Check this FIRST before doing any expensive work like _getSnapshotContext()
    if (typeof window !== 'undefined') {
      const now = Date.now()
      // Use cached check to avoid expensive operations
      if (cachedClientInitialized === null || (now - clientCheckTime) > CLIENT_CHECK_CACHE_MS) {
        try {
          const { getClient } = require('@/client/ClientManager')
          const { ClientManagerState } = require('@/services/internal/constants')
          const client = getClient()
          const clientSnapshot = client.getService().getSnapshot()
          cachedClientInitialized = clientSnapshot.value === ClientManagerState.IDLE && clientSnapshot.context.isInitialized
          clientCheckTime = now
        } catch (error) {
          // If we can't check client state, assume not initialized to be safe
          cachedClientInitialized = false
          clientCheckTime = now
        }
      }
      
      if (!cachedClientInitialized) {
        // Skip silently during initialization to avoid log spam and reduce overhead
        return
      }
    }
    
    const context = this._getSnapshotContext()
    const schemaName = newName || context.schemaName || oldName || ''
    const schemaFileId = context._schemaFileId || ''
    
    // Use schemaFileId as the key if available, otherwise use schemaName
    const saveKey = schemaFileId || schemaName
    
    // Prevent concurrent saves for the same schema
    if (Schema.savingSchemas.has(saveKey)) {
      logger(`Schema ${schemaName} is already being saved, skipping concurrent save`)
      return
    }
    
    Schema.savingSchemas.add(saveKey)
    
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
      const { eq } = await import('drizzle-orm')

      const db = BaseDb.getAppDb()
      if (!db) {
        throw new Error('Database not found')
      }

      // Use provided newName or fall back to context schemaName (avoid getter which might be stale)
      const finalNewName = newName || context.schemaName || this.schemaName
      // If name changed, we need to look up by old name first, then update with new name
      const lookupName = oldName || finalNewName

      // Try to get existing schema ID from database to preserve it
      // PRIMARY: Look up by schemaFileId (most reliable, independent of name changes)
      // FALLBACK: Look up by old name if name changed, otherwise by current name
      let existingSchemaId: string | undefined
      let existingSchemaRecord: typeof schemasTable.$inferSelect | undefined
      
      // PRIMARY: Look up by schemaFileId if we have it (this is the most reliable way)
      if (context._schemaFileId) {
        logger(`Looking up schema by schemaFileId: ${context._schemaFileId}`)
        const schemasById = await db
          .select()
          .from(schemasTable)
          .where(eq(schemasTable.schemaFileId, context._schemaFileId))
          .limit(1)
        
        if (schemasById.length > 0) {
          const foundRecord = schemasById[0]
          existingSchemaRecord = foundRecord
          existingSchemaId = foundRecord.schemaFileId || context._schemaFileId
          logger(`Found schema by schemaFileId: ${context._schemaFileId} (id: ${foundRecord.id}, name: ${foundRecord.name})`)
        } else {
          logger(`No schema found by schemaFileId: ${context._schemaFileId}`)
        }
      } else {
        logger(`No _schemaFileId in context, will look up by name`)
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
      const schemaFileId = existingSchemaId || context._schemaFileId || generateId()
      const currentSchema: SchemaFileFormat = {
        $schema: context.$schema || 'https://seedprotocol.org/schemas/data-model/v1',
        version: context.version || 1,
        id: schemaFileId, // Preserve existing ID or use context ID, or generate new one
        metadata: context.metadata || {
          name: finalNewName,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        models: context.models || {},
        enums: context.enums || {},
        migrations: context.migrations || [],
      }

      // If name changed, we MUST update the existing record (don't create a new one)
      if (oldName && oldName !== finalNewName) {
        if (existingSchemaRecord && existingSchemaRecord.id) {
          logger(`Updating existing schema record (id: ${existingSchemaRecord.id}) from "${oldName}" to "${finalNewName}"`)
          
          // Update the existing record with the new name
          await db
            .update(schemasTable)
            .set({
              name: finalNewName,
              schemaData: JSON.stringify(currentSchema, null, 2),
              version: currentSchema.version,
              updatedAt: new Date(currentSchema.metadata.updatedAt).getTime(),
            })
            .where(eq(schemasTable.id, existingSchemaRecord.id))
          
          // Update the context's _schemaFileId to ensure it's preserved for future lookups
          try {
            const snapshot = this._service.getSnapshot()
            if (snapshot.status !== 'stopped' && existingSchemaRecord.schemaFileId) {
              this._service.send({
                type: 'updateContext',
                _schemaFileId: existingSchemaRecord.schemaFileId,
              })
            }
          } catch (error) {
            // Service might be stopped, ignore
            logger(`Could not update _schemaFileId in context: ${error instanceof Error ? error.message : String(error)}`)
          }
          
          logger(`Successfully updated schema name from "${oldName}" to "${finalNewName}" in database`)
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
            await db
              .update(schemasTable)
              .set({
                name: finalNewName,
                schemaData: JSON.stringify(currentSchema, null, 2),
                version: currentSchema.version,
                updatedAt: new Date(currentSchema.metadata.updatedAt).getTime(),
              })
              .where(eq(schemasTable.id, foundRecord.id))
            
            // Update context with schemaFileId if available
            try {
              const snapshot = this._service.getSnapshot()
              if (snapshot.status !== 'stopped' && foundRecord.schemaFileId) {
                this._service.send({
                  type: 'updateContext',
                  _schemaFileId: foundRecord.schemaFileId,
                })
              }
            } catch (error) {
              // Service might be stopped, ignore
            }
            
            logger(`Successfully updated schema name from "${oldName}" to "${finalNewName}" in database (found by old name)`)
            return
          }
          
          // If we still can't find it, this is an error - don't create a duplicate
          logger(`ERROR: Could not find existing schema record with name "${oldName}". Cannot update name to "${finalNewName}" without creating a duplicate.`)
          throw new Error(`Cannot update schema name: existing schema with name "${oldName}" not found in database`)
        }
      }

      // If name changed, we should have already updated the record above
      // Only call addSchemaToDb if name didn't change (normal save scenario)
      if (oldName && oldName !== finalNewName) {
        // This should never happen - we should have updated above
        logger(`ERROR: Name changed but update didn't happen. This should not occur.`)
        throw new Error(`Failed to update schema name: existing record not found`)
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

      logger(`Saved draft schema ${finalNewName} to database`)
    } catch (error) {
      logger(`Failed to save draft to database: ${error instanceof Error ? error.message : String(error)}`)
      throw error
    } finally {
      // Always remove from saving set, even if there was an error
      Schema.savingSchemas.delete(saveKey)
    }
  }

  /**
   * Add new models to the store and database
   * This ensures that new models are immediately available for use
   * @param newModels - The new models object
   * @param existingModels - The existing models object (to detect which are new)
   */
  private async _addModelsToStore(
    newModels: { [modelName: string]: any },
    existingModels: { [modelName: string]: any }
  ): Promise<void> {
    try {
      // Only process in browser environment where store is available
      if (typeof window === 'undefined') {
        return
      }

      const { setModel } = await import('@/stores/modelClass')
      const { createModelFromJson } = await import('@/imports/json')
      const { addModelsToDb } = await import('@/helpers/db')
      const { BaseDb } = await import('@/db/Db/BaseDb')
      const { schemas: schemasTable } = await import('@/seedSchema/SchemaSchema')
      const { eq } = await import('drizzle-orm')

      // Find new models (ones that don't exist in existingModels)
      const newModelNames = Object.keys(newModels).filter(
        name => !existingModels[name]
      )

      if (newModelNames.length === 0) {
        return // No new models to add
      }

      // Get schema record from database
      const db = BaseDb.getAppDb()
      if (!db) {
        logger('Database not found, skipping model store update')
        return
      }

      const context = this._getSnapshotContext()
      const schemaName = context.metadata?.name || context.schemaName

      // Find schema record
      const schemaRecords = await db
        .select()
        .from(schemasTable)
        .where(eq(schemasTable.name, schemaName))
        .limit(1)

      if (schemaRecords.length === 0) {
        logger(`Schema "${schemaName}" not found in database, skipping model store update`)
        return
      }

      const schemaRecord = schemaRecords[0]

      // Convert schema model format to JSON import format for createModelFromJson
      const modelDefinitions: { [modelName: string]: any } = {}
      
      for (const modelName of newModelNames) {
        const modelDef = newModels[modelName]
        
        // Convert properties from schema format to JSON import format
        const convertedProperties: { [propName: string]: any } = {}
        if (modelDef.properties) {
          for (const [propName, propDef] of Object.entries(modelDef.properties)) {
            // Schema format: { dataType, ref, refValueType, storageType, localStorageDir, filenameSuffix }
            // JSON import format: { type, model, items, storage: { type, path, extension } }
            const schemaProp = propDef as any
            const jsonProp: any = {
              type: schemaProp.dataType || schemaProp.type,
            }

            // Handle Relation type
            if (schemaProp.ref || schemaProp.refModelName) {
              jsonProp.model = schemaProp.refModelName || schemaProp.ref
            }

            // Handle List type
            if (schemaProp.dataType === 'List' && schemaProp.refValueType) {
              jsonProp.items = {
                type: schemaProp.refValueType,
                model: schemaProp.refModelName || schemaProp.ref,
              }
            }

            // Handle storage configuration
            if (schemaProp.storageType || schemaProp.localStorageDir || schemaProp.filenameSuffix) {
              jsonProp.storage = {
                type: schemaProp.storageType === 'ItemStorage' ? 'ItemStorage' : 'PropertyStorage',
                path: schemaProp.localStorageDir,
                extension: schemaProp.filenameSuffix,
              }
            }

            convertedProperties[propName] = jsonProp
          }
        }

        // Create model definition in JSON import format
        const jsonModelDef = {
          properties: convertedProperties,
          indexes: modelDef.indexes || [],
          description: modelDef.description,
        }

        // Create Model class
        const ModelClass = await createModelFromJson(modelName, jsonModelDef, schemaName)
        modelDefinitions[modelName] = ModelClass

        // Add to store
        setModel(modelName, ModelClass as any)
        logger(`Added model "${modelName}" to store`)
      }

      // Add models to database
      if (Object.keys(modelDefinitions).length > 0) {
        await addModelsToDb(modelDefinitions, schemaRecord)
        logger(`Added ${Object.keys(modelDefinitions).length} new models to database`)
      }
    } catch (error) {
      logger(`Error adding models to store: ${error instanceof Error ? error.message : String(error)}`)
      // Don't throw - this is a best-effort operation
    }
  }

  /**
   * Update the client context with the current schema state
   * This ensures that useSchema and useSchemas hooks reflect schema changes
   * @param newName - The new schema name (if changed)
   * @param oldName - The old schema name (if changed, for cleanup)
   */
  private async _updateClientContext(newName?: string, oldName?: string): Promise<void> {
    try {
      // Only update in browser environment
      if (typeof window === 'undefined') {
        return
      }

      const { getClient } = await import('@/client/ClientManager')
      const { ClientManagerEvents } = await import('@/services/internal/constants')
      const { ClientManagerState } = await import('@/services/internal/constants')
      const { generateId } = await import('@/helpers')

      const client = getClient()
      const clientService = client.getService()
      const snapshot = clientService.getSnapshot()
      
      // Don't update context during initialization - wait until client is fully ready
      // This prevents infinite loops during initialization when processSchemaFiles is running
      if (snapshot.value !== ClientManagerState.IDLE || !snapshot.context.isInitialized) {
        contextLogger('Client not fully initialized, skipping context update')
        return
      }
      
      const currentContext = snapshot.context

      const context = this._getSnapshotContext()
      const schemaName = newName || context.metadata?.name || context.schemaName

      if (!schemaName) {
        contextLogger('Cannot update client context: schema name is missing')
        return
      }

      // Get existing schema from client context to preserve ID and compare
      const existingSchema = currentContext.schemas?.[schemaName]
      
      // Use existing schema ID if available, otherwise use _schemaFileId from context, or generate new
      const schemaId = existingSchema?.id || context._schemaFileId || generateId()

      // Build SchemaFileFormat from current context
      const schemaFile: SchemaFileFormat = {
        $schema: context.$schema || 'https://seedprotocol.org/schemas/data-model/v1',
        version: context.version || 1,
        id: schemaId,
        metadata: context.metadata || {
          name: schemaName,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        models: context.models || {},
        enums: context.enums || {},
        migrations: context.migrations || [],
      }

      // Compare with existing schema to avoid unnecessary updates
      // Only compare content, not the id (which we preserve)
      if (existingSchema) {
        const existingContent = {
          $schema: existingSchema.$schema,
          version: existingSchema.version,
          metadata: existingSchema.metadata,
          models: existingSchema.models,
          enums: existingSchema.enums,
          migrations: existingSchema.migrations,
        }
        const newContent = {
          $schema: schemaFile.$schema,
          version: schemaFile.version,
          metadata: schemaFile.metadata,
          models: schemaFile.models,
          enums: schemaFile.enums,
          migrations: schemaFile.migrations,
        }
        
        // Deep comparison using JSON.stringify (for simple objects this is sufficient)
        if (JSON.stringify(existingContent) === JSON.stringify(newContent)) {
          // Schema content hasn't changed, skip update to prevent infinite loop
          contextLogger(`Schema ${schemaName} content unchanged, skipping context update`)
          return
        }
      }

      // Update client context with the new schema
      const updatedSchemas = { ...(currentContext.schemas || {}) }

      // If name changed, remove old entry and add new one
      if (oldName && oldName !== schemaName && updatedSchemas[oldName]) {
        delete updatedSchemas[oldName]
        contextLogger(`Removed old schema entry: ${oldName}`)
      }

      // Add/update the schema with the new name
      updatedSchemas[schemaName] = schemaFile

      clientService.send({
        type: ClientManagerEvents.UPDATE_CONTEXT,
        context: {
          schemas: updatedSchemas,
        },
      })

      contextLogger(`Updated client context with schema: ${schemaName}`)
    } catch (error) {
      // Log error but don't fail if context update fails (might not be in browser)
      contextLogger(`Failed to update client context: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Update Model instances cache when schema context changes
   * Creates Model instances for each model in the schema
   */
  private _updateModelInstances(context: SchemaMachineContext): void {
    const instanceState = schemaInstanceState.get(this)
    if (!instanceState) return
    
    const modelInstances = instanceState.modelInstances
    
    if (!context.models) {
      modelInstances.clear()
      return
    }

    const schemaName = context.metadata?.name || context.schemaName
    const currentModelNames = new Set(Object.keys(context.models))
    const cachedModelNames = new Set(modelInstances.keys())

    // Remove models that no longer exist
    for (const modelName of cachedModelNames) {
      if (!currentModelNames.has(modelName)) {
        const modelInstance = modelInstances.get(modelName)
        if (modelInstance) {
          modelInstance.unload()
        }
        modelInstances.delete(modelName)
      }
    }

    // Create or update Model instances for existing models
    for (const [modelName, modelData] of Object.entries(context.models)) {
      if (!modelInstances.has(modelName)) {
        // Create new Model instance
        const modelInstance = Model.create(modelName, schemaName)
        
        // Update the model instance with current data
        const modelContext = modelInstance.getService().getSnapshot().context
        modelInstance.getService().send({
          type: 'updateContext',
          description: modelData.description,
          properties: modelData.properties || {},
          indexes: modelData.indexes,
        })
        
        // Initialize original values
        modelInstance.getService().send({
          type: 'initializeOriginalValues',
          originalValues: {
            description: modelData.description,
            properties: modelData.properties ? JSON.parse(JSON.stringify(modelData.properties)) : {},
            indexes: modelData.indexes ? [...(modelData.indexes || [])] : undefined,
          },
          isEdited: false,
        })
        
        modelInstances.set(modelName, modelInstance)
      } else {
        // Update existing Model instance if data changed
        const modelInstance = modelInstances.get(modelName)!
        const instanceContext = modelInstance.getService().getSnapshot().context
        
        // Check if data has changed
        const descriptionChanged = instanceContext.description !== modelData.description
        const propertiesChanged = JSON.stringify(instanceContext.properties) !== JSON.stringify(modelData.properties || {})
        const indexesChanged = JSON.stringify(instanceContext.indexes) !== JSON.stringify(modelData.indexes)
        
        if (descriptionChanged || propertiesChanged || indexesChanged) {
          modelInstance.getService().send({
            type: 'updateContext',
            description: modelData.description,
            properties: modelData.properties || {},
            indexes: modelData.indexes,
          })
        }
      }
    }
  }

  /**
   * Handle model name change
   * Updates the Schema's models object and database
   */
  async _handleModelNameChange(oldName: string, newName: string): Promise<void> {
    const context = this._getSnapshotContext()
    const schemaName = context.metadata?.name || context.schemaName
    
    if (!context.models || !context.models[oldName]) {
      logger(`Model "${oldName}" not found in schema "${schemaName}"`)
      return
    }

    // Update the models object in Schema context
    const updatedModels = { ...context.models }
    updatedModels[newName] = updatedModels[oldName]
    delete updatedModels[oldName]

    // Update Model instance cache
    const instanceState = schemaInstanceState.get(this)
    if (instanceState) {
      const modelInstance = instanceState.modelInstances.get(oldName)
      if (modelInstance) {
        instanceState.modelInstances.delete(oldName)
        instanceState.modelInstances.set(newName, modelInstance)
      }
    }

    // Update Schema context
    this._service.send({
      type: 'updateContext',
      models: updatedModels,
    })

    // Mark schema as draft
    this._service.send({
      type: 'markAsDraft',
      propertyKey: `model:${oldName}:name`,
    })

    // Update database
    try {
      await renameModelInDb(oldName, newName)
      logger(`Renamed model "${oldName}" to "${newName}" in database`)
    } catch (error) {
      logger(`Failed to rename model in database: ${error instanceof Error ? error.message : String(error)}`)
    }

    // Save draft to database
    await this._saveDraftToDb().catch((error) => {
      logger(`Failed to save draft to database: ${error instanceof Error ? error.message : String(error)}`)
    })
  }

  unload(): void {
    // Unload all Model instances
    const instanceState = schemaInstanceState.get(this)
    if (instanceState) {
      for (const modelInstance of instanceState.modelInstances.values()) {
        modelInstance.unload()
      }
      instanceState.modelInstances.clear()
      
      // Clear any pending context update
      if (instanceState.contextUpdateTimeout) {
        clearTimeout(instanceState.contextUpdateTimeout)
        instanceState.contextUpdateTimeout = null
      }
    }
    
    // Clean up WeakMap entry
    schemaInstanceState.delete(this)
    
    // Remove from both caches
    try {
      const context = this._getSnapshotContext()
      if (context._schemaFileId) {
        if (Schema.instanceCacheById.has(context._schemaFileId)) {
          const entry = Schema.instanceCacheById.get(context._schemaFileId)!
          entry.refCount -= 1
          if (entry.refCount <= 0) {
            Schema.instanceCacheById.delete(context._schemaFileId)
          } else {
            Schema.instanceCacheById.set(context._schemaFileId, entry)
          }
        }
      }
      // Also remove from name-based cache if it exists
      if (context.schemaName && Schema.instanceCacheByName.has(context.schemaName)) {
        const entry = Schema.instanceCacheByName.get(context.schemaName)!
        entry.refCount -= 1
        if (entry.refCount <= 0) {
          Schema.instanceCacheByName.delete(context.schemaName)
        } else {
          Schema.instanceCacheByName.set(context.schemaName, entry)
        }
      }
    } catch (error) {
      // Service might be stopped, can't get context - that's okay
      logger(`Could not get context during unload: ${error instanceof Error ? error.message : String(error)}`)
    }
    
    this._service.stop()
  }
}