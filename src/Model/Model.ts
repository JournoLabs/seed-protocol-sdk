import { ActorRefFrom, createActor, SnapshotFrom } from 'xstate'
import { modelMachine, ModelMachineContext } from './service/modelMachine'
import { createReactiveProxy } from '@/helpers/reactiveProxy'
import { BaseItem } from '@/Item/BaseItem'
import { ModelValues } from '@/types'
import { ItemData } from '@/types/item'
import { generateId } from '@/helpers'
import { BaseDb } from '@/db/Db/BaseDb'
import { ConflictError, ConflictResult } from '@/Schema/errors'
import { renameModelInDb } from '@/helpers/db'
import { models as modelsTable } from '@/seedSchema/ModelSchema'
import { eq } from 'drizzle-orm'
import debug from 'debug'

const logger = debug('seedSdk:model:Model')
const saveDraftLogger = debug('seedSdk:model:saveDraftToDb')

type ModelService = ActorRefFrom<typeof modelMachine>
type ModelSnapshot = SnapshotFrom<typeof modelMachine>

// Lazy import cache for ModelProperty to avoid circular dependency
// Eagerly start loading to minimize delay on first access
let ModelPropertyClass: any = null
const modelPropertyImportPromise = import('@/ModelProperty/ModelProperty')
  .then(module => {
    ModelPropertyClass = module.ModelProperty
    return ModelPropertyClass
  })
  .catch(() => {
    // If import fails, ModelPropertyClass remains null
    return null
  })

function getModelProperty(): any {
  // Return cached class if available (synchronous access)
  // Note: On first access before import completes, this will return null
  // and the getter will return empty array, which matches the original behavior
  return ModelPropertyClass
}

// WeakMap to store mutable state per Model instance
// This avoids issues with read-only properties when instances are frozen by Immer
const modelInstanceState = new WeakMap<Model, {
  liveQuerySubscription: { unsubscribe: () => void } | null // LiveQuery subscription for cross-instance property updates
}>()

