import { Model } from './Model'
import { ModelValues } from '@/types'
import { BaseItem } from '@/Item/BaseItem'

/**
 * ModelClass wrapper that provides the static interface expected by existing code
 * This wraps a Model instance and provides backward compatibility with the old decorator-based Model classes
 */
export class ModelClass {
  private static _modelInstance: Model
  private static _modelName: string
  private static _schemaName: string

  /**
   * Initialize the ModelClass with a Model instance
   */
  static initialize(modelInstance: Model): void {
    this._modelInstance = modelInstance
    this._modelName = modelInstance.modelName!
    this._schemaName = modelInstance.schemaName!
  }

  /**
   * Get the underlying Model instance
   */
  static getModelInstance(): Model {
    if (!this._modelInstance) {
      throw new Error(`ModelClass not initialized. Call ModelClass.initialize() first.`)
    }
    return this._modelInstance
  }

  /**
   * Static schema getter (backward compatibility)
   * Returns the properties object from the Model instance
   */
  static get schema() {
    return this.getModelInstance().schema
  }

  /**
   * Static create method (backward compatibility)
   * Delegates to the Model instance's create method
   */
  static async create(values: ModelValues<any>): Promise<BaseItem<any>> {
    return this.getModelInstance().create(values)
  }

  /**
   * Get the model name
   */
  static get modelName(): string {
    return this._modelName
  }

  /**
   * Get the schema name
   */
  static get schemaName(): string {
    return this._schemaName
  }
}

