import { ActorRefFrom, createActor, SnapshotFrom } from 'xstate'
import { Static } from '@sinclair/typebox'
import { ModelPropertyDataTypes, TProperty } from '@/Schema'
import { immerable } from 'immer'
import { modelPropertyMachine, ModelPropertyMachineContext } from './service/modelPropertyMachine'
import { StorageType } from '@/types'
import { BaseFileManager } from '@/helpers'
import { createReactiveProxy } from '@/helpers/reactiveProxy'

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
  [immerable] = true

  name?: string
  dataType?: ModelPropertyDataTypes
  ref?: string
  modelId?: number
  refModelId?: number
  refValueType?: ModelPropertyDataTypes
  storageType?: StorageType
  localStorageDir?: string
  filenameSuffix?: string

  constructor(property: Static<typeof TProperty>) {
    const serviceInput: ModelPropertyMachineContext = property

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
        // No schema file values found, use current property as original
        TPropertyKeys.forEach((key) => {
          if (property[key] !== undefined) {
            (originalValues as any)[key] = property[key]
          }
        })
      }

      // Initialize with original values, including isEdited flag if property differs from schema file
      this._service.send({
        type: 'initializeOriginalValues',
        originalValues,
        schemaName: undefined, // Will be set later if needed
        isEdited,
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
      const model = await Model.getByNameAsync(property.modelName)
      
      if (!model || !model.schema) {
        return undefined
      }

      // Get the schema file value for this property
      const schemaFileValue = model.schema[property.name]
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
        try {
          const { BaseDb } = await import('@/db/Db/BaseDb')
          const seedSchema = await import('@/seedSchema')
          const modelsTable = seedSchema.models
          const { eq } = await import('drizzle-orm')
          
          const db = BaseDb.getAppDb()
          if (db) {
            const refModelRecords = await db
              .select()
              .from(modelsTable)
              .where(eq(modelsTable.name, schemaFileValue.ref))
              .limit(1)
            
            if (refModelRecords.length > 0) {
              originalValues.refModelId = refModelRecords[0].id
            }
          }
        } catch (error) {
          // Ignore errors getting refModelId
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

    // Create cache key from modelName and name
    const cacheKey = property.modelName && property.name
      ? `${property.modelName}:${property.name}`
      : property.id
      ? `id:${property.id}`
      : property.name || 'unnamed'

    // Check if instance exists in cache
    if (this.instanceCache.has(cacheKey)) {
      const { instance, refCount } = this.instanceCache.get(cacheKey)!
      this.instanceCache.set(cacheKey, {
        instance,
        refCount: refCount + 1,
      })
      return instance
    }

    const newInstance = new this(property)
    
    // Wrap instance in Proxy for reactive property access
    const proxiedInstance = createReactiveProxy<ModelProperty>({
      instance: newInstance,
      service: newInstance._service,
      trackedProperties: TPropertyKeys,
      getContext: (instance) => instance._getSnapshotContext(),
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
    
    // Trigger write process if property has modelId and propertyFileId
    // Wait for service to be ready (idle state) and have writeProcess spawned
    if (property.modelId && property.id) {
      // Track pending write
      this.trackPendingWrite(property.id, property.modelId)
      
      // Trigger write process asynchronously
      setTimeout(async () => {
        const service = proxiedInstance.getService()
        const snapshot = service.getSnapshot()
        
        // Wait for idle state and writeProcess to be spawned
        if (snapshot.value === 'idle' && snapshot.context.writeProcess) {
          const propertyData = {
            modelId: property.modelId!,
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
        }
      }, 0)
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
      if (context.id === propertyFileId || (context as any)._propertyFileId === propertyFileId) {
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
    const { BaseDb } = await import('@/db/Db/BaseDb')
    const { properties: propertiesTable, models: modelsTable } = await import('@/seedSchema')
    const { eq } = await import('drizzle-orm')

    const db = BaseDb.getAppDb()
    if (!db) {
      return undefined
    }

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
    const propertyData: Static<typeof TProperty> = {
      id: propertyFileId,
      name: propertyRecord.name,
      dataType: propertyRecord.dataType as ModelPropertyDataTypes,
      modelId: propertyRecord.modelId,
      modelName,
      refModelId: propertyRecord.refModelId || undefined,
      refValueType: propertyRecord.refValueType as ModelPropertyDataTypes | undefined,
    }

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
    return this.create(propertyData)
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
   * Get all pending property IDs for a model
   */
  static getPendingPropertyIds(modelId: number): string[] {
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
    return this._getSnapshot().context._isEdited
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
