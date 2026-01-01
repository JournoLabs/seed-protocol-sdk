import { ActorRefFrom, createActor, SnapshotFrom } from 'xstate'
import { immerable } from 'immer'
import { modelMachine, ModelMachineContext } from './service/modelMachine'
import { createReactiveProxy } from '@/helpers/reactiveProxy'
import { BaseItem } from '@/Item/BaseItem'
import { ModelValues } from '@/types'
import { ItemData } from '@/types/item'
import { generateId } from '@/helpers'
import { BaseDb } from '@/db/Db/BaseDb'
import debug from 'debug'

const logger = debug('seedSdk:model:Model')

type ModelService = ActorRefFrom<typeof modelMachine>
type ModelSnapshot = SnapshotFrom<typeof modelMachine>

// WeakMap to store mutable state per Model instance
// This avoids issues with read-only properties when instances are frozen by Immer
const modelInstanceState = new WeakMap<Model, {
  liveQuerySubscription: { unsubscribe: () => void } | null // LiveQuery subscription for cross-instance property updates
  liveQueryPropertyIds: string[] // Property file IDs from liveQuery
}>()

// Define tracked properties for the Proxy
// These properties will be read from/written to the actor context
const TRACKED_PROPERTIES = [
  'modelName',
  'schemaName',
  'description',
  'properties',
  'indexes',
] as const

export class Model {
  // Primary cache: ID-based (never changes on rename)
  protected static instanceCacheById: Map<
    string, // modelFileId
    { instance: Model; refCount: number }
  > = new Map()
  
  // Secondary index: name lookup (updated on rename)
  protected static instanceCacheByName: Map<
    string, // "schemaName:modelName"
    string   // modelFileId
  > = new Map()
  
  // Legacy cache: kept temporarily for backward compatibility during migration
  protected static instanceCache: Map<
    string,
    { instance: Model; refCount: number }
  > = new Map()
  
  // Static tracking for pending writes
  private static pendingWrites = new Map<string, {
    modelFileId: string
    schemaId: number
    status: 'pending' | 'writing' | 'success' | 'error'
    timestamp: number
  }>()
  
  static trackPendingWrite(modelFileId: string, schemaId: number): void {
    this.pendingWrites.set(modelFileId, {
      modelFileId,
      schemaId,
      status: 'pending',
      timestamp: Date.now(),
    })
  }
  
  static getPendingModelIds(schemaId: number): string[] {
    return Array.from(this.pendingWrites.entries())
      .filter(([_, write]) => write.schemaId === schemaId && write.status !== 'error')
      .map(([modelFileId]) => modelFileId)
  }
  
  protected readonly _service: ModelService
  declare [immerable]: boolean

  modelName?: string
  schemaName?: string
  description?: string
  properties?: {
    [propertyName: string]: any
  }
  indexes?: string[]
  // 'name' is available as an alias for 'modelName' via the proxy

  constructor(modelName: string, schemaName: string, modelFileId?: string) {
    // Set immerable in constructor to ensure 'this' is properly bound
    this[immerable] = true
    
    const serviceInput: Pick<ModelMachineContext, 'modelName' | 'schemaName' | '_modelFileId'> = {
      modelName,
      schemaName,
      ...(modelFileId ? { _modelFileId: modelFileId } : {}),
    }

    this._service = createActor(modelMachine as any, {
      input: serviceInput,
    }) as ModelService

    this._service.start()

    // Initialize instance state in WeakMap
    modelInstanceState.set(this, {
      liveQuerySubscription: null,
      liveQueryPropertyIds: [],
    })
    
    // Set up liveQuery subscription for cross-instance property updates
    this._setupLiveQuerySubscription()

    // Note: Property getters/setters are now handled by the Proxy in create()
  }

