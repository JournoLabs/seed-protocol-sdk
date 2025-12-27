import { ActorRefFrom, createActor, SnapshotFrom } from 'xstate'
import { immerable } from 'immer'
import { modelMachine, ModelMachineContext } from './service/modelMachine'
import { createReactiveProxy } from '@/helpers/reactiveProxy'
import { BaseItem } from '@/Item/BaseItem'
import { ModelValues } from '@/types'
import debug from 'debug'

const logger = debug('seedSdk:model:Model')

type ModelService = ActorRefFrom<typeof modelMachine>
type ModelSnapshot = SnapshotFrom<typeof modelMachine>

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
  // Cache by modelName:schemaName (primary key)
  protected static instanceCache: Map<
    string,
    { instance: Model; refCount: number }
  > = new Map()
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

  constructor(modelName: string, schemaName: string) {
    // Set immerable in constructor to ensure 'this' is properly bound
    this[immerable] = true
    
    const serviceInput: Pick<ModelMachineContext, 'modelName' | 'schemaName'> = {
      modelName,
      schemaName,
    }

    this._service = createActor(modelMachine as any, {
      input: serviceInput,
    }) as ModelService

    this._service.start()

    // Note: Property getters/setters are now handled by the Proxy in create()
  }

  static create(modelName: string, schemaName: string): Model {
    if (!modelName || !schemaName) {
      throw new Error('Model name and schema name are required')
    }

    // Create cache key from modelName and schemaName
    const cacheKey = `${schemaName}:${modelName}`

    // Check if instance exists in cache
    if (this.instanceCache.has(cacheKey)) {
      const { instance, refCount } = this.instanceCache.get(cacheKey)!
      this.instanceCache.set(cacheKey, {
        instance,
        refCount: refCount + 1,
      })
      return instance
    }

    // Create new instance
    const newInstance = new this(modelName, schemaName)
    
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
          const context = newInstance._getSnapshotContext()
          return context.modelName
        }
        
        // Handle tracked properties
        if (typeof prop === 'string' && TRACKED_PROPERTIES.includes(prop as any)) {
          const context = newInstance._getSnapshotContext()
          return context[prop]
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
            const context = newInstance._getSnapshotContext()
            const oldName = context.modelName
            const newName = value as string
            
            if (oldName === newName) {
              logger(`Model name unchanged: "${oldName}"`)
              return true
            }
            
            logger(`Updating model name from "${oldName}" to "${newName}"`)
            
            // Update Model instance cache
            const oldCacheKey = `${context.schemaName}:${oldName}`
            const newCacheKey = `${context.schemaName}:${newName}`
            
            if (Model.instanceCache.has(oldCacheKey)) {
              const entry = Model.instanceCache.get(oldCacheKey)!
              Model.instanceCache.delete(oldCacheKey)
              Model.instanceCache.set(newCacheKey, entry)
            }
            
            // Update Model context
            newInstance._service.send({
              type: 'updateContext',
              modelName: newName,
            })
            
            // Mark model as draft
            newInstance._service.send({
              type: 'markAsDraft',
              propertyKey: 'modelName',
            })
            
            // Notify Schema to update its models object
            newInstance._notifySchemaOfNameChange(oldName, newName).catch((error) => {
              logger(`Failed to notify schema of model name change: ${error instanceof Error ? error.message : String(error)}`)
            })
          } else if (prop === 'properties') {
            // Deep clone to ensure immutability
            const clonedProperties = value ? JSON.parse(JSON.stringify(value)) : {}
            newInstance._service.send({
              type: 'updateContext',
              properties: clonedProperties,
            })
            
            // Mark model as draft when properties change
            newInstance._service.send({
              type: 'markAsDraft',
              propertyKey: 'properties',
            })
            
            // Notify Schema to update its models object
            newInstance._notifySchemaOfModelChange().catch((error) => {
              logger(`Failed to notify schema of model change: ${error instanceof Error ? error.message : String(error)}`)
            })
          } else if (prop === 'indexes') {
            // Clone array
            const clonedIndexes = value ? [...value] : undefined
            newInstance._service.send({
              type: 'updateContext',
              indexes: clonedIndexes,
            })
            
            // Mark model as draft when indexes change
            newInstance._service.send({
              type: 'markAsDraft',
              propertyKey: 'indexes',
            })
            
            // Notify Schema to update its models object
            newInstance._notifySchemaOfModelChange().catch((error) => {
              logger(`Failed to notify schema of model change: ${error instanceof Error ? error.message : String(error)}`)
            })
          } else if (prop === 'description') {
            // Standard property update
            newInstance._service.send({
              type: 'updateContext',
              description: value,
            })
            
            // Mark model as draft
            newInstance._service.send({
              type: 'markAsDraft',
              propertyKey: 'description',
            })
            
            // Notify Schema to update its models object
            newInstance._notifySchemaOfModelChange().catch((error) => {
              logger(`Failed to notify schema of model change: ${error instanceof Error ? error.message : String(error)}`)
            })
          } else {
            // Standard property update
            newInstance._service.send({
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
        
        // Check tracked properties
        if (typeof prop === 'string' && TRACKED_PROPERTIES.includes(prop as any)) {
          const context = newInstance._getSnapshotContext()
          return prop in context
        }
        return Reflect.has(target, prop)
      },
      
      ownKeys(target) {
        // Include 'name' in ownKeys
        const keys = Reflect.ownKeys(target)
        if (!keys.includes('name')) {
          return [...keys, 'name']
        }
        return keys
      },
      
      getOwnPropertyDescriptor(target, prop: string | symbol) {
        // Handle 'name' as an alias for 'modelName'
        if (prop === 'name') {
          const context = newInstance._getSnapshotContext()
          return {
            enumerable: true,
            configurable: true,
            value: context.modelName,
            writable: true,
          }
        }
        
        // Handle tracked properties
        if (typeof prop === 'string' && TRACKED_PROPERTIES.includes(prop as any)) {
          const context = newInstance._getSnapshotContext()
          if (prop in context) {
            return {
              enumerable: true,
              configurable: true,
              value: context[prop],
              writable: true,
            }
          }
        }
        return Reflect.getOwnPropertyDescriptor(target, prop)
      },
    }) as Model
    
    this.instanceCache.set(cacheKey, {
      instance: proxiedInstance,
      refCount: 1,
    })
    return proxiedInstance
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

  /**
   * Validate the model
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

      this._service.send({ type: 'validateModel' })
    })
  }

  /**
   * Create a new item instance from this model
   * This maintains backward compatibility with the old Model.create() static method
   */
  async create(values: ModelValues<any>): Promise<BaseItem<any>> {
    const item = await BaseItem.create(values)
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
   * Notify Schema of model name change
   */
  private async _notifySchemaOfNameChange(oldName: string, newName: string): Promise<void> {
    const context = this._getSnapshotContext()
    const { Schema } = await import('@/schema/Schema')
    
    try {
      const schema = Schema.create(context.schemaName)
      await (schema as any)._handleModelNameChange(oldName, newName)
    } catch (error) {
      logger(`Error notifying schema of model name change: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Notify Schema of model changes (properties, indexes, description)
   */
  private async _notifySchemaOfModelChange(): Promise<void> {
    const context = this._getSnapshotContext()
    const { Schema } = await import('@/schema/Schema')
    
    try {
      const schema = Schema.create(context.schemaName)
      const schemaContext = schema.getService().getSnapshot().context
      
      // Update the model data in Schema's models object
      if (schemaContext.models && schemaContext.models[context.modelName!]) {
        const updatedModels = { ...schemaContext.models }
        updatedModels[context.modelName!] = {
          description: context.description,
          properties: context.properties || {},
          indexes: context.indexes,
        }
        
        schema.getService().send({
          type: 'updateContext',
          models: updatedModels,
        })
        
        // Mark schema as draft
        schema.getService().send({
          type: 'markAsDraft',
          propertyKey: `model:${context.modelName}`,
        })
        
        // Save draft to database
        await (schema as any)._saveDraftToDb().catch((error) => {
          logger(`Failed to save draft to database: ${error instanceof Error ? error.message : String(error)}`)
        })
      }
    } catch (error) {
      logger(`Error notifying schema of model change: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Unload the model instance and clean up resources
   */
  unload(): void {
    // Remove from cache
    const context = this._getSnapshotContext()
    const cacheKey = `${context.schemaName}:${context.modelName}`
    
    if (Model.instanceCache.has(cacheKey)) {
      const entry = Model.instanceCache.get(cacheKey)!
      entry.refCount -= 1
      if (entry.refCount <= 0) {
        Model.instanceCache.delete(cacheKey)
      } else {
        Model.instanceCache.set(cacheKey, entry)
      }
    }
    
    this._service.stop()
  }
}

