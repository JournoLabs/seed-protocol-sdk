import { ActorRefFrom, createActor, SnapshotFrom } from 'xstate'
import { Static } from '@sinclair/typebox'
import { ModelPropertyDataTypes, TProperty } from '@/Schema'
import { modelPropertyMachine, ModelPropertyMachineContext } from './service/modelPropertyMachine'
import { StorageType } from '@/types'
import { BaseFileManager, generateId } from '@/helpers'
import { createReactiveProxy } from '@/helpers/reactiveProxy'
import debug from 'debug'

const logger = debug('seedSdk:modelProperty:ModelProperty')

type ModelPropertyService = ActorRefFrom<typeof modelPropertyMachine>
type ModelPropertySnapshot = SnapshotFrom<typeof modelPropertyMachine>

// Define the property keys from TProperty
const TPropertyKeys = [
  'id',
  'name',
  'dataType',
  'ref',
  'modelId',
  'refModelId',
  'refValueType',
  'storageType',
  'localStorageDir',
  'filenameSuffix',
  'modelName',
  'refModelName',
] as const

export class ModelProperty {
  protected static instanceCache: Map<
    string,
    { instance: ModelProperty; refCount: number }
  > = new Map()
  
  // Pending writes tracking
  private static pendingWrites = new Map<string, {
    propertyFileId: string
    modelId: number
    status: 'pending' | 'writing' | 'success' | 'error'
    timestamp: number
  }>()
  
  protected readonly _service: ModelPropertyService

  name?: string
  dataType?: ModelPropertyDataTypes
  ref?: string
  modelId?: number
  modelName?: string
  refModelId?: number
  refModelName?: string
  refValueType?: ModelPropertyDataTypes
  storageType?: StorageType
  localStorageDir?: string
  filenameSuffix?: string

  constructor(property: Static<typeof TProperty>) {
    // id is now the schemaFileId (string), _dbId is the database integer ID
    // Preserve _propertyFileId if it exists in the property object (from getPropertySchema)
    const serviceInput: ModelPropertyMachineContext = {
      ...property,
      _propertyFileId: (property as any)._propertyFileId || property.id,
    }

    this._service = createActor(modelPropertyMachine, {
      input: serviceInput,
    })

    this._service.start()

    // Initialize original values from the input property
    this._initializeOriginalValues(property)

    // Note: Property getters/setters are now handled by the Proxy in create()
  }

