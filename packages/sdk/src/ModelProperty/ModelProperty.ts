import { ActorRefFrom, createActor, SnapshotFrom } from 'xstate'
import { Static } from '@sinclair/typebox'
import { ModelPropertyDataTypes, TProperty, normalizeDataType } from '@/Schema'
import { modelPropertyMachine, ModelPropertyMachineContext } from './service/modelPropertyMachine'
import { StorageType } from '@/types'
import type { CreateWaitOptions } from '@/types'
import { BaseFileManager, generateId } from '@/helpers'
import { BaseDb } from '@/db/Db/BaseDb'
import { getModelPropertiesData } from '@/db/read/getModelPropertiesData'
import { getModelId, getModelIdByFileId } from '@/helpers/db'
import { modelPropertiesToObject } from '@/helpers/model'
import { Model } from '@/Model/Model'
import { Schema } from '@/Schema/Schema'
import { properties as propertiesTable, models as modelsTable } from '@/seedSchema/ModelSchema'
import { schemas } from '@/seedSchema/SchemaSchema'
import { getSchemaNameFromModel } from './service/actors/saveToSchema'
import { modelSchemas } from '@/seedSchema/ModelSchemaSchema'
import { and, eq } from 'drizzle-orm'
import { createReactiveProxy } from '@/helpers/reactiveProxy'
import { waitForEntityIdle } from '@/helpers/waitForEntityIdle'
import { findEntity } from '@/helpers/entity/entityFind'
import { unloadEntity } from '@/helpers/entity/entityUnload'
import { forceRemoveFromCaches, runDestroyLifecycle } from '@/helpers/entity/entityDestroy'
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
    // Convert null to undefined for optional fields (TypeBox validation expects undefined, not null)
    const serviceInput: ModelPropertyMachineContext = {
      ...property,
      _propertyFileId: (property as any)._propertyFileId || property.id,
      refValueType: property.refValueType ?? undefined,
      refModelId: property.refModelId ?? undefined,
      ref: property.ref ?? undefined,
      refModelName: property.refModelName ?? undefined,
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

  static create(
    property: Static<typeof TProperty>,
    options?: { waitForReady?: false; schemaName?: string },
  ): ModelProperty
  static create(
    property: Static<typeof TProperty>,
    options?: { waitForReady?: true; readyTimeout?: number; schemaName?: string },
  ): Promise<ModelProperty>
  static create(
    property: Static<typeof TProperty>,
    options?: CreateWaitOptions & { schemaName?: string },
  ): ModelProperty | Promise<ModelProperty> {
    if (!property) {
      throw new Error('Property is required')
    }

    const waitForReady = options?.waitForReady !== false
    const readyTimeout = options?.readyTimeout ?? 5000
    const schemaName = options?.schemaName

    // Handle 'type' field from JSON schema format - convert to 'dataType'
    // Normalize to PascalCase so lowercase values from JSON (e.g. 'text') work
    const propertyWithId = { ...property }
    const rawType = propertyWithId.dataType ?? (propertyWithId as any).type
    if (rawType) {
      propertyWithId.dataType = normalizeDataType(rawType) as ModelPropertyDataTypes
    }
    
    // Ensure id (schemaFileId) is set correctly
    // Priority: _propertyFileId > id (if string) > generate new
    // If id is a number (old format), use _propertyFileId instead
    if (typeof propertyWithId.id === 'number') {
      // id is a database integer ID, not schemaFileId - use _propertyFileId if available
      if ((propertyWithId as any)._propertyFileId) {
        propertyWithId.id = (propertyWithId as any)._propertyFileId
      } else {
        // Fallback: generate new schemaFileId (shouldn't happen, but safety)
        propertyWithId.id = generateId()
        logger(`ModelProperty.create: id was a number, generated new schemaFileId "${propertyWithId.id}" for property "${property.name}"`)
      }
    } else if (!propertyWithId.id && (propertyWithId as any)._propertyFileId) {
      // id is not set but _propertyFileId is available - use it
      propertyWithId.id = (propertyWithId as any)._propertyFileId
    } else if (!propertyWithId.id) {
      // Generate id (schemaFileId) if not provided (for new properties)
      // This ensures new properties can trigger write process
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
        instance._service.send({
          type: 'updateContext',
          ...needsUpdate,
        })
      }
      
      this.instanceCache.set(cacheKey, {
        instance,
        refCount: refCount + 1,
      })
      if (!waitForReady) return instance
      return waitForEntityIdle(instance, { timeout: readyTimeout }).then(
        () => instance,
      )
    }

    const newInstance = new this(propertyWithId)
    
    // Set schema name before async operations so getModelId can resolve the correct model
    if (schemaName) {
      newInstance._service.send({
        type: 'setSchemaName',
        schemaName,
      })
    }
    
    // Wrap instance in Proxy for reactive property access
    const proxiedInstance = createReactiveProxy<ModelProperty>({
      instance: newInstance,
      service: newInstance._service,
      trackedProperties: TPropertyKeys,
      getContext: (instance) => {
        const context = instance._getSnapshotContext()
        return context
      },
      sendUpdate: (instance, prop: string, value: any) => {
        const currentContext = instance._getSnapshotContext()
        if ((currentContext as Record<string, unknown>)[prop] === value) return // No-op, avoid triggering machine
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
    
    if (!waitForReady) return proxiedInstance
    return waitForEntityIdle(proxiedInstance, { timeout: readyTimeout }).then(
      () => proxiedInstance,
    )
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
    if (!propertyFileId) {
      return undefined
    }

    // First, check if we have an instance cached
    const cachedInstance = this.getById(propertyFileId)
    if (cachedInstance) {
      return cachedInstance
    }

    // Query database to get property data from ID
    const db = BaseDb.getAppDb()
    if (!db) {
      return undefined
    }

    const testRecords = await db
      .select()
      .from(propertiesTable)
      .limit(100)

    const propertyRecords = await db
      .select()
      .from(propertiesTable)
      .where(eq(propertiesTable.schemaFileId, propertyFileId))
      .limit(1)

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
      refValueType: propertyRecord.refValueType ? (propertyRecord.refValueType as ModelPropertyDataTypes) : undefined,
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

    // Create ModelProperty instance (sync for createById so we can send updateContext)
    const instance = this.create(propertyData, { waitForReady: false })
    
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
   * Find ModelProperty instance by propertyFileId
   * Waits for the property to be fully loaded (idle state) by default
   * @param options - Find options including propertyFileId and wait configuration
   * @returns ModelProperty instance if found, undefined otherwise
   */
  static async find({
    propertyFileId,
    waitForReady = true,
    readyTimeout = 5000,
  }: {
    propertyFileId: string
    waitForReady?: boolean
    readyTimeout?: number
  }): Promise<ModelProperty | undefined> {
    if (!propertyFileId) {
      return undefined
    }

    return await findEntity<ModelProperty>(
      {
        getById: (id) => ModelProperty.getById(id),
        createById: (id) => ModelProperty.createById(id),
      },
      { id: propertyFileId },
      {
        waitForReady,
        readyTimeout,
      }
    )
  }

  /**
   * Get all ModelProperty instances for a model.
   * Loads property rows from DB for the given modelFileId, creates instances via createById, optionally waits for idle.
   */
  static async all(
    modelFileId: string,
    options?: { waitForReady?: boolean; readyTimeout?: number },
  ): Promise<ModelProperty[]> {
    const { waitForReady = false, readyTimeout = 5000 } = options ?? {}
    if (!modelFileId) {
      return []
    }

    const rows = await getModelPropertiesData(modelFileId)
    const instances: ModelProperty[] = []

    for (const row of rows) {
      if (row.schemaFileId) {
        const instance = await this.createById(row.schemaFileId)
        if (instance) {
          instances.push(instance)
        }
      }
    }

    if (waitForReady && instances.length > 0) {
      await Promise.all(
        instances.map((p) =>
          waitForEntityIdle(p as Parameters<typeof waitForEntityIdle>[0], {
            timeout: readyTimeout,
          }),
        ),
      )
    }

    return instances
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
    return Array.from(this.pendingWrites.entries())
      .filter(([_, write]) => write.modelId === modelId && write.status !== 'error')
      .map(([propertyFileId]) => propertyFileId)
  }

  /**
   * Get modelId for a property that has a pending write (row may not be in DB yet).
   * Used to resolve modelName when validating a just-created property rename.
   */
  static getPendingModelId(propertyFileId: string): number | undefined {
    return this.pendingWrites.get(propertyFileId)?.modelId
  }

  getService(): ModelPropertyService {
    return this._service
  }

  private _getSnapshot(): ModelPropertySnapshot {
    return this._service.getSnapshot() as ModelPropertySnapshot
  }

  public _getSnapshotContext(): ModelPropertyMachineContext {
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
    const snapshot = this._service.getSnapshot()
    const isAlreadySaving =
      typeof snapshot.value === 'object' && snapshot.value !== null && 'saveToSchema' in snapshot.value
    if (isAlreadySaving) {
      return
    }
    const context = snapshot.context
    if (!context._isEdited) return // No changes to persist
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
    // ModelProperty doesn't have liveQuery subscriptions or complex cache management
    // Just stop the service
    try {
      this._service.stop()
    } catch (error) {
      // Service might already be stopped
    }
  }

  /**
   * Destroy the model property: remove from caches, delete from database, update Schema context, stop service.
   */
  async destroy(): Promise<void> {
    const context = this._getSnapshotContext()
    const cacheKey =
      context.modelName && context.name
        ? `${context.modelName}:${context.name}`
        : (context.id ?? '')
    if (!cacheKey) return

    forceRemoveFromCaches(this, {
      getCacheKeys: () => [cacheKey],
      caches: [ModelProperty.instanceCache as Map<string, unknown>],
    })

    await runDestroyLifecycle(this, {
      getService: (instance) =>
        instance._service as { send: (ev: unknown) => void; stop: () => void },
      doDestroy: async () => {
        const db = BaseDb.getAppDb()
        const schemaName = context._schemaName
        const modelName = context.modelName
        const propertyName = context.name
        if (!modelName || !propertyName) return

        if (db && schemaName) {
          const propertyRecords = await db
            .select({ propertyId: propertiesTable.id })
            .from(propertiesTable)
            .innerJoin(modelsTable, eq(propertiesTable.modelId, modelsTable.id))
            .innerJoin(modelSchemas, eq(modelsTable.id, modelSchemas.modelId))
            .innerJoin(schemas, eq(modelSchemas.schemaId, schemas.id))
            .where(
              and(
                eq(schemas.name, schemaName),
                eq(modelsTable.name, modelName),
                eq(propertiesTable.name, propertyName),
              ),
            )
            .limit(1)
          if (propertyRecords.length > 0 && propertyRecords[0].propertyId != null) {
            await db
              .delete(propertiesTable)
              .where(eq(propertiesTable.id, propertyRecords[0].propertyId))
          }
        }

        if (schemaName) {
          const schema = Schema.create(schemaName, { waitForReady: false }) as import('@/Schema/Schema').Schema
          const snapshot = schema.getService().getSnapshot()
          const schemaContext = snapshot.context
          if (schemaContext.models?.[modelName]?.properties?.[propertyName]) {
            const updatedModels = { ...schemaContext.models }
            const updatedProperties = { ...updatedModels[modelName].properties }
            delete updatedProperties[propertyName]
            updatedModels[modelName] = { ...updatedModels[modelName], properties: updatedProperties }
            schema.getService().send({ type: 'updateContext', models: updatedModels })
            schema.getService().send({ type: 'markAsDraft', propertyKey: `property:${modelName}:${propertyName}` })
          }
        }
      },
    })
  }
}