  /**
   * Create a new Model instance or return existing cached instance
   * 
   * @param modelName - The name of the model
   * @param schemaNameOrSchema - The schema name (string) or Schema instance
   * @param options - Optional configuration (can be omitted to create model with empty properties):
   *   - modelFileId: Pre-existing model file ID
   *   - properties: Model properties definition (defaults to empty object if not provided)
   *   - indexes: Model indexes (defaults to empty array if not provided)
   *   - description: Model description (defaults to undefined if not provided)
   *   - registerWithSchema: Whether to automatically register this model with its schema (default: true if schema instance provided)
   * 
   * @example
   * // Create model with empty properties
   * const model = Model.create('MyModel', schema)
   * 
   * @example
   * // Create model with properties
   * const model = Model.create('MyModel', schema, {
   *   properties: { title: { dataType: 'String' } },
   *   indexes: ['title'],
   *   description: 'My model description'
   * })
   */
  static create(
    modelName: string,
    schemaNameOrSchema: string | any, // Schema type - using any to avoid circular dependency
    options?: {
      modelFileId?: string
      properties?: { [propertyName: string]: any }
      indexes?: string[]
      description?: string
      registerWithSchema?: boolean
    }
  ): Model {
    if (!modelName) {
      throw new Error('Model name is required')
    }

    // Extract schema name and instance
    let schemaName: string
    let schemaInstance: any | undefined // Using any to avoid circular dependency with Schema
    if (typeof schemaNameOrSchema === 'string') {
      schemaName = schemaNameOrSchema
    } else {
      schemaInstance = schemaNameOrSchema
      schemaName = schemaInstance.schemaName
    }

    if (!schemaName) {
      throw new Error('Schema name is required')
    }

    const modelFileId = options?.modelFileId
    const registerWithSchema = options?.registerWithSchema !== false && schemaInstance !== undefined

    // Create name-based cache key
    const nameKey = `${schemaName}:${modelName}`

    // Step 1: Check ID-based cache first (if ID provided)
    let id = modelFileId
    if (id && this.instanceCacheById.has(id)) {
      const { instance, refCount } = this.instanceCacheById.get(id)!
      this.instanceCacheById.set(id, {
        instance,
        refCount: refCount + 1,
      })
      logger(`Model.create: Found instance in ID cache for "${modelName}" (ID: ${id})`)
      return instance
    }

    // Step 2: Check name-based index to get ID (if ID not provided)
    if (!id) {
      id = this.instanceCacheByName.get(nameKey)
      if (id && this.instanceCacheById.has(id)) {
        const { instance, refCount } = this.instanceCacheById.get(id)!
        this.instanceCacheById.set(id, {
          instance,
          refCount: refCount + 1,
        })
        logger(`Model.create: Found instance via name index for "${modelName}" (ID: ${id})`)
        return instance
      }
    }

    // Step 3: Check legacy cache (backward compatibility during migration)
    if (this.instanceCache.has(nameKey)) {
      const { instance, refCount } = this.instanceCache.get(nameKey)!
      this.instanceCache.set(nameKey, {
        instance,
        refCount: refCount + 1,
      })
      logger(`Model.create: Found instance in legacy cache for "${modelName}"`)
      
      // Migrate to new cache structure
      const context = instance._getSnapshotContext()
      const existingId = context._modelFileId
      if (existingId) {
        this.instanceCacheById.set(existingId, { instance, refCount: refCount + 1 })
        this.instanceCacheByName.set(nameKey, existingId)
      }
      
      return instance
    }

    // Step 4: Generate ID if not provided (before creating instance)
    if (!id) {
      id = generateId()
      logger(`Model.create: Generated new modelFileId "${id}" for model "${modelName}"`)
    }
    
    // Step 5: Create new instance with modelFileId in initial context
    // This ensures loadOrCreateModel sees the ID immediately
    const newInstance = new this(modelName, schemaName, id)
    
    // Step 7: Set initial model data if provided
    if (options) {
      const updates: any = {}
      if (options.properties !== undefined) {
        updates.properties = JSON.parse(JSON.stringify(options.properties)) // Deep clone
      }
      if (options.indexes !== undefined) {
        updates.indexes = options.indexes ? [...options.indexes] : undefined
      }
      if (options.description !== undefined) {
        updates.description = options.description
      }
      
      if (Object.keys(updates).length > 0) {
        newInstance._service.send({
          type: 'updateContext',
          ...updates,
        })
        
        // Initialize original values
        newInstance._service.send({
          type: 'initializeOriginalValues',
          originalValues: {
            description: updates.description,
            properties: updates.properties ? JSON.parse(JSON.stringify(updates.properties)) : {},
            indexes: updates.indexes ? [...(updates.indexes || [])] : undefined,
          },
          isEdited: false,
        })
      }
    }
    
    // Wrap instance in Proxy for reactive property access
    // Create a custom proxy that handles 'name' as an alias for 'modelName'
    const proxiedInstance = new Proxy(newInstance, {
      get(target, prop: string | symbol) {
        // Handle special properties
        if (prop === '_service' || prop === Symbol.for('immerable')) {
          return Reflect.get(target, prop)
        }
        
        // Handle 'name' as an alias for 'modelName'
        if (prop === 'name') {
          const context = target._getSnapshotContext()
          return context.modelName
        }
        
        // Handle 'id' property - returns the modelFileId
        if (prop === 'id') {
          const context = target._getSnapshotContext()
          return context._modelFileId
        }
        
        // Handle tracked properties
        if (typeof prop === 'string' && TRACKED_PROPERTIES.includes(prop as any)) {
          // Special handling for properties - compute from liveQuery + ModelProperty static cache
          if (prop === 'properties') {
            const instanceState = modelInstanceState.get(target)
            const context = target._getSnapshotContext()
            
            if (!instanceState) {
              return context.properties || {}
            }
            
            // Get property IDs from liveQuery (synchronously available)
            const liveQueryIds = instanceState.liveQueryPropertyIds || []
            
            // Get modelId from context if available
            const modelId: number | undefined = (context as any).modelId
            
            // Get pending property IDs (synchronous - uses static Map)
            // Lazy import ModelProperty to avoid circular dependency
            let ModelProperty: any
            try {
              ModelProperty = require('@/ModelProperty/ModelProperty').ModelProperty
            } catch {
              // If import fails, fall back to context.properties
              return context.properties || {}
            }
            const pendingIds = modelId ? ModelProperty.getPendingPropertyIds(modelId) : []
            
            // Combine and deduplicate
            const allPropertyIds = [...new Set([...liveQueryIds, ...pendingIds])]
            
            // Get ModelProperty instances from static cache (synchronous)
            const propertiesObj: { [name: string]: any } = {}
            for (const propertyFileId of allPropertyIds) {
              const property = ModelProperty.getById(propertyFileId)
              if (property) {
                const propContext = property._getSnapshotContext()
                if (propContext.name) {
                  propertiesObj[propContext.name] = {
                    dataType: propContext.dataType,
                    ref: propContext.refModelName || propContext.ref,
                    refValueType: propContext.refValueType,
                    storageType: propContext.storageType,
                    localStorageDir: propContext.localStorageDir,
                    filenameSuffix: propContext.filenameSuffix,
                  }
                }
              }
            }
            
            return propertiesObj
          }
          
          const context = target._getSnapshotContext()
          return (context as any)[prop]
        }
        
        // For methods and other properties, use Reflect
        return Reflect.get(target, prop)
      },
      
      set(target, prop: string | symbol, value: any) {
        // Handle special properties
        if (prop === '_service' || prop === Symbol.for('immerable')) {
          return Reflect.set(target, prop, value)
        }
        
        // Handle 'name' as an alias for 'modelName'
        if (prop === 'name') {
          prop = 'modelName'
        }
        
        // Handle tracked properties
        if (typeof prop === 'string' && TRACKED_PROPERTIES.includes(prop as any)) {
          // Use the sendUpdate logic
          if (prop === 'modelName') {
            // Model name change - need to update Schema and database
            const context = target._getSnapshotContext()
            const oldName = context.modelName
            const newName = value as string
            
            if (oldName === newName) {
              logger(`Model name unchanged: "${oldName}"`)
              return true
            }
            
            logger(`Updating model name from "${oldName}" to "${newName}"`)
            
            // Update Model instance cache using new ID-based structure
            const modelFileId = context._modelFileId
            if (modelFileId) {
              Model.updateNameIndex(oldName, newName, context.schemaName, modelFileId)
            } else {
              // Fallback to legacy cache if no ID (shouldn't happen, but safety)
              const oldCacheKey = `${context.schemaName}:${oldName}`
              const newCacheKey = `${context.schemaName}:${newName}`
              if (Model.instanceCache.has(oldCacheKey)) {
                const entry = Model.instanceCache.get(oldCacheKey)!
                Model.instanceCache.delete(oldCacheKey)
                Model.instanceCache.set(newCacheKey, entry)
              }
            }
            
            // Update Model context
            target._service.send({
              type: 'updateContext',
              modelName: newName,
            })
            
            // Mark model as draft
            target._service.send({
              type: 'markAsDraft',
              propertyKey: 'modelName',
            })
            
            // NOTE: Schema is not notified of model name changes during edits.
            // Schema will read from Model instances when persisting/saving.
          } else if (prop === 'properties') {
            // Deep clone to ensure immutability
            const clonedProperties = value ? JSON.parse(JSON.stringify(value)) : {}
            target._service.send({
              type: 'updateContext',
              properties: clonedProperties,
            })
            
            // Mark model as draft when properties change
            target._service.send({
              type: 'markAsDraft',
              propertyKey: 'properties',
            })
            
            // NOTE: Schema is not notified of model property changes during edits.
            // Schema will read from Model instances when persisting/saving.
          } else if (prop === 'indexes') {
            // Clone array
            const clonedIndexes = value ? [...value] : undefined
            target._service.send({
              type: 'updateContext',
              indexes: clonedIndexes,
            })
            
            // Mark model as draft when indexes change
            target._service.send({
              type: 'markAsDraft',
              propertyKey: 'indexes',
            })
            
            // NOTE: Schema is not notified of model index changes during edits.
            // Schema will read from Model instances when persisting/saving.
          } else if (prop === 'description') {
            // Standard property update
            target._service.send({
              type: 'updateContext',
              description: value,
            })
            
            // Mark model as draft
            target._service.send({
              type: 'markAsDraft',
              propertyKey: 'description',
            })
            
            // NOTE: Schema is not notified of model description changes during edits.
            // Schema will read from Model instances when persisting/saving.
          } else {
            // Standard property update
            target._service.send({
              type: 'updateContext',
              [prop]: value,
            })
          }
          return true
        }
        
        // For non-tracked properties, use Reflect
        return Reflect.set(target, prop, value)
      },
      
      has(target, prop: string | symbol) {
        // Handle 'name' as an alias for 'modelName'
        if (prop === 'name') {
          return true
        }
        
        // Handle 'id' property
        if (prop === 'id') {
          return true
        }
        
        // Check tracked properties
        if (typeof prop === 'string' && TRACKED_PROPERTIES.includes(prop as any)) {
          const context = target._getSnapshotContext()
          return prop in context
        }
        return Reflect.has(target, prop)
      },
      
      ownKeys(target) {
        // Include 'name' and 'id' in ownKeys
        const keys = Reflect.ownKeys(target)
        const additionalKeys: (string | symbol)[] = []
        if (!keys.includes('name')) {
          additionalKeys.push('name')
        }
        if (!keys.includes('id')) {
          additionalKeys.push('id')
        }
        return additionalKeys.length > 0 ? [...keys, ...additionalKeys] : keys
      },
      
      getOwnPropertyDescriptor(target, prop: string | symbol) {
        // Handle 'name' as an alias for 'modelName'
        if (prop === 'name') {
          const context = target._getSnapshotContext()
          return {
            enumerable: true,
            configurable: true,
            value: context.modelName,
            writable: true,
          }
        }
        
        // Handle 'id' property - returns the modelFileId
        if (prop === 'id') {
          const context = target._getSnapshotContext()
          return {
            enumerable: true,
            configurable: true,
            value: context._modelFileId,
            writable: false, // id is read-only
          }
        }
        
        // Handle tracked properties
        if (typeof prop === 'string' && TRACKED_PROPERTIES.includes(prop as any)) {
          const context = target._getSnapshotContext()
          if (prop in context) {
            return {
              enumerable: true,
              configurable: true,
              value: (context as any)[prop],
              writable: true,
            }
          }
        }
        return Reflect.getOwnPropertyDescriptor(target, prop)
      },
    }) as Model
    
    // Step 7: Store in new ID-based cache
    this.instanceCacheById.set(id, {
      instance: proxiedInstance,
      refCount: 1,
    })
    
    // Step 8: Store in name-based index
    this.instanceCacheByName.set(nameKey, id)
    
    // Step 9: Also store in legacy cache (for backward compatibility during migration)
    this.instanceCache.set(nameKey, {
      instance: proxiedInstance,
      refCount: 1,
    })
    
    logger(`Model.create: Created new instance for "${modelName}" (ID: ${id})`)
    
    // Step 7.5: Model instance is now cached and accessible via Model.getById() and Model.getByName()
    // No wrapper or store registration needed
    
    // Step 8: Register with schema if requested
    // If schema provided, trigger write process instead of registration
    if (registerWithSchema && schemaInstance) {
      queueMicrotask(async () => {
        try {
          // Wait for model to reach idle state (validation complete)
          await new Promise<void>((resolve) => {
            const subscription = proxiedInstance._service.subscribe((snapshot) => {
              // Wait for idle state (validation complete) or error state
              if (snapshot.value === 'idle' || snapshot.value === 'error') {
                subscription.unsubscribe()
                resolve()
              }
            })
            // Timeout after 10 seconds
            setTimeout(() => {
              subscription.unsubscribe()
              resolve()
            }, 10000)
          })
          
          // Only write if validation passed (model is in idle state, not error)
          const finalSnapshot = proxiedInstance._service.getSnapshot()
          if (finalSnapshot.value === 'idle' && (!finalSnapshot.context._validationErrors || finalSnapshot.context._validationErrors.length === 0)) {
            logger(`Model validation passed, triggering write process`)
            
            // Get schema ID from schema instance
            const schemaContext = (schemaInstance as any)._getSnapshotContext()
            const schemaFileId = schemaContext._schemaFileId
            let schemaId: number | undefined
            
            if (schemaFileId) {
              try {
                const { BaseDb } = await import('@/db/Db/BaseDb')
                const { schemas: schemasTable } = await import('@/seedSchema/SchemaSchema')
                const { eq } = await import('drizzle-orm')
                const db = BaseDb.getAppDb()
                
                if (db) {
                  const schemaRecords = await db
                    .select()
                    .from(schemasTable)
                    .where(eq(schemasTable.schemaFileId, schemaFileId))
                    .limit(1)
                  
                  if (schemaRecords.length > 0) {
                    schemaId = schemaRecords[0].id
                  }
                }
              } catch (error) {
                logger(`Error looking up schemaId: ${error}`)
              }
            }
            
            if (schemaId && finalSnapshot.context._modelFileId) {
              // Track pending write
              Model.trackPendingWrite(finalSnapshot.context._modelFileId, schemaId)
              
              // Wait for writeProcess to be spawned (it's spawned in idle state entry action)
              // Retry a few times if writeProcess isn't available yet
              let retries = 0
              const maxRetries = 10
              const checkAndSend = () => {
                const currentSnapshot = proxiedInstance._service.getSnapshot()
                if (currentSnapshot.context.writeProcess) {
                  logger(`Triggering write process for model "${finalSnapshot.context.modelName}" (schemaId: ${schemaId})`)
                  proxiedInstance._service.send({
                    type: 'requestWrite',
                    data: {
                      modelFileId: finalSnapshot.context._modelFileId,
                      modelName: finalSnapshot.context.modelName,
                      schemaName: finalSnapshot.context.schemaName,
                      schemaId,
                      properties: finalSnapshot.context.properties,
                      indexes: finalSnapshot.context.indexes,
                      description: finalSnapshot.context.description,
                    },
                  })
                } else if (retries < maxRetries) {
                  retries++
                  setTimeout(checkAndSend, 50) // Retry after 50ms
                } else {
                  logger(`ERROR: writeProcess not available after ${maxRetries} retries for model "${finalSnapshot.context.modelName}"`)
                }
              }
              
              // Start checking immediately, but also allow time for entry action to complete
              setTimeout(checkAndSend, 0)
            } else {
              logger(`Cannot trigger write process: missing schemaId (${schemaId}) or modelFileId (${finalSnapshot.context._modelFileId})`)
            }
          } else {
            logger(`Model validation failed or model in error state, skipping write process`)
          }
        } catch (error) {
          logger(`Failed to trigger write process: ${error instanceof Error ? error.message : String(error)}`)
        }
      })
    }
    
    return proxiedInstance
  }