  /**
   * Initialize original values and schema name for tracking changes
   * This is called asynchronously after construction
   * If the property was loaded from the database and differs from the schema file,
   * it will be marked as edited.
   */
  private _initializeOriginalValues(property: Static<typeof TProperty>): void {
    // Resolve refModelId if ref/refModelName is provided but refModelId is missing
    const refModelName = property.refModelName || property.ref
    if (refModelName && !property.refModelId) {
      // Resolve refModelId asynchronously and update context
      this._resolveRefModelId(refModelName).then((refModelId) => {
        if (refModelId) {
          // Update the context with the resolved refModelId
          this._service.send({
            type: 'updateContext',
            refModelId,
          })
        }
      }).catch(() => {
        // Ignore errors - model might not exist yet
      })
    }

    // Get schema file values to use as "original" values
    // This allows us to detect if the property was edited (DB value differs from schema file)
    this._getSchemaFileValues(property).then((schemaFileValues) => {
      // Use schema file values as original (not the current property values)
      // This way, if current values differ from schema file, _isEdited will be true
      const originalValues: Partial<Static<typeof TProperty>> = schemaFileValues || {}
      
      // Compare current property values with schema file values to determine if edited
      // Only compare schema-relevant fields, not database-specific fields like id, modelId
      let isEdited = false
      if (schemaFileValues) {
        // Fields that are schema-relevant and should be compared
        const schemaRelevantFields: (keyof Static<typeof TProperty>)[] = [
          'dataType',
          'ref',
          'refModelName',
          'refValueType',
          'storageType',
          'localStorageDir',
          'filenameSuffix',
        ]
        
        // Check if any schema-relevant field differs between current property and schema file
        isEdited = schemaRelevantFields.some((key) => {
          const currentValue = (property as any)[key]
          const originalValue = (schemaFileValues as any)[key]
          
          // Handle ref fields - compare by name
          if (key === 'ref' || key === 'refModelName') {
            const currentRef = property.refModelName || property.ref
            const originalRef = schemaFileValues.refModelName || schemaFileValues.ref
            // Both undefined/null means no ref, so they're the same
            if (!currentRef && !originalRef) return false
            return currentRef !== originalRef
          }
          
          // For other fields, compare values (handling undefined/null)
          if (currentValue === undefined && originalValue === undefined) return false
          if (currentValue === null && originalValue === null) return false
          if (currentValue === undefined && originalValue === null) return false
          if (currentValue === null && originalValue === undefined) return false
          
          return currentValue !== originalValue
        })
      } else {
        // No schema file values found - this is a runtime-created property
        // Use current property as original, but mark as edited since it hasn't been exported to file
        TPropertyKeys.forEach((key) => {
          if (property[key] !== undefined) {
            (originalValues as any)[key] = property[key]
          }
        })
        // For runtime-created properties, set isEdited = true initially
        isEdited = true
      }

      // Initialize with original values, including isEdited flag
      // Load isEdited from database if property exists in DB (async, fire-and-forget)
      this._loadIsEditedFromDb(property, isEdited).then((isEditedFromDb: boolean) => {
        this._service.send({
          type: 'initializeOriginalValues',
          originalValues,
          schemaName: undefined, // Will be set later if needed
          isEdited: isEditedFromDb,
        })
      }).catch(() => {
        // If we can't load from DB, use computed isEdited value
        this._service.send({
          type: 'initializeOriginalValues',
          originalValues,
          schemaName: undefined, // Will be set later if needed
          isEdited,
        })
      })
    }).catch(() => {
      // If we can't get schema file values, use current property as original
      const originalValues: Partial<Static<typeof TProperty>> = {}
      TPropertyKeys.forEach((key) => {
        if (property[key] !== undefined) {
          (originalValues as any)[key] = property[key]
        }
      })

      this._service.send({
        type: 'initializeOriginalValues',
        originalValues,
        schemaName: undefined,
      })
    })

    // Get schema name from model asynchronously (fire-and-forget)
    if (property.modelName) {
      this._setSchemaName(property.modelName).catch(() => {
        // If we can't get schema name, that's okay - it will be set later if needed
      })
    }
  }

  /**
   * Load isEdited flag from database if property exists in DB
   * @param property - The property data
   * @param fallbackIsEdited - Fallback value if property doesn't exist in DB
   * @returns The isEdited flag from database or fallback value
   */
  private async _loadIsEditedFromDb(
    property: Static<typeof TProperty>,
    fallbackIsEdited: boolean,
  ): Promise<boolean> {
    if (!property.modelName || !property.name) {
      return fallbackIsEdited
    }

    try {
      const { BaseDb } = await import('@/db/Db/BaseDb')
      const { properties: propertiesTable, models: modelsTable } = await import('@/seedSchema')
      const { eq, and } = await import('drizzle-orm')
      
      const db = BaseDb.getAppDb()
      if (!db) {
        return fallbackIsEdited
      }

      // Find model by name
      const modelRecords = await db
        .select({ id: modelsTable.id })
        .from(modelsTable)
        .where(eq(modelsTable.name, property.modelName))
        .limit(1)
      
      if (modelRecords.length === 0) {
        return fallbackIsEdited
      }

      // Find property by name and modelId
      const propertyRecords = await db
        .select({ isEdited: propertiesTable.isEdited })
        .from(propertiesTable)
        .where(
          and(
            eq(propertiesTable.name, property.name),
            eq(propertiesTable.modelId, modelRecords[0].id)
          )
        )
        .limit(1)
      
      if (propertyRecords.length > 0) {
        return propertyRecords[0].isEdited ?? false
      }
    } catch (error) {
      // Ignore errors - use fallback value
    }

    return fallbackIsEdited
  }