// Define tracked properties for the Proxy
// These properties will be read from/written to the actor context
const TRACKED_PROPERTIES = [
  'id', // schemaFileId (string) - public ID
  'modelName',
  'schemaName',
  'properties',
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
  
  // Track which models are currently being saved to prevent concurrent saves
  protected static savingModels: Set<string> = new Set()
  
  // Cache client initialization state globally to avoid repeated checks
  private static cachedClientInitialized: boolean | null = null
  private static clientCheckTime: number = 0
  private static readonly CLIENT_CHECK_CACHE_MS = 50 // Cache for 50ms to avoid excessive checks
  
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

  modelName?: string
  schemaName?: string
  properties?: any[] // Array of ModelProperty instances (like Schema.models)
  // 'name' is available as an alias for 'modelName' via the proxy

  constructor(
    modelName: string, 
    schemaName: string, 
    id?: string, // schemaFileId (string) - public ID
    initialContext?: Pick<ModelMachineContext, '_pendingPropertyDefinitions'>
  ) {
    const serviceInput: Pick<ModelMachineContext, 'modelName' | 'schemaName' | 'id' | '_pendingPropertyDefinitions'> = {
      modelName,
      schemaName,
      ...(id ? { id } : {}),
      ...(initialContext?._pendingPropertyDefinitions ? { _pendingPropertyDefinitions: initialContext._pendingPropertyDefinitions } : {}),
    }

    this._service = createActor(modelMachine as any, {
      input: serviceInput,
    }) as ModelService

    this._service.start()

    // Initialize instance state in WeakMap
    modelInstanceState.set(this, {
      liveQuerySubscription: null,
    })
    
    // Set up liveQuery subscription for cross-instance property updates
    this._setupLiveQuerySubscription()
    
    // Subscribe to refresh properties after they're created (for Node.js where liveQuery isn't available)
    let previousState: string | undefined
    this._service.subscribe((snapshot) => {
      // Check if we just transitioned to idle from creatingProperties state
      if (snapshot.value === 'idle' && previousState === 'creatingProperties') {
        console.log('[Model constructor] Transitioned to idle after creating properties, refreshing properties from DB')
        // Small delay to ensure properties are written to DB
        setTimeout(() => {
          this._refreshPropertiesFromDb().catch((error) => {
            logger(`[Model constructor] Error refreshing properties: ${error}`)
          })
        }, 200)
      }
      previousState = snapshot.value as string
    })

    // Note: Property getters/setters are now handled by the Proxy in create()
  }

  /**
   * Find a unique model name by checking for duplicates (case-insensitive) in the cache
   * If duplicates are found, appends an incrementing number to make it unique
   * 
   * @param modelName - The desired model name
   * @param schemaName - The schema name
   * @returns A unique model name
   */
  static findUniqueModelName(modelName: string, schemaName: string): string {
    const lowerModelName = modelName.toLowerCase()
    
    // Check all cached models for this schema
    const existingNames = new Set<string>()
    const existingNumbers = new Set<number>()
    
    // Check name-based cache
    for (const [nameKey, modelFileId] of this.instanceCacheByName.entries()) {
      const [cachedSchemaName, cachedModelName] = nameKey.split(':', 2)
      if (cachedSchemaName === schemaName && cachedModelName) {
        const lowerCachedName = cachedModelName.toLowerCase()
        existingNames.add(lowerCachedName)
        
        // If it matches the base name (case-insensitive), check if it has a number suffix
        if (lowerCachedName === lowerModelName) {
          existingNumbers.add(0) // Base name exists
        } else if (lowerCachedName.startsWith(lowerModelName + ' ')) {
          // Check if it's the base name followed by a space and a number
          const suffix = lowerCachedName.slice(lowerModelName.length + 1)
          const number = parseInt(suffix, 10)
          if (!isNaN(number) && suffix === number.toString()) {
            existingNumbers.add(number)
          }
        }
      }
    }
    
    // Check legacy cache
    for (const [nameKey] of this.instanceCache.keys()) {
      const [cachedSchemaName, cachedModelName] = nameKey.split(':', 2)
      if (cachedSchemaName === schemaName && cachedModelName) {
        const lowerCachedName = cachedModelName.toLowerCase()
        existingNames.add(lowerCachedName)
        
        // If it matches the base name (case-insensitive), check if it has a number suffix
        if (lowerCachedName === lowerModelName) {
          existingNumbers.add(0) // Base name exists
        } else if (lowerCachedName.startsWith(lowerModelName + ' ')) {
          // Check if it's the base name followed by a space and a number
          const suffix = lowerCachedName.slice(lowerModelName.length + 1)
          const number = parseInt(suffix, 10)
          if (!isNaN(number) && suffix === number.toString()) {
            existingNumbers.add(number)
          }
        }
      }
    }
    
    // If no duplicates found, return original name
    if (!existingNames.has(lowerModelName)) {
      return modelName
    }
    
    // Find the next available number
    let nextNumber = 1
    while (existingNumbers.has(nextNumber)) {
      nextNumber++
    }
    
    // Return the name with the number appended
    return `${modelName} ${nextNumber}`
  }

  /**
   * Create a new Model instance or return existing cached instance
   * 
   * @param modelName - The name of the model
   * @param schemaNameOrSchema - The schema name (string) or Schema instance
   * @param options - Optional configuration (can be omitted to create model with empty properties):
   *   - modelFileId: Pre-existing model file ID
   *   - properties: Model properties definition (defaults to empty object if not provided)
   *   - registerWithSchema: Whether to automatically register this model with its schema (default: true if schema instance provided)
   * 
   * @example
   * // Create model with empty properties
   * const model = Model.create('MyModel', schema)
   * 
   * @example
   * // Create model with properties
   * const model = Model.create('MyModel', schema, {
   *   properties: { title: { dataType: 'String' } }
   * })
   */
  static create(
    modelName: string,
    schemaNameOrSchema: string | any, // Schema type - using any to avoid circular dependency
    options?: {
      id?: string // schemaFileId (string) - public ID
      properties?: { [propertyName: string]: any }
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

    // Check for duplicate names (case-insensitive) and generate unique name if needed
    // This only checks the cache - database check happens in loadOrCreateModel
    const uniqueModelName = this.findUniqueModelName(modelName, schemaName)
    if (uniqueModelName !== modelName) {
      logger(`Model.create: Found duplicate name "${modelName}" in schema "${schemaName}", using unique name "${uniqueModelName}"`)
    }

    const id = options?.id // schemaFileId (string) - public ID
    const registerWithSchema = options?.registerWithSchema !== false && schemaInstance !== undefined

    // Create name-based cache key using the unique name
    const nameKey = `${schemaName}:${uniqueModelName}`

    // Step 1: Check ID-based cache first (if ID provided)
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
    let resolvedId = id
    if (!resolvedId) {
      resolvedId = this.instanceCacheByName.get(nameKey)
      if (resolvedId && this.instanceCacheById.has(resolvedId)) {
        const { instance, refCount } = this.instanceCacheById.get(resolvedId)!
        this.instanceCacheById.set(resolvedId, {
          instance,
          refCount: refCount + 1,
        })
        logger(`Model.create: Found instance via name index for "${modelName}" (ID: ${resolvedId})`)
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
      const existingId = context.id // id is now the schemaFileId (string)
      if (existingId) {
        this.instanceCacheById.set(existingId, { instance, refCount: refCount + 1 })
        this.instanceCacheByName.set(nameKey, existingId)
      }
      
      return instance
    }

    // Step 4: Generate ID if not provided (before creating instance)
    if (!resolvedId) {
      resolvedId = generateId()
      logger(`Model.create: Generated new id (schemaFileId) "${resolvedId}" for model "${modelName}"`)
    }
    
    // Step 5: Create new instance with id in initial context
    // This ensures loadOrCreateModel sees the ID immediately
    // Pass _pendingPropertyDefinitions in initial context to avoid race condition with loadOrCreateModel
    // This is the proper XState way - include it in the initial input so it's available from the start
    const initialContext = options?.properties 
      ? { _pendingPropertyDefinitions: JSON.parse(JSON.stringify(options.properties)) } as Pick<ModelMachineContext, '_pendingPropertyDefinitions'>
      : undefined
    
    // Use the unique model name for the instance
    const newInstance = new this(uniqueModelName, schemaName, resolvedId, initialContext)
    
    if (options?.properties) {
      logger(`[Model.create] Created instance with _pendingPropertyDefinitions in initial context (${Object.keys(options.properties).length} properties) for model "${uniqueModelName}"`)
    }

    console.log('newInstance created for', uniqueModelName, 'with id', resolvedId)
    
    // Step 7: Set initial model data if provided
    // Note: description is not supported - JSON files can have it but we ignore it at runtime
    if (options) {
      const updates: any = {}
      
      if (Object.keys(updates).length > 0) {
        newInstance._service.send({
          type: 'updateContext',
          ...updates,
        })
        
        // Initialize original values
        // Note: properties are not stored in context, they're computed from ModelProperty instances
        newInstance._service.send({
          type: 'initializeOriginalValues',
          originalValues: {},
          isEdited: false,
        })
      }
    }
    
    // Wrap instance in Proxy for reactive property access
    // Create a custom proxy that handles 'name' as an alias for 'modelName'
    const proxiedInstance = new Proxy(newInstance, {
      get(target, prop: string | symbol) {
        // Handle special properties
        if (prop === '_service') {
          return Reflect.get(target, prop)
        }
        
        // Handle 'name' as an alias for 'modelName'
        if (prop === 'name') {
          const context = target._getSnapshotContext()
          return context.modelName
        }
        
        // Handle 'id' property - returns the schemaFileId (string)
        if (prop === 'id') {
          const context = target._getSnapshotContext()
          return context.id // id is now the schemaFileId (string)
        }
        
        // Handle tracked properties
        if (typeof prop === 'string' && TRACKED_PROPERTIES.includes(prop as any)) {
          // Special handling for properties - compute from liveQuery + ModelProperty static cache
          if (prop === 'properties') {
            const snapshot = target._service.getSnapshot()
            const context = snapshot.context
            
            // Get property IDs from liveQuery (stored in context, not instanceState)
            const liveQueryIds = context._liveQueryPropertyIds || []
            console.log(`[Model.properties getter] Model "${context.modelName}" (state: ${snapshot.value}) - liveQueryIds:`, Array.isArray(liveQueryIds) ? `[${liveQueryIds.length} items: ${liveQueryIds.join(', ')}]` : liveQueryIds)
            // Get _dbId from context for pending writes lookup
            const dbId: number | undefined = context._dbId // _dbId is the database integer ID
            console.log('_dbId', dbId)
            // Get pending property IDs (synchronous - uses static Map)
            // Lazy import ModelProperty to avoid circular dependency
            const ModelProperty = getModelProperty()
            if (!ModelProperty) {
              // If ModelProperty is not yet loaded, return empty array
              // It will be available on subsequent accesses after the async import completes
              return []
            }
            const pendingIds = dbId ? ModelProperty.getPendingPropertyIds(dbId) : []

            console.log(`[Model.properties getter] Model "${context.modelName}" (state: ${snapshot.value}) - pendingIds:`, pendingIds)
            
            // Combine and deduplicate
            const allPropertyIds = [...new Set([...liveQueryIds, ...pendingIds])]

            console.log('[Model.properties getter] allPropertyIds', allPropertyIds)
            
            // Get ModelProperty instances from static cache (synchronous)
            const propertyInstances: any[] = []
            for (const propertyFileId of allPropertyIds) {
              console.log('[Model.properties getter] propertyFileId', propertyFileId)
              const property = ModelProperty.getById(propertyFileId)
              console.log('[Model.properties getter] property', property)
              if (property) {
                propertyInstances.push(property)
              }
              // Note: Cannot create properties asynchronously in this synchronous getter
              // Properties will be created elsewhere when needed
            }
            
            // CRITICAL: Always create a new array reference so React detects changes
            console.log('[Model.properties getter] propertyInstances', propertyInstances.map(p => p.name))
            return [...propertyInstances]
          }
          
          const context = target._getSnapshotContext()
          return (context as any)[prop]
        }
        
        // For methods and other properties, use Reflect
        return Reflect.get(target, prop)
      },
      
      set(target, prop: string | symbol, value: any) {
        // Handle special properties
        if (prop === '_service') {
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
            const modelFileId = context.id // id is now the schemaFileId (string)
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
            
            // Save draft to database immediately so changes persist
            target._saveDraftToDb(oldName, newName).catch((error) => {
              logger(`Failed to save draft to database: ${error instanceof Error ? error.message : String(error)}`)
            })
            
            // NOTE: Schema is not notified of model name changes during edits.
            // Schema will read from Model instances when persisting/saving.
          } else if (prop === 'properties') {
            // Properties are read-only computed values from ModelProperty instances
            // Cannot be set directly - properties are managed via ModelProperty instances
            throw new Error('Cannot set model.properties directly. Properties are computed from ModelProperty instances.')
          } else if (prop === 'description') {
            // Description is not supported - JSON files can have it but we ignore it at runtime
            throw new Error('Cannot set model.description. Description is not supported in runtime Model instances.')
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
            value: context.id, // id is now the schemaFileId (string)
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
    // resolvedId is guaranteed to be defined at this point (generated if not provided)
    this.instanceCacheById.set(resolvedId!, {
      instance: proxiedInstance,
      refCount: 1,
    })
    
    // Step 8: Store in name-based index
    this.instanceCacheByName.set(nameKey, resolvedId!)
    
    // Step 9: Also store in legacy cache (for backward compatibility during migration)
    this.instanceCache.set(nameKey, {
      instance: proxiedInstance,
      refCount: 1,
    })
    
    logger(`Model.create: Created new instance for "${uniqueModelName}" (ID: ${id})`)
    
    // Step 7.5: Model instance is now cached and accessible via Model.getById() and Model.getByName()
    // No wrapper or store registration needed
    
    // Step 8: Register with schema if requested, OR trigger write if properties are provided
    // If properties are provided, we need to write the model to get modelId for property creation
    // If schema provided, trigger write process instead of registration
    const shouldTriggerWrite = (registerWithSchema && schemaInstance) || (options?.properties && Object.keys(options.properties).length > 0)
    if (shouldTriggerWrite) {
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
            
            // Get schema ID from schema instance or look it up by schema name
            let schemaId: number | undefined
            
            if (schemaInstance) {
              const schemaContext = (schemaInstance as any)._getSnapshotContext()
              const schemaFileId = schemaContext.id // id is the schemaFileId (string) in SchemaMachineContext
              
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
            } else if (schemaName) {
              // If no schema instance but we have schema name, look it up by name
              try {
                const { BaseDb } = await import('@/db/Db/BaseDb')
                const { schemas: schemasTable } = await import('@/seedSchema/SchemaSchema')
                const { eq } = await import('drizzle-orm')
                const db = BaseDb.getAppDb()
                
                if (db) {
                  const schemaRecords = await db
                    .select()
                    .from(schemasTable)
                    .where(eq(schemasTable.name, schemaName))
                    .limit(1)
                  
                  if (schemaRecords.length > 0) {
                    schemaId = schemaRecords[0].id
                  }
                }
              } catch (error) {
                logger(`Error looking up schemaId by name: ${error}`)
              }
            }
            
            if (schemaId && finalSnapshot.context.id) {
              // Track pending write
              Model.trackPendingWrite(finalSnapshot.context.id, schemaId) // id is now the schemaFileId (string)
              
              // Wait for writeProcess to be spawned (it's spawned in idle state entry action)
              // Retry a few times if writeProcess isn't available yet
              let retries = 0
              const maxRetries = 10
              const checkAndSend = async () => {
                const currentSnapshot = proxiedInstance._service.getSnapshot()
                if (currentSnapshot.context.writeProcess) {
                  logger(`Triggering write process for model "${finalSnapshot.context.modelName}" (schemaId: ${schemaId})`)
                  
                  // Use pending property definitions if available, otherwise convert from ModelProperty instances
                  let propertiesObject: { [name: string]: any } = {}
                  if (currentSnapshot.context._pendingPropertyDefinitions) {
                    // Use the original property definitions for the write
                    // Convert dataType to type for validation compatibility
                    propertiesObject = JSON.parse(JSON.stringify(currentSnapshot.context._pendingPropertyDefinitions))
                    for (const [propName, propData] of Object.entries(propertiesObject)) {
                      if (propData.dataType && !propData.type) {
                        propertiesObject[propName] = {
                          ...propData,
                          type: propData.dataType,
                        }
                      }
                    }
                  } else {
                    // Fallback: convert ModelProperty instances to object format
                    const { modelPropertiesToObject } = await import('@/helpers/model')
                    const properties = proxiedInstance.properties || []
                    propertiesObject = modelPropertiesToObject(properties)
                  }
                  
                  // Set up subscription to writeProcess to detect write success BEFORE sending request
                  const writeProcess = currentSnapshot.context.writeProcess
                  
                  // Check current state - if already in success, handle immediately
                  const currentWriteState = writeProcess.getSnapshot()
                  if (currentWriteState.value === 'success') {
                    proxiedInstance._service.send({
                      type: 'writeSuccess',
                      output: currentWriteState.context.entityData,
                    })
                  } else {
                    // Set up subscription to catch future state changes
                    const writeSubscription = writeProcess.subscribe((writeSnapshot) => {
                      if (writeSnapshot.value === 'success') {
                        writeSubscription.unsubscribe()
                        const currentContext = proxiedInstance._service.getSnapshot().context
                        logger(`[writeProcess subscription] Write succeeded, sending writeSuccess event. Has _pendingPropertyDefinitions: ${!!(currentContext._pendingPropertyDefinitions && Object.keys(currentContext._pendingPropertyDefinitions).length > 0)}`)
                        // Send writeSuccess event to model machine
                        proxiedInstance._service.send({
                          type: 'writeSuccess',
                          output: writeSnapshot.context.entityData,
                        })
                      } else if (writeSnapshot.value === 'error') {
                        writeSubscription.unsubscribe()
                        const errorContext = writeSnapshot.context
                        logger(`Write process failed for model "${finalSnapshot.context.modelName}": ${errorContext.error?.message || 'Unknown error'}`)
                        logger(`Write process error details:`, errorContext.error)
                        logger(`Validation errors:`, errorContext.validationErrors)
                      }
                    })
                  }
                  
                  proxiedInstance._service.send({
                    type: 'requestWrite',
                    data: {
                      modelFileId: finalSnapshot.context.id, // id is now the schemaFileId (string)
                      modelName: finalSnapshot.context.modelName,
                      schemaName: finalSnapshot.context.schemaName,
                      schemaId,
                      properties: propertiesObject,
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
              logger(`Cannot trigger write process: missing schemaId (${schemaId}) or id (${finalSnapshot.context.id})`)
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
          id: record.modelFileId, // id is now the schemaFileId (string)
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
        id: modelFileId, // id is now the schemaFileId (string)
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
            id: record.modelFileId, // id is now the schemaFileId (string)
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
      const id = context.id // id is now the schemaFileId (string)
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
        const id = context.id // id is now the schemaFileId (string)
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
      
      // Get current DB record by id (schemaFileId) - most reliable lookup
      const dbModels = await db
        .select()
        .from(modelsTable)
        .where(eq(modelsTable.schemaFileId, context.id)) // id is now the schemaFileId (string)
        .limit(1)
      
      if (dbModels.length === 0) {
        return { hasConflict: false } // No DB record, no conflict
      }
      
      const dbRecord = dbModels[0]
      
      // Check if DB was updated after we loaded
      // Note: models table doesn't have updatedAt, so we can't do timestamp comparison
      // For now, we'll just check if the record exists and matches
      // In the future, if models table gets updatedAt, we can compare timestamps
      return { hasConflict: false }
    } catch (error) {
      logger(`Error checking for conflicts: ${error instanceof Error ? error.message : String(error)}`)
      return { hasConflict: false } // On error, assume no conflict to allow save
    }
  }

  /**
   * Saves model name changes to the database immediately (draft save)
   * This is called when modelName is changed to persist the change immediately
   * @param oldName - The old model name (if name changed)
   * @param newName - The new model name
   */
  private async _saveDraftToDb(oldName?: string, newName?: string): Promise<void> {
    saveDraftLogger(`_saveDraftToDb called for model (oldName: "${oldName}", newName: "${newName}")`)
    
    // Don't save during initialization - models are being loaded from files, not created as drafts
    // Check this FIRST before doing any expensive work like _getSnapshotContext()
    if (typeof window !== 'undefined') {
      const now = Date.now()
      // Use cached check to avoid expensive operations
      // Always check if cache is stale or if we previously got false (to allow recovery)
      const cacheIsStale = Model.cachedClientInitialized === null || (now - Model.clientCheckTime) > Model.CLIENT_CHECK_CACHE_MS
      const shouldRecheck = cacheIsStale || Model.cachedClientInitialized === false
      
      saveDraftLogger(`Client check: cacheIsStale=${cacheIsStale}, shouldRecheck=${shouldRecheck}, cachedValue=${Model.cachedClientInitialized}, timeSinceCheck=${now - Model.clientCheckTime}ms`)
      
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
          Model.cachedClientInitialized = isIdle && (isInitialized !== false)
          Model.clientCheckTime = now
          saveDraftLogger(`Client state checked: state=${clientSnapshot.value}, isIdle=${isIdle}, isInitialized=${isInitialized}, result=${Model.cachedClientInitialized}`)
        } catch (error) {
          // If we can't check client state, assume not initialized to be safe
          // But only cache for a short time to allow recovery
          Model.cachedClientInitialized = false
          Model.clientCheckTime = now
          saveDraftLogger(`Error checking client state: ${error instanceof Error ? error.message : String(error)}, setting cachedClientInitialized=false`)
        }
      } else {
        saveDraftLogger(`Using cached client state: cachedClientInitialized=${Model.cachedClientInitialized}`)
      }
      
      if (!Model.cachedClientInitialized) {
        saveDraftLogger(`Client not initialized, skipping save (oldName: "${oldName}", newName: "${newName}")`)
        // Skip silently during initialization to avoid log spam and reduce overhead
        return
      }
    }
    
    saveDraftLogger(`Client is initialized, proceeding with save (oldName: "${oldName}", newName: "${newName}")`)
    
    // Check for conflicts before saving
    const conflictCheck = await this._checkForConflicts()
    if (conflictCheck.hasConflict) {
      const errorMessage = conflictCheck.message || 'Database was updated externally. Please reload the model and try again.'
      saveDraftLogger(`CONFLICT DETECTED: ${errorMessage}`)
      throw new ConflictError(errorMessage, conflictCheck)
    }
    
    const context = this._getSnapshotContext()
    const modelFileId = context.id || '' // id is now the schemaFileId (string)
    const modelName = newName || context.modelName || oldName || ''
    
    // Use modelFileId as the key if available, otherwise use schemaName:modelName
    const saveKey = modelFileId || `${context.schemaName}:${modelName}`
    
    // Prevent concurrent saves for the same model
    if (Model.savingModels.has(saveKey)) {
      saveDraftLogger(`Model ${modelName} (key: ${saveKey}) is already being saved, skipping concurrent save`)
      return
    }
    
    Model.savingModels.add(saveKey)
    saveDraftLogger(`Starting save for model ${modelName} (key: ${saveKey}, id: ${modelFileId})`)
    
    try {
      const db = BaseDb.getAppDb()
      if (!db) {
        throw new Error('Database not found')
      }

      // If name changed, use renameModelInDb
      if (oldName && newName && oldName !== newName) {
        saveDraftLogger(`Renaming model from "${oldName}" to "${newName}"`)
        await renameModelInDb(oldName, newName)
        saveDraftLogger(`Successfully renamed model from "${oldName}" to "${newName}"`)
      } else {
        // For other tracked properties, we would save here
        // Currently only modelName is saved immediately, so this is a no-op
        saveDraftLogger(`No name change detected, skipping save (modelName: "${modelName}")`)
      }
      
      // Update conflict detection metadata after successful save
      // Note: models table doesn't have updatedAt, so we use current timestamp
      const now = Date.now()
      this._service.send({
        type: 'updateContext',
        _dbUpdatedAt: now,
      })
      
    } catch (error) {
      logger(`Failed to save draft to database: ${error instanceof Error ? error.message : String(error)}`)
      // Don't throw - allow operation to continue
    } finally {
      // Always remove from saving set
      Model.savingModels.delete(saveKey)
      saveDraftLogger(`Finished save for model ${modelName} (key: ${saveKey})`)
    }
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

  get id() {
    return this._getSnapshotContext().id // id is now the schemaFileId (string)
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
      schemaName: this.schemaName,
      modelInstance: this,
      ...values,
    } as Partial<ItemData> & { modelName: string; schemaName?: string; modelInstance?: Model } & Record<string, any>)
    return item
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
    const modelFileId = context.id // id is now the schemaFileId (string)
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
    const modelFileId = context.id // id is now the schemaFileId (string)
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
    const isBrowser = typeof window !== 'undefined'
    console.log(`[Model._setupLiveQuerySubscription] Starting setup for model (browser: ${isBrowser})`)

    // Track if we've already set up the subscription to avoid duplicate subscriptions
    let subscriptionSetUp = false

    const setupLiveQuery = async (modelId: number, modelName: string) => {
      console.log('[Model._setupLiveQuerySubscription] setupLiveQuery called with modelId:', modelId, 'modelName:', modelName, 'subscriptionSetUp:', subscriptionSetUp)
      if (subscriptionSetUp) {
        console.log('[Model._setupLiveQuerySubscription] Subscription already set up, skipping')
        return
      }

      subscriptionSetUp = true
      console.log('[Model._setupLiveQuerySubscription] Setting up property query...')
      
      try {
        const { BaseDb } = await import('@/db/Db/BaseDb')
        const { properties: propertiesTable } = await import('@/seedSchema')
        const { eq } = await import('drizzle-orm')
        
        const db = BaseDb.getAppDb()
        if (!db) {
          logger('[Model._setupLiveQuerySubscription] Database not available')
          return
        }

        // Query initial properties immediately and update context
        // This works in both browser and Node.js environments
        const initialProperties = await db
          .select({ schemaFileId: propertiesTable.schemaFileId })
          .from(propertiesTable)
          .where(eq(propertiesTable.modelId, modelId))

        const initialPropertyIds = initialProperties
          .map((row: { schemaFileId: string | null }) => row.schemaFileId)
          .filter((id: string | null): id is string => id !== null && id !== undefined)

        console.log(`[Model._setupLiveQuerySubscription] Initial query for model "${modelName}" (id: ${modelId}) returned ${initialPropertyIds.length} properties:`, initialPropertyIds)

        // CRITICAL: Create ModelProperty instances BEFORE updating context
        // This ensures they're in the cache when the properties getter is called
        if (initialPropertyIds.length > 0) {
          try {
            const { ModelProperty } = await import('@/ModelProperty/ModelProperty')
            const createPromises = initialPropertyIds.map(async (propertyFileId: string) => {
              try {
                const property = await ModelProperty.createById(propertyFileId)
                if (property) {
                  logger(`[Model._setupLiveQuerySubscription] Created/cached ModelProperty instance for propertyFileId "${propertyFileId}"`)
                } else {
                  logger(`[Model._setupLiveQuerySubscription] ModelProperty.createById returned undefined for propertyFileId "${propertyFileId}"`)
                }
              } catch (error) {
                logger(`[Model._setupLiveQuerySubscription] Error creating ModelProperty instance for propertyFileId "${propertyFileId}": ${error}`)
              }
            })
            await Promise.all(createPromises)
            console.log(`[Model._setupLiveQuerySubscription] Created ${initialPropertyIds.length} ModelProperty instances before updating context`)
          } catch (error) {
            logger(`[Model._setupLiveQuerySubscription] Error importing ModelProperty or creating instances: ${error}`)
          }
        }

        // Update context with initial property IDs AFTER creating instances
        console.log(`[Model._setupLiveQuerySubscription] Sending updateContext with _liveQueryPropertyIds:`, initialPropertyIds)
        
        // Subscribe to verify the context update is applied
        let contextUpdated = false
        const updateSubscription = this._service.subscribe((snapshot) => {
          if (snapshot.context._liveQueryPropertyIds && snapshot.context._liveQueryPropertyIds.length > 0) {
            console.log(`[Model._setupLiveQuerySubscription] Context updated via subscription! _liveQueryPropertyIds:`, snapshot.context._liveQueryPropertyIds)
            contextUpdated = true
            updateSubscription.unsubscribe()
          }
        })
        
        this._service.send({
          type: 'updateContext',
          _liveQueryPropertyIds: initialPropertyIds,
        })
        
        // Wait for the context update to be applied (with timeout)
        let attempts = 0
        while (!contextUpdated && attempts < 50) {
          await new Promise(resolve => setTimeout(resolve, 10))
          attempts++
          const snapshot = this._service.getSnapshot()
          if (snapshot.context._liveQueryPropertyIds && snapshot.context._liveQueryPropertyIds.length > 0) {
            console.log(`[Model._setupLiveQuerySubscription] Context updated after ${attempts * 10}ms - _liveQueryPropertyIds:`, snapshot.context._liveQueryPropertyIds)
            contextUpdated = true
            break
          }
        }
        
        updateSubscription.unsubscribe()
        
        // Final verification
        const snapshot = this._service.getSnapshot()
        console.log(`[Model._setupLiveQuerySubscription] Final context check - _liveQueryPropertyIds:`, snapshot.context._liveQueryPropertyIds, 'length:', snapshot.context._liveQueryPropertyIds?.length || 0)

        // Only set up liveQuery subscription in browser environment
        if (isBrowser) {
          // Set up liveQuery to watch properties table for this model
          const properties$ = BaseDb.liveQuery<{ id: number; name: string; dataType: string; modelId: number; refModelId: number | null; refValueType: string | null; schemaFileId: string | null }>(
            (sql: any) => sql`
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
            next: async (propertyRows) => {
              logger(`[Model._setupLiveQuerySubscription] Properties updated in database: ${propertyRows.length} properties`)
              console.log(`[Model._setupLiveQuerySubscription] Properties updated in database: ${propertyRows.length} properties`, propertyRows.map(r => r.schemaFileId))
              
              // Store property file IDs from liveQuery
              const propertyFileIds = propertyRows
                .map(row => row.schemaFileId)
                .filter((id): id is string => id !== null && id !== undefined)
              
              console.log(`[Model._setupLiveQuerySubscription] Extracted property IDs:`, propertyFileIds)
              
              // CRITICAL: Create ModelProperty instances BEFORE updating context
              // This ensures they're in the cache when the properties getter is called
              if (propertyFileIds.length > 0) {
                try {
                  const { ModelProperty } = await import('@/ModelProperty/ModelProperty')
                  const createPromises = propertyFileIds.map(async (propertyFileId: string) => {
                    try {
                      const property = await ModelProperty.createById(propertyFileId)
                      if (property) {
                        logger(`[Model._setupLiveQuerySubscription] Created/cached ModelProperty instance for propertyFileId "${propertyFileId}" from liveQuery`)
                      } else {
                        logger(`[Model._setupLiveQuerySubscription] ModelProperty.createById returned undefined for propertyFileId "${propertyFileId}"`)
                      }
                    } catch (error) {
                      logger(`[Model._setupLiveQuerySubscription] Error creating ModelProperty instance for propertyFileId "${propertyFileId}": ${error}`)
                    }
                  })
                  await Promise.all(createPromises)
                  console.log(`[Model._setupLiveQuerySubscription] Created ${propertyFileIds.length} ModelProperty instances from liveQuery before updating context`)
                } catch (error) {
                  logger(`[Model._setupLiveQuerySubscription] Error importing ModelProperty or creating instances from liveQuery: ${error}`)
                }
              }
              
              // Update context with property IDs AFTER creating instances (like Schema does with model IDs)
              this._service.send({
                type: 'updateContext',
                _liveQueryPropertyIds: propertyFileIds, // Store in service context for reactivity
                _propertiesUpdated: Date.now(), // Internal field for tracking
              })
            },
            error: (error) => {
              logger(`[Model._setupLiveQuerySubscription] LiveQuery error: ${error}`)
            },
          })

          instanceState.liveQuerySubscription = subscription
          logger(`[Model._setupLiveQuerySubscription] LiveQuery subscription set up for model "${modelName}" (id: ${modelId})`)
          console.log(`[Model._setupLiveQuerySubscription] LiveQuery subscription set up for model "${modelName}" (id: ${modelId})`)
        } else {
          console.log(`[Model._setupLiveQuerySubscription] Skipping liveQuery subscription in Node.js environment (properties already loaded from database)`)
        }
      } catch (error) {
        logger(`[Model._setupLiveQuerySubscription] Error setting up subscription: ${error}`)
        subscriptionSetUp = false // Reset on error so we can retry
      }
    }

    // Set up liveQuery subscription as soon as we have a modelId
    // The liveQuery will automatically detect when properties are added to the database
    const setupSubscription = this._service.subscribe(async (snapshot) => {
      // Check if we have a _dbId (either from context or can be found in DB)
      let dbId = snapshot.context._dbId // _dbId is the database integer ID
      const modelName = snapshot.context.modelName
      
      if (!modelName) {
        return // Need modelName to proceed
      }
      
      // If we don't have _dbId yet, try to find it in the database
      if (!dbId) {
        try {
          const { BaseDb } = await import('@/db/Db/BaseDb')
          const { models: modelsTable } = await import('@/seedSchema')
          const { eq } = await import('drizzle-orm')
          
          const db = BaseDb.getAppDb()
          if (!db) {
            return
          }

          const modelRecords = await db
            .select()
            .from(modelsTable)
            .where(eq(modelsTable.name, modelName))
            .limit(1)

          if (modelRecords.length === 0 || !modelRecords[0].id) {
            // Model not in database yet, will retry on next snapshot update
            return
          }

          dbId = modelRecords[0].id

          // Update context with _dbId
          this._service.send({
            type: 'updateContext',
            _dbId: dbId,
          })
        } catch (error) {
          logger(`[Model._setupLiveQuerySubscription] Error finding model: ${error}`)
          return
        }
      }

      // Once we have _dbId, set up the liveQuery subscription (only once)
      if (dbId && !subscriptionSetUp) {
        console.log('[Model._setupLiveQuerySubscription] Setting up liveQuery with _dbId:', dbId, 'modelName:', modelName)
        await setupLiveQuery(dbId, modelName)
        if (subscriptionSetUp) {
          setupSubscription.unsubscribe()
        }
      }
    })
    
    // Also check current state immediately in case _dbId is already available
    const currentSnapshot = this._service.getSnapshot()
    if (currentSnapshot.context._dbId && !subscriptionSetUp) {
      console.log('[Model._setupLiveQuerySubscription] Setting up liveQuery immediately with existing _dbId:', currentSnapshot.context._dbId)
      setupLiveQuery(currentSnapshot.context._dbId, currentSnapshot.context.modelName).catch((error) => {
        logger(`[Model._setupLiveQuerySubscription] Error in immediate setup: ${error}`)
        console.error('[Model._setupLiveQuerySubscription] Error in immediate setup:', error)
      })
    }
  }

  /**
   * Refresh property IDs from database (useful in Node.js where liveQuery isn't available)
   */
  private async _refreshPropertiesFromDb(): Promise<void> {
    const snapshot = this._service.getSnapshot()
    const dbId = snapshot.context._dbId // _dbId is the database integer ID
    const modelName = snapshot.context.modelName

    if (!dbId || !modelName) {
      return
    }

    try {
      const { BaseDb } = await import('@/db/Db/BaseDb')
      const { properties: propertiesTable } = await import('@/seedSchema')
      const { eq } = await import('drizzle-orm')
      
      const db = BaseDb.getAppDb()
      if (!db) {
        return
      }

      const propertyRows = await db
        .select({ schemaFileId: propertiesTable.schemaFileId })
        .from(propertiesTable)
        .where(eq(propertiesTable.modelId, dbId)) // Use _dbId (database integer ID)

      const propertyIds = propertyRows
        .map((row: { schemaFileId: string | null }) => row.schemaFileId)
        .filter((id: string | null): id is string => id !== null && id !== undefined)

      console.log(`[Model._refreshPropertiesFromDb] Refreshed properties for model "${modelName}" (id: ${dbId}): ${propertyIds.length} properties`, propertyIds)

      // CRITICAL: Create ModelProperty instances BEFORE updating context
      // This ensures they're in the cache when the properties getter is called
      if (propertyIds.length > 0) {
        try {
          const { ModelProperty } = await import('@/ModelProperty/ModelProperty')
          const createPromises = propertyIds.map(async (propertyFileId: string) => {
            try {
              const property = await ModelProperty.createById(propertyFileId)
              if (property) {
                logger(`[Model._refreshPropertiesFromDb] Created/cached ModelProperty instance for propertyFileId "${propertyFileId}"`)
              } else {
                logger(`[Model._refreshPropertiesFromDb] ModelProperty.createById returned undefined for propertyFileId "${propertyFileId}"`)
              }
            } catch (error) {
              logger(`[Model._refreshPropertiesFromDb] Error creating ModelProperty instance for propertyFileId "${propertyFileId}": ${error}`)
            }
          })
          await Promise.all(createPromises)
          console.log(`[Model._refreshPropertiesFromDb] Created ${propertyIds.length} ModelProperty instances before updating context`)
        } catch (error) {
          logger(`[Model._refreshPropertiesFromDb] Error importing ModelProperty or creating instances: ${error}`)
        }
      }

      // Update context with refreshed property IDs AFTER creating instances
      this._service.send({
        type: 'updateContext',
        _liveQueryPropertyIds: propertyIds,
        _propertiesUpdated: Date.now(),
      })
    } catch (error) {
      logger(`[Model._refreshPropertiesFromDb] Error refreshing properties: ${error}`)
    }
  }

  /**
   * Public method to refresh properties from database
   */
  async refreshProperties(): Promise<void> {
    await this._refreshPropertiesFromDb()
  }

}