  /**
   * Get Model instance by modelFileId (O(1) lookup)
   */
  static getById(modelFileId: string): Model | undefined {
    const entry = this.instanceCacheById.get(modelFileId)
    if (entry) {
      // Increment ref count
      this.instanceCacheById.set(modelFileId, {
        instance: entry.instance,
        refCount: entry.refCount + 1,
      })
      return entry.instance
    }
    return undefined
  }

  /**
   * Get Model instance by name (O(1) lookup via name→ID mapping)
   * 
   * @param modelName - The name of the model
   * @param schemaName - The schema name (optional, will query DB if not provided)
   * @returns The Model instance if found, undefined otherwise
   */
  static getByName(modelName: string, schemaName?: string): Model | undefined {
    if (schemaName) {
      const nameKey = `${schemaName}:${modelName}`
      const id = this.instanceCacheByName.get(nameKey)
      if (!id) {
        return undefined
      }
      return this.getById(id)
    }
    // If schemaName not provided, try to find in cache by searching all name keys
    for (const [nameKey, id] of this.instanceCacheByName.entries()) {
      const [, cachedModelName] = nameKey.split(':')
      if (cachedModelName === modelName) {
        return this.getById(id)
      }
    }
    return undefined
  }

  /**
   * Get Model instance by name, querying database if not in cache
   * This is an async version that can query the database when schemaName is not provided
   * 
   * @param modelName - The name of the model
   * @param schemaName - Optional schema name (will query DB if not provided)
   * @returns The Model instance if found, undefined otherwise
   */
  static async getByNameAsync(modelName: string, schemaName?: string): Promise<Model | undefined> {
    // First try cache
    const cached = this.getByName(modelName, schemaName)
    if (cached) {
      return cached
    }

    // If not in cache and schemaName not provided, query database
    if (!schemaName) {
      const db = BaseDb.getAppDb()
      if (!db) {
        return undefined
      }

      try {
        const { models: modelsTable } = await import('@/seedSchema/ModelSchema')
        const { modelSchemas } = await import('@/seedSchema/ModelSchemaSchema')
        const { schemas: schemasTable } = await import('@/seedSchema/SchemaSchema')
        const { eq } = await import('drizzle-orm')

        // Query model by name
        const modelRecords = await db
          .select({
            modelFileId: modelsTable.schemaFileId,
            modelName: modelsTable.name,
            schemaName: schemasTable.name,
          })
          .from(modelsTable)
          .innerJoin(modelSchemas, eq(modelsTable.id, modelSchemas.modelId))
          .innerJoin(schemasTable, eq(modelSchemas.schemaId, schemasTable.id))
          .where(eq(modelsTable.name, modelName))
          .limit(1)

        if (modelRecords.length === 0) {
          return undefined
        }

        const record = modelRecords[0]
        if (!record.modelName || !record.schemaName || !record.modelFileId) {
          return undefined
        }

        // Create model instance (will be cached)
        return this.create(record.modelName, record.schemaName, {
          modelFileId: record.modelFileId,
        })
      } catch (error) {
        logger(`Model.getByNameAsync: Error looking up model by name "${modelName}": ${error instanceof Error ? error.message : String(error)}`)
        return undefined
      }
    }

    return undefined
  }