  /**
   * Resolve refModelId from refModelName by querying the database
   * @param refModelName - The name of the referenced model
   * @returns The database ID of the referenced model, or undefined if not found
   */
  private async _resolveRefModelId(refModelName: string): Promise<number | undefined> {
    if (!refModelName) {
      return undefined
    }

    try {
      const { BaseDb } = await import('@/db/Db/BaseDb')
      const seedSchema = await import('@/seedSchema')
      const modelsTable = seedSchema.models
      const { eq } = await import('drizzle-orm')
      
      const db = BaseDb.getAppDb()
      if (!db) {
        return undefined
      }

      const refModelRecords = await db
        .select()
        .from(modelsTable)
        .where(eq(modelsTable.name, refModelName))
        .limit(1)
      
      if (refModelRecords.length > 0 && refModelRecords[0].id) {
        return refModelRecords[0].id
      }
    } catch (error) {
      // Ignore errors - model might not exist yet or database not available
      logger(`Error resolving refModelId for model "${refModelName}":`, error)
    }

    return undefined
  }

  /**
   * Get schema file values for this property to use as "original" values
   * This allows comparison with database values to detect edits
   */
  private async _getSchemaFileValues(
    property: Static<typeof TProperty>,
  ): Promise<Partial<Static<typeof TProperty>> | undefined> {
    if (!property.modelName || !property.name) {
      return undefined
    }

    try {
      const { Model } = await import('@/Model/Model')
      const { modelPropertiesToObject } = await import('@/helpers/model')
      const model = await Model.getByNameAsync(property.modelName)
      
      if (!model || !model.properties || model.properties.length === 0) {
        return undefined
      }

      const schema = modelPropertiesToObject(model.properties)
      // Get the schema file value for this property
      const schemaFileValue = schema[property.name]
      if (!schemaFileValue) {
        return undefined
      }

      // Return schema file values as original values
      const originalValues: Partial<Static<typeof TProperty>> = {
        name: property.name,
        modelName: property.modelName,
        dataType: schemaFileValue.dataType,
        storageType: schemaFileValue.storageType,
        localStorageDir: schemaFileValue.localStorageDir,
        filenameSuffix: schemaFileValue.filenameSuffix,
      }

      // Handle ref fields
      if (schemaFileValue.ref) {
        originalValues.ref = schemaFileValue.ref
        originalValues.refModelName = schemaFileValue.ref
        // Try to get refModelId from database
        const refModelId = await this._resolveRefModelId(schemaFileValue.ref)
        if (refModelId) {
          originalValues.refModelId = refModelId
        }
      }

      if (schemaFileValue.refValueType) {
        originalValues.refValueType = schemaFileValue.refValueType
      }

      return originalValues
    } catch (error) {
      return undefined
    }
  }

  /**
   * Set the schema name for this property by looking it up from the model
   * Tries database first (more reliable), then falls back to schema files
   */
  private async _setSchemaName(modelName: string): Promise<void> {
    try {
      let schemaName: string | undefined

      // Try to get schema name from database first (more reliable)
      if (this.modelId) {
        try {
          const { BaseDb } = await import('@/db/Db/BaseDb')
          const seedSchema = await import('@/seedSchema')
          const modelsTable = seedSchema.models
          const modelSchemas = seedSchema.modelSchemas
          const schemas = seedSchema.schemas
          const { eq } = await import('drizzle-orm')
          
          const db = BaseDb.getAppDb()
          if (db) {
            const modelSchemaRecords = await db
              .select({
                schemaName: schemas.name,
              })
              .from(modelSchemas)
              .innerJoin(schemas, eq(modelSchemas.schemaId, schemas.id))
              .innerJoin(modelsTable, eq(modelSchemas.modelId, modelsTable.id))
              .where(eq(modelsTable.id, this.modelId))
              .limit(1)

            if (modelSchemaRecords.length > 0) {
              schemaName = modelSchemaRecords[0].schemaName
            }
          }
        } catch (error) {
          // Database lookup failed, continue to file-based lookup
        }
      }

      // Fall back to schema file lookup if database didn't work
      if (!schemaName) {
        const { getSchemaNameFromModel } = await import('./service/actors/saveToSchema')
        schemaName = await getSchemaNameFromModel(modelName)
      }

      if (schemaName) {
        // Update the context with the schema name using dedicated event
        this._service.send({
          type: 'setSchemaName',
          schemaName,
        })
      }
    } catch (error) {
      // If we can't get schema name, that's okay - it will be set later if needed
    }
  }

  /**
   * Manually set the schema name for this property
   * Useful when you know the schema name from context (e.g., when working with Schema instances)
   */
  setSchemaName(schemaName: string): void {
    this._service.send({
      type: 'setSchemaName',
      schemaName,
    })
  }