  /**
   * Create or get Model instance by modelFileId
   * Checks cache first, then database if not found
   * 
   * @param modelFileId - The model file ID to look up
   * @returns The Model instance if found, undefined otherwise
   */
  static async createById(modelFileId: string): Promise<Model | undefined> {
    if (!modelFileId) {
      return undefined
    }

    // Step 1: Check cache first (fast path)
    const cached = this.getById(modelFileId)
    if (cached) {
      logger(`Model.createById: Found instance in cache for ID "${modelFileId}"`)
      return cached
    }

    // Step 2: Query database to get modelName and schemaName
    const db = BaseDb.getAppDb()
    if (!db) {
      logger(`Model.createById: Database not available for ID "${modelFileId}"`)
      return undefined
    }

    try {
      const { models: modelsTable } = await import('@/seedSchema/ModelSchema')
      const { modelSchemas } = await import('@/seedSchema/ModelSchemaSchema')
      const { schemas: schemasTable } = await import('@/seedSchema/SchemaSchema')
      const { eq } = await import('drizzle-orm')

      // Query model by schemaFileId and join to get schema name
      const modelRecords = await db
        .select({
          modelId: modelsTable.id,
          modelName: modelsTable.name,
          schemaName: schemasTable.name,
        })
        .from(modelsTable)
        .innerJoin(modelSchemas, eq(modelsTable.id, modelSchemas.modelId))
        .innerJoin(schemasTable, eq(modelSchemas.schemaId, schemasTable.id))
        .where(eq(modelsTable.schemaFileId, modelFileId))
        .limit(1)

      if (modelRecords.length === 0) {
        logger(`Model.createById: Model not found in database for ID "${modelFileId}"`)
        return undefined
      }

      const { modelName, schemaName } = modelRecords[0]
      if (!modelName || !schemaName) {
        logger(`Model.createById: Missing modelName or schemaName for ID "${modelFileId}"`)
        return undefined
      }

      // Step 3: Create model using existing create method (which will handle caching)
      logger(`Model.createById: Creating model "${modelName}" in schema "${schemaName}" from ID "${modelFileId}"`)
      return this.create(modelName, schemaName, {
        modelFileId,
      })
    } catch (error) {
      logger(`Model.createById: Error looking up model by ID "${modelFileId}": ${error instanceof Error ? error.message : String(error)}`)
      return undefined
    }
  }

  /**
   * Get all Model instances for a schema by schemaFileId or schemaName
   * Queries database for all models with the given schemaId/schemaName and returns Model instances
   * 
   * @param schemaIdentifier - The schema file ID or schema name to get models for
   * @returns Array of Model instances for the schema
   */
  static async createBySchemaId(schemaIdentifier: string): Promise<Model[]> {
    if (!schemaIdentifier) {
      return []
    }

    const db = BaseDb.getAppDb()
    if (!db) {
      logger(`Model.createBySchemaId: Database not available for schema "${schemaIdentifier}"`)
      return []
    }

    try {
      const { models: modelsTable } = await import('@/seedSchema/ModelSchema')
      const { modelSchemas } = await import('@/seedSchema/ModelSchemaSchema')
      const { schemas: schemasTable } = await import('@/seedSchema/SchemaSchema')
      const { eq, or } = await import('drizzle-orm')

      // Query all models for this schema - support both schemaFileId and schema name
      const modelRecords = await db
        .select({
          modelFileId: modelsTable.schemaFileId,
          modelName: modelsTable.name,
          schemaName: schemasTable.name,
        })
        .from(schemasTable)
        .innerJoin(modelSchemas, eq(schemasTable.id, modelSchemas.schemaId))
        .innerJoin(modelsTable, eq(modelSchemas.modelId, modelsTable.id))
        .where(
          or(
            eq(schemasTable.schemaFileId, schemaIdentifier),
            eq(schemasTable.name, schemaIdentifier)
          )
        )

      if (modelRecords.length === 0) {
        logger(`Model.createBySchemaId: No models found in database for schema "${schemaIdentifier}"`)
        return []
      }

      // Create Model instances for each model (create() handles caching)
      const modelInstances: Model[] = []
      for (const record of modelRecords) {
        if (!record.modelName || !record.schemaName || !record.modelFileId) {
          continue
        }

        // Check cache first
        const cached = this.getById(record.modelFileId)
        if (cached) {
          modelInstances.push(cached)
        } else {
          // Create model instance (will be cached)
          const model = this.create(record.modelName, record.schemaName, {
            modelFileId: record.modelFileId,
          })
          modelInstances.push(model)
        }
      }

      logger(`Model.createBySchemaId: Found ${modelInstances.length} models for schema "${schemaIdentifier}"`)
      return modelInstances
    } catch (error) {
      logger(`Model.createBySchemaId: Error looking up models for schema "${schemaIdentifier}": ${error instanceof Error ? error.message : String(error)}`)
      return []
    }
  }