  static create(property: Static<typeof TProperty>): ModelProperty {
    if (!property) {
      throw new Error('Property is required')
    }

    // Debug: Log what's being passed to create()
    console.log(`[ModelProperty.create] Input property data:`, JSON.stringify({
      name: property.name,
      modelName: property.modelName,
      ref: property.ref,
      refModelName: property.refModelName,
      refModelId: property.refModelId,
      dataType: property.dataType,
      type: (property as any).type, // Check if it's using 'type' instead of 'dataType'
    }, null, 2))

    // Handle 'type' field from JSON schema format - convert to 'dataType'
    const propertyWithId = { ...property }
    if ((propertyWithId as any).type && !propertyWithId.dataType) {
      propertyWithId.dataType = (propertyWithId as any).type
    }
    
    // Generate id (schemaFileId) if not provided (for new properties)
    // This ensures new properties can trigger write process
    if (!propertyWithId.id) {
      propertyWithId.id = generateId()
      logger(`ModelProperty.create: Generated new id (schemaFileId) "${propertyWithId.id}" for property "${property.name}"`)
    }

    // Create cache key from modelName and name, or use id
    const cacheKey = propertyWithId.modelName && propertyWithId.name
      ? `${propertyWithId.modelName}:${propertyWithId.name}`
      : propertyWithId.id
      ? `id:${propertyWithId.id}`
      : propertyWithId.name || 'unnamed'

    // Check if instance exists in cache
    if (this.instanceCache.has(cacheKey)) {
      const { instance, refCount } = this.instanceCache.get(cacheKey)!
      const cachedContext = instance._getSnapshotContext()
      console.log(`[ModelProperty.create] Returning cached instance for ${cacheKey}, context has ref:`, cachedContext.ref)
      
      // Update cached instance if new property data has fields that the cached instance doesn't have
      // This handles cases where the property was created without ref initially, but now we have ref from schema
      const needsUpdate: any = {}
      if (propertyWithId.ref && !cachedContext.ref) {
        needsUpdate.ref = propertyWithId.ref
      }
      if (propertyWithId.refModelName && !cachedContext.refModelName) {
        needsUpdate.refModelName = propertyWithId.refModelName
      }
      if (propertyWithId.refModelId && !cachedContext.refModelId) {
        needsUpdate.refModelId = propertyWithId.refModelId
      }
      
      if (Object.keys(needsUpdate).length > 0) {
        console.log(`[ModelProperty.create] Updating cached instance with missing fields:`, needsUpdate)
        instance._service.send({
          type: 'updateContext',
          ...needsUpdate,
        })
      }
      
      this.instanceCache.set(cacheKey, {
        instance,
        refCount: refCount + 1,
      })
      return instance
    }

    // Debug: Log what's being passed to the constructor
    console.log(`[ModelProperty.create] propertyWithId before constructor:`, JSON.stringify({
      name: propertyWithId.name,
      modelName: propertyWithId.modelName,
      ref: propertyWithId.ref,
      refModelName: propertyWithId.refModelName,
      refModelId: propertyWithId.refModelId,
      dataType: propertyWithId.dataType,
    }, null, 2))
    
    const newInstance = new this(propertyWithId)
    
    // Debug: Log what's being passed to the constructor
    console.log(`[ModelProperty.create] Creating instance for ${propertyWithId.modelName}:${propertyWithId.name}`, {
      ref: propertyWithId.ref,
      refModelName: propertyWithId.refModelName,
      refModelId: propertyWithId.refModelId,
      dataType: propertyWithId.dataType
    })
    
    // Wrap instance in Proxy for reactive property access
    const proxiedInstance = createReactiveProxy<ModelProperty>({
      instance: newInstance,
      service: newInstance._service,
      trackedProperties: TPropertyKeys,
      getContext: (instance) => {
        const context = instance._getSnapshotContext()
        console.log(`[ModelProperty.create] getContext for ${propertyWithId.modelName}:${propertyWithId.name}`, {
          ref: context.ref,
          refModelName: context.refModelName,
          refModelId: context.refModelId
        })
        return context
      },
      sendUpdate: (instance, prop: string, value: any) => {
        instance._service.send({
          type: 'updateContext',
          [prop]: value,
        })
      },
    })
    
    this.instanceCache.set(cacheKey, {
      instance: proxiedInstance,
      refCount: 1,
    })
    
    // Trigger write process if property has modelId (or modelName) and id (schemaFileId)
    // Wait for service to be ready (idle state) and have writeProcess spawned
    const propertyFileId = propertyWithId.id // id is now the schemaFileId (string)
    const hasModelId = propertyWithId.modelId || propertyWithId.modelName
    
    if (hasModelId && propertyFileId) {
      // Wait for writeProcess to be spawned (it's spawned in idle state entry action)
      // Retry a few times if writeProcess isn't available yet
      let retries = 0
      const maxRetries = 10
      const checkAndSend = async () => {
        const service = proxiedInstance.getService()
        const snapshot = service.getSnapshot()
        
        if (snapshot.value === 'idle' && snapshot.context.writeProcess) {
          const writeProcess = snapshot.context.writeProcess
          
          // Resolve dbModelId - convert from string (modelFileId) to number (database ID) if needed
          let resolvedModelId: number | undefined = undefined
          
          if (propertyWithId.modelId) {
            if (typeof propertyWithId.modelId === 'number') {
              resolvedModelId = propertyWithId.modelId
            } else if (typeof propertyWithId.modelId === 'string') {
              // modelId is a string (modelFileId), need to convert to database ID
              try {
                const { getModelIdByFileId } = await import('@/helpers/db')
                resolvedModelId = await getModelIdByFileId(propertyWithId.modelId)
                logger(`Converted modelFileId "${propertyWithId.modelId}" to database modelId: ${resolvedModelId}`)
              } catch (error) {
                logger(`Failed to convert modelFileId "${propertyWithId.modelId}" to database ID: ${error}`)
                console.error(`[ModelProperty.create] Failed to convert modelFileId: ${error}`)
              }
            }
          }
          
          // If we still don't have a modelId, try to resolve it from modelName
          if (!resolvedModelId && propertyWithId.modelName) {
            try {
              const { getModelId } = await import('@/helpers/db')
              // Get schemaName from context if available
              const schemaName = snapshot.context._schemaName
              resolvedModelId = await getModelId(propertyWithId.modelName, schemaName)
              logger(`Resolved modelId for model "${propertyWithId.modelName}": ${resolvedModelId}`)
            } catch (error) {
              logger(`Failed to resolve modelId for model "${propertyWithId.modelName}": ${error}`)
              console.error(`[ModelProperty.create] Failed to resolve modelId: ${error}`)
            }
          }
          
          if (!resolvedModelId) {
            logger(`ERROR: Cannot write property "${property.name}" - no modelId available`)
            console.error(`[ModelProperty.create] ERROR: Cannot write property "${property.name}" - no modelId available. modelId: ${propertyWithId.modelId}, modelName: ${propertyWithId.modelName}`)
            // Don't clear pending write here - it might resolve later
            return
          }
          
          // Track pending write now that we have the resolved modelId
          this.trackPendingWrite(propertyFileId, resolvedModelId)
          
          logger(`Triggering write process for property "${property.name}" (modelId: ${resolvedModelId}, propertyFileId: ${propertyFileId})`)
          
          // Check current write state
          const currentWriteState = writeProcess.getSnapshot()
          
          if (currentWriteState.value === 'success') {
            // Write already succeeded, clear pending write immediately
            this.clearPendingWrite(propertyFileId, 'success')
          } else {
            // Set up subscription to catch future state changes
            const writeSubscription = writeProcess.subscribe((writeSnapshot) => {
              if (writeSnapshot.value === 'success') {
                writeSubscription.unsubscribe()
                logger(`[writeProcess subscription] Write succeeded for property "${property.name}" (propertyFileId: ${propertyFileId})`)
                // Clear pending write on success
                this.clearPendingWrite(propertyFileId, 'success')
              } else if (writeSnapshot.value === 'error') {
                writeSubscription.unsubscribe()
                const errorContext = writeSnapshot.context
                logger(`Write process failed for property "${property.name}" (propertyFileId: ${propertyFileId}): ${errorContext.error?.message || 'Unknown error'}`)
                logger(`Write process error details:`, errorContext.error)
                // Mark pending write as error
                this.clearPendingWrite(propertyFileId, 'error')
              }
            })
          }
          
          const propertyData = {
            modelId: resolvedModelId,
            name: property.name!,
            dataType: property.dataType!,
            refModelId: property.refModelId,
            refValueType: property.refValueType,
            storageType: property.storageType,
            localStorageDir: property.localStorageDir,
            filenameSuffix: property.filenameSuffix,
          }
          
          service.send({
            type: 'requestWrite',
            data: propertyData,
          })
        } else if (retries < maxRetries) {
          retries++
          setTimeout(checkAndSend, 50) // Retry after 50ms
        } else {
          logger(`ERROR: writeProcess not available after ${maxRetries} retries for property "${property.name}" (propertyFileId: ${propertyFileId})`)
          console.error(`[ModelProperty.create] ERROR: writeProcess not available after ${maxRetries} retries for property "${property.name}" (propertyFileId: ${propertyFileId})`)
          // Mark as error if we couldn't even start the write process
          this.clearPendingWrite(propertyFileId, 'error')
        }
      }
      
      // Start checking after a short delay to allow state machine to initialize
      setTimeout(checkAndSend, 0)
    }
    
    return proxiedInstance
  }