  /**
   * Get all Model instances currently in cache
   * 
   * @returns Array of all cached Model instances
   */
  static getAll(): Model[] {
    const instances: Model[] = []
    const seen = new Set<string>()
    
    // Collect from ID cache (primary source)
    for (const [id, entry] of this.instanceCacheById.entries()) {
      if (!seen.has(id)) {
        instances.push(entry.instance)
        seen.add(id)
      }
    }
    
    // Also check legacy cache for any not in ID cache
    for (const [nameKey, entry] of this.instanceCache.entries()) {
      const context = entry.instance._getSnapshotContext()
      const id = context._modelFileId
      if (id && !seen.has(id)) {
        instances.push(entry.instance)
        seen.add(id)
      }
    }
    
    return instances
  }

  /**
   * Get all Model instances for a specific schema from cache
   * For database-backed lookup, use createBySchemaId() instead
   * 
   * @param schemaName - The schema name to filter by
   * @returns Array of Model instances for the schema
   */
  static getAllBySchema(schemaName: string): Model[] {
    const instances: Model[] = []
    const seen = new Set<string>()
    
    // Collect from name cache (filtered by schema)
    for (const [nameKey, id] of this.instanceCacheByName.entries()) {
      const [cachedSchemaName] = nameKey.split(':')
      if (cachedSchemaName === schemaName) {
        const instance = this.getById(id)
        if (instance && !seen.has(id)) {
          instances.push(instance)
          seen.add(id)
        }
      }
    }
    
    // Also check legacy cache
    for (const [nameKey, entry] of this.instanceCache.entries()) {
      const [cachedSchemaName] = nameKey.split(':')
      if (cachedSchemaName === schemaName) {
        const context = entry.instance._getSnapshotContext()
        const id = context._modelFileId
        if (id && !seen.has(id)) {
          instances.push(entry.instance)
          seen.add(id)
        }
      }
    }
    
    return instances
  }

  /**
   * Update name index when model name changes
   */
  static updateNameIndex(oldName: string, newName: string, schemaName: string, modelFileId: string): void {
    const oldKey = `${schemaName}:${oldName}`
    const newKey = `${schemaName}:${newName}`
    
    // Update name index
    if (this.instanceCacheByName.has(oldKey)) {
      this.instanceCacheByName.delete(oldKey)
    }
    this.instanceCacheByName.set(newKey, modelFileId)
    
    // Also update legacy cache if it exists
    if (this.instanceCache.has(oldKey)) {
      const entry = this.instanceCache.get(oldKey)!
      this.instanceCache.delete(oldKey)
      this.instanceCache.set(newKey, entry)
    }
    
    logger(`Model.updateNameIndex: Updated name mapping from "${oldName}" to "${newName}" (ID: ${modelFileId})`)
  }

  getService(): ModelService {
    return this._service
  }

  private _getSnapshot(): ModelSnapshot {
    return this._service.getSnapshot() as ModelSnapshot
  }

  private _getSnapshotContext(): ModelMachineContext {
    return this._getSnapshot().context
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

  get isEdited() {
    return this._getSnapshotContext()._isEdited || false
  }

  get id() {
    return this._getSnapshotContext()._modelFileId
  }

  get name() {
    return this._getSnapshotContext().modelName
  }

  /**
   * Validate the model
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

      this._service.send({ type: 'validateModel' })
      
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
   * Create a new item instance from this model
   * Automatically injects the model name, so you don't need to pass it explicitly.
   * 
   * @example
   * const Post = Model.create('Post', schema)
   * const post = await Post.create({ title: 'My Post', content: '...' })
   * 
   * @param values - Item property values (modelName is automatically injected)
   * @returns The created item instance
   */
  async create(values: Partial<ItemData> & Record<string, any>): Promise<BaseItem<any>> {
    if (!this.modelName) {
      throw new Error('Cannot create item: model name is not set on this Model instance')
    }
    
    const item = await BaseItem.create({
      modelName: this.modelName,
      ...values,
    })
    return item
  }

  /**
   * Get the schema object (properties) for this model
   * This maintains backward compatibility with model.schema access
   */
  get schema() {
    return this.properties || {}
  }

  /**
   * Reload model from database
   * This refreshes the actor context with the latest data from the database
   */
  async reload(): Promise<void> {
    logger(`Reloading model ${this.modelName} from database`)
    
    // Send reload event to machine (which will trigger loadOrCreateModel)
    this._service.send({ type: 'reloadFromDb' })
    
    // Wait for reload to complete
    return new Promise((resolve, reject) => {
      const subscription = this._service.subscribe((snapshot) => {
        if (snapshot.value === 'idle') {
          subscription.unsubscribe()
          resolve()
        } else if (snapshot.value === 'error') {
          subscription.unsubscribe()
          reject(new Error('Failed to reload model from database'))
        }
      })
      
      // Timeout after 10 seconds
      setTimeout(() => {
        subscription.unsubscribe()
        reject(new Error('Timeout waiting for model reload'))
      }, 10000)
    })
  }

  /**
   * Unload the model instance and clean up resources
   */
  unload(): void {
    const context = this._getSnapshotContext()
    const modelFileId = context._modelFileId
    const nameKey = `${context.schemaName}:${context.modelName}`
    
    // Remove from ID-based cache
    if (modelFileId && Model.instanceCacheById.has(modelFileId)) {
      const entry = Model.instanceCacheById.get(modelFileId)!
      entry.refCount -= 1
      if (entry.refCount <= 0) {
        Model.instanceCacheById.delete(modelFileId)
        // Also remove from name index
        Model.instanceCacheByName.delete(nameKey)
        logger(`Model.unload: Removed instance from caches (ID: ${modelFileId})`)
      } else {
        Model.instanceCacheById.set(modelFileId, entry)
      }
    }
    
    // Also handle legacy cache
    if (Model.instanceCache.has(nameKey)) {
      const entry = Model.instanceCache.get(nameKey)!
      entry.refCount -= 1
      if (entry.refCount <= 0) {
        Model.instanceCache.delete(nameKey)
      } else {
        Model.instanceCache.set(nameKey, entry)
      }
    }
    
    this._service.stop()
  }

  /**
   * Destroy the model instance completely
   * - Removes instance from all caches (regardless of refCount)
   * - Deletes model records from database (models, properties, model_schemas tables)
   * - Removes model from Schema's models property and instance caches
   * - Cleans up registered ModelProperty instances
   * - Stops the model service
   */
  async destroy(): Promise<void> {
    const context = this._getSnapshotContext()
    const modelFileId = context._modelFileId
    const modelName = context.modelName
    const schemaName = context.schemaName
    const nameKey = `${schemaName}:${modelName}`
    
    if (!modelFileId || !modelName || !schemaName) {
      logger(`Model.destroy: Missing required context data (modelFileId: ${modelFileId}, modelName: ${modelName}, schemaName: ${schemaName})`)
      // Still try to clean up what we can
    }
    
    logger(`Model.destroy: Destroying model "${modelName}" (ID: ${modelFileId}) from schema "${schemaName}"`)
    
    // Get instanceState once at the top for reuse throughout the method
    const instanceState = modelInstanceState.get(this)
    
    // Step 1: Clean up liveQuery subscription
    if (instanceState && instanceState.liveQuerySubscription) {
      try {
        instanceState.liveQuerySubscription.unsubscribe()
        logger(`Model.destroy: Unsubscribed from liveQuery`)
      } catch (error) {
        logger(`Model.destroy: Error unsubscribing from liveQuery: ${error instanceof Error ? error.message : String(error)}`)
      }
      instanceState.liveQuerySubscription = null
      instanceState.liveQueryPropertyIds = []
    }
    
    // Step 2: Remove from Model caches (force removal regardless of refCount)
    if (modelFileId) {
      Model.instanceCacheById.delete(modelFileId)
      logger(`Model.destroy: Removed from instanceCacheById (ID: ${modelFileId})`)
    }
    Model.instanceCacheByName.delete(nameKey)
    logger(`Model.destroy: Removed from instanceCacheByName (key: ${nameKey})`)
    Model.instanceCache.delete(nameKey)
    logger(`Model.destroy: Removed from legacy instanceCache (key: ${nameKey})`)
    
    // Step 3: Delete from database
    try {
      const db = BaseDb.getAppDb()
      if (db && modelFileId) {
        const { models: modelsTable } = await import('@/seedSchema/ModelSchema')
        const { properties: propertiesTable } = await import('@/seedSchema/ModelSchema')
        const { modelSchemas } = await import('@/seedSchema/ModelSchemaSchema')
        const { eq } = await import('drizzle-orm')
        
        // First, find the model record by schemaFileId
        const modelRecords = await db
          .select()
          .from(modelsTable)
          .where(eq(modelsTable.schemaFileId, modelFileId))
          .limit(1)
        
        if (modelRecords.length > 0) {
          const modelRecord = modelRecords[0]
          const modelId = modelRecord.id
          
          logger(`Model.destroy: Found model record in database (modelId: ${modelId})`)
          
          // Delete from model_schemas join table
          await db
            .delete(modelSchemas)
            .where(eq(modelSchemas.modelId, modelId))
          logger(`Model.destroy: Deleted from model_schemas table`)
          
          // Delete all properties for this model
          await db
            .delete(propertiesTable)
            .where(eq(propertiesTable.modelId, modelId))
          logger(`Model.destroy: Deleted properties from database`)
          
          // Finally, delete the model record itself
          await db
            .delete(modelsTable)
            .where(eq(modelsTable.id, modelId))
          logger(`Model.destroy: Deleted model record from database`)
        } else {
          logger(`Model.destroy: Model record not found in database (modelFileId: ${modelFileId})`)
        }
      } else {
        logger(`Model.destroy: Database not available`)
      }
    } catch (error) {
      logger(`Model.destroy: Error deleting from database: ${error instanceof Error ? error.message : String(error)}`)
      // Continue with cleanup even if database deletion fails
    }
    
    // Step 4: Remove from Schema's models property and instance caches
    try {
      const { Schema } = await import('@/Schema/Schema')
      const schema = Schema.create(schemaName)
      const schemaSnapshot = schema.getService().getSnapshot()
      const schemaContext = schemaSnapshot.context
      
      // Remove from Schema's models object in context
      if (schemaContext.models && schemaContext.models[modelName!]) {
        const updatedModels = { ...schemaContext.models }
        delete updatedModels[modelName!]
        
        // Update Schema context - this will trigger liveQuery update which will
        // automatically clean up the model from Schema's instance caches
        schema.getService().send({
          type: 'updateContext',
          models: updatedModels,
        })
        
        // Mark schema as draft
        schema.getService().send({
          type: 'markAsDraft',
          propertyKey: `model:${modelName}`,
        })
        
        logger(`Model.destroy: Removed model from Schema's models property`)
        
        // Wait a moment for liveQuery to process the change
        // This ensures the Schema's instance caches are cleaned up
        await new Promise(resolve => setTimeout(resolve, 100))
      } else {
        logger(`Model.destroy: Model "${modelName}" not found in Schema's models property`)
      }
      
      logger(`Model.destroy: Updated Schema context to remove model`)
    } catch (error) {
      logger(`Model.destroy: Error removing from Schema: ${error instanceof Error ? error.message : String(error)}`)
      // Continue with cleanup even if Schema update fails
    }
    
    // Step 5: Stop the model service
    try {
      this._service.stop()
      logger(`Model.destroy: Stopped model service`)
    } catch (error) {
      logger(`Model.destroy: Error stopping service: ${error instanceof Error ? error.message : String(error)}`)
    }
    
    // Clean up liveQuery subscription
    if (instanceState?.liveQuerySubscription) {
      instanceState.liveQuerySubscription.unsubscribe()
      instanceState.liveQuerySubscription = null
    }
    
    logger(`Model.destroy: Successfully destroyed model "${modelName}" (ID: ${modelFileId})`)
  }

  /**
   * Set up liveQuery subscription to watch for property changes in the database
   * This enables cross-instance synchronization (e.g., changes in other tabs/windows)
   */
  private _setupLiveQuerySubscription(): void {
    // Only set up in browser environment where liveQuery is available
    if (typeof window === 'undefined') {
      return
    }

    // Wait for model to be loaded and have a modelId
    // Subscribe to service to detect when model is ready
    const setupSubscription = this._service.subscribe(async (snapshot) => {
      // Only set up once when model is idle and we have modelName
      if (snapshot.value === 'idle' && snapshot.context.modelName) {
        setupSubscription.unsubscribe()
        
        try {
          const { BaseDb } = await import('@/db/Db/BaseDb')
          const { models: modelsTable, properties: propertiesTable } = await import('@/seedSchema')
          const { eq } = await import('drizzle-orm')
          
          // Get model ID from database
          const db = BaseDb.getAppDb()
          if (!db) {
            logger('[Model._setupLiveQuerySubscription] Database not available')
            return
          }

          const modelName = snapshot.context.modelName
          const modelRecords = await db
            .select()
            .from(modelsTable)
            .where(eq(modelsTable.name, modelName))
            .limit(1)

          if (modelRecords.length === 0 || !modelRecords[0].id) {
            logger(`[Model._setupLiveQuerySubscription] Model "${modelName}" not found in database`)
            return
          }

          const modelId = modelRecords[0].id

          // Set up liveQuery to watch properties table for this model
          const properties$ = BaseDb.liveQuery<{ id: number; name: string; dataType: string; modelId: number; refModelId: number | null; refValueType: string | null; schemaFileId: string | null }>(
            (sql) => sql`
              SELECT id, name, data_type as dataType, model_id as modelId, ref_model_id as refModelId, ref_value_type as refValueType, schema_file_id as schemaFileId
              FROM properties
              WHERE model_id = ${modelId}
            `
          )

          const instanceState = modelInstanceState.get(this)
          if (!instanceState) {
            logger('[Model._setupLiveQuerySubscription] Instance state not found')
            return
          }

          // Subscribe to liveQuery updates
          const subscription = properties$.subscribe({
            next: (propertyRows) => {
              logger(`[Model._setupLiveQuerySubscription] Properties updated in database: ${propertyRows.length} properties`)
              
              // Store property file IDs from liveQuery
              const propertyFileIds = propertyRows
                .map(row => row.schemaFileId)
                .filter((id): id is string => id !== null && id !== undefined)
              
              instanceState.liveQueryPropertyIds = propertyFileIds
              
              // Trigger context update (for React reactivity)
              this._service.send({
                type: 'updateContext',
                _propertiesUpdated: Date.now(), // Internal field
              })
            },
            error: (error) => {
              logger(`[Model._setupLiveQuerySubscription] LiveQuery error: ${error}`)
            },
          })

          instanceState.liveQuerySubscription = subscription
          logger(`[Model._setupLiveQuerySubscription] LiveQuery subscription set up for model "${modelName}" (id: ${modelId})`)
        } catch (error) {
          logger(`[Model._setupLiveQuerySubscription] Error setting up subscription: ${error}`)
        }
      }
    })
  }

}