  /**
   * Get ModelProperty instance by propertyFileId from static cache
   */
  static getById(propertyFileId: string): ModelProperty | undefined {
    if (!propertyFileId) return undefined
    
    // Search through cache to find by propertyFileId
    // Cache key might be "modelName:propertyName" or "id:propertyId"
    for (const [cacheKey, { instance }] of this.instanceCache.entries()) {
      const context = instance._getSnapshotContext()
      // id is now the schemaFileId (string)
      if (context.id === propertyFileId) {
        return instance
      }
    }
    
    return undefined
  }

  /**
   * Create or get ModelProperty instance by propertyFileId
   * Queries the database to find the property if not cached
   */
  static async createById(propertyFileId: string): Promise<ModelProperty | undefined> {
    console.log('createById', propertyFileId)
    if (!propertyFileId) {
      return undefined
    }

    // First, check if we have an instance cached
    const cachedInstance = this.getById(propertyFileId)
    console.log('cachedInstance', cachedInstance)
    if (cachedInstance) {
      console.log('cachedInstance found', cachedInstance)
      return cachedInstance
    }

    // Query database to get property data from ID
    const { BaseDb } = await import('@/db/Db/BaseDb')
    const { properties: propertiesTable, models: modelsTable } = await import('@/seedSchema')
    const { eq } = await import('drizzle-orm')

    const db = BaseDb.getAppDb()
    console.log('db', !!db)
    if (!db) {
      console.log('db not found')
      return undefined
    }

    const testRecords = await db
      .select()
      .from(propertiesTable)
      .limit(100)

    console.log('testRecords', testRecords)

    const propertyRecords = await db
      .select()
      .from(propertiesTable)
      .where(eq(propertiesTable.schemaFileId, propertyFileId))
      .limit(1)

    console.log('propertyRecords', propertyRecords)

    if (propertyRecords.length === 0) {
      return undefined
    }

    const propertyRecord = propertyRecords[0]

    // Get model name
    const modelRecords = await db
      .select({ name: modelsTable.name })
      .from(modelsTable)
      .where(eq(modelsTable.id, propertyRecord.modelId))
      .limit(1)

    if (modelRecords.length === 0) {
      return undefined
    }

    const modelName = modelRecords[0].name

    // Build property data
    // id is now the schemaFileId (string), _dbId is the database integer ID
    const propertyData: Static<typeof TProperty> = {
      id: propertyFileId, // schemaFileId (string) - public ID
      _dbId: propertyRecord.id ?? undefined, // Database integer ID - internal only
      name: propertyRecord.name,
      dataType: propertyRecord.dataType as ModelPropertyDataTypes,
      modelId: propertyRecord.modelId,
      modelName,
      refModelId: propertyRecord.refModelId || undefined,
      refValueType: propertyRecord.refValueType as ModelPropertyDataTypes | undefined,
    }
    
    // Load isEdited from database
    const isEditedFromDb = propertyRecord.isEdited ?? false

    // Get ref model name if applicable
    if (propertyRecord.refModelId) {
      const refModelRecords = await db
        .select({ name: modelsTable.name })
        .from(modelsTable)
        .where(eq(modelsTable.id, propertyRecord.refModelId))
        .limit(1)

      if (refModelRecords.length > 0) {
        propertyData.refModelName = refModelRecords[0].name
        propertyData.ref = refModelRecords[0].name
      }
    }

    // Create ModelProperty instance
    const instance = this.create(propertyData)
    
    // Set isEdited from database after creation
    if (isEditedFromDb) {
      instance._service.send({
        type: 'updateContext',
        _isEdited: true,
      })
    }
    
    return instance
  }

  /**
   * Track a pending write for a property
   */
  static trackPendingWrite(propertyFileId: string, modelId: number): void {
    this.pendingWrites.set(propertyFileId, {
      propertyFileId,
      modelId,
      status: 'pending',
      timestamp: Date.now(),
    })
  }

  /**
   * Clear or update pending write status
   */
  static clearPendingWrite(propertyFileId: string, status: 'success' | 'error' = 'success'): void {
    const write = this.pendingWrites.get(propertyFileId)
    if (write) {
      if (status === 'success') {
        // Remove successful writes from pendingWrites
        this.pendingWrites.delete(propertyFileId)
        logger(`Cleared pending write for property "${propertyFileId}" (status: success)`)
      } else {
        // Update status to error but keep in map (for debugging/retry purposes)
        write.status = 'error'
        this.pendingWrites.set(propertyFileId, write)
        logger(`Marked pending write as error for property "${propertyFileId}"`)
      }
    }
  }

  /**
   * Get all pending property IDs for a model
   */
  static getPendingPropertyIds(modelId: number): string[] {
    console.log(`[ModelProperty.getPendingPropertyIds] Getting pending property IDs for modelId: ${modelId}`)
    console.log(`[ModelProperty.getPendingPropertyIds] Pending writes:`, Array.from(this.pendingWrites.entries()))
    return Array.from(this.pendingWrites.entries())
      .filter(([_, write]) => write.modelId === modelId && write.status !== 'error')
      .map(([propertyFileId]) => propertyFileId)
  }

  getService(): ModelPropertyService {
    return this._service
  }

  private _getSnapshot(): ModelPropertySnapshot {
    return this._service.getSnapshot() as ModelPropertySnapshot
  }

  private _getSnapshotContext(): ModelPropertyMachineContext {
    return this._getSnapshot().context
  }

  get path() {
    const workingDir = BaseFileManager.getWorkingDir()
    if (!this.localStorageDir || !this.name || !this.filenameSuffix) {
      return undefined
    }
    return `${workingDir}/${this.localStorageDir}/${this.name}${this.filenameSuffix || ''}`
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
   * Validate the property
   * @returns Validation result
   */
  async validate(): Promise<{ isValid: boolean; errors: any[] }> {
    return new Promise((resolve) => {
      let resolved = false
      const subscription = this._service.subscribe((snapshot) => {
        const state = snapshot.value
        // Wait for validation to complete (idle state after validating)
        if (state === 'idle' && !resolved) {
          resolved = true
          subscription.unsubscribe()
          const errors = snapshot.context._validationErrors || []
          resolve({
            isValid: errors.length === 0,
            errors,
          })
        }
      })

      this._service.send({ type: 'validateProperty' })
      
      // Timeout fallback
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
      }, 5000)
    })
  }

  save(): void {
    // Validation will happen automatically in the machine before saving
    this._service.send({
      type: 'saveToSchema',
    })
  }

  /**
   * Reload property from database
   * This refreshes the actor context with the latest data from the database
   * Note: ModelProperty doesn't have a dedicated load actor, so this will
   * re-initialize from the current property data
   */
  async reload(): Promise<void> {
    // ModelProperty doesn't have a separate load mechanism
    // It's loaded as part of the Model/Schema
    // This method is provided for API consistency
    // To actually reload, you'd need to reload the parent Model or Schema
    logger('ModelProperty.reload() called - ModelProperty is loaded as part of Model/Schema. Reload the parent Model or Schema instead.')
    // No-op for now, but could be enhanced to reload from DB if needed
  }

  unload(): void {
    this._service.stop()
  }
}
