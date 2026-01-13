import { IItem, IItemProperty } from '@/interfaces'
import { itemMachineSingle } from '@/Item/service/itemMachineSingle'
import { INTERNAL_PROPERTY_NAMES } from '@/helpers/constants'
import { VersionsType } from '@/seedSchema'
// Dynamic import to break circular dependency: Model -> BaseItem -> Model
// import { Model } from '@/Model/Model'

import {
  CreatePropertyInstanceProps,
  ItemData,
  ItemFindProps,
  ModelSchema,
  ModelValues,
  NewItemProps,
  PropertyData
} from '@/types'

import { immerable } from 'immer'
import { BehaviorSubject } from 'rxjs'
import { ActorRefFrom, Subscription, createActor } from 'xstate'
import pluralize from 'pluralize'
import { orderBy, startCase } from 'lodash-es'
import { waitForEvent } from '@/events'
import { getItemData } from '@/db/read/getItemData'
import { getItemsData } from '@/db/read/getItems'
import { BaseItemProperty } from '@/ItemProperty/BaseItemProperty'
import { getItemProperties } from '@/db/read/getItemProperties'
import { createNewItem } from '@/db/write/createNewItem'
import { BaseDb } from '@/db/Db/BaseDb'
import { properties as propertiesTable, models as modelsTable } from '@/seedSchema'
import { eq, and } from 'drizzle-orm'

// Fallback helper for synchronous Model access when modelInstance is not provided
// This is only used as a fallback - the preferred approach is to pass modelInstance
// directly to BaseItem constructor (which Model.create() instance method does).
// Since Model.getByName() is synchronous and just accesses a cache, Model must be loaded
// when BaseItem constructor runs (because Model imports BaseItem).
let ModelClass: typeof import('@/Model/Model').Model | null = null
let modelImportPromise: Promise<typeof import('@/Model/Model')> | null = null

const getModel = (): typeof import('@/Model/Model').Model => {
  if (!ModelClass) {
    // Start loading Model if not already started
    if (!modelImportPromise) {
      modelImportPromise = import('@/Model/Model')
      // Try to get Model synchronously if already loaded
      // This works because Model imports BaseItem, so Model is initialized when BaseItem runs
      modelImportPromise.then(module => {
        ModelClass = module.Model
      }).catch(() => {
        // If import fails, ModelClass remains null
      })
    }
    // For synchronous access, we need Model to already be loaded
    // If it's not loaded yet, this will throw, but in practice Model is always loaded
    // because Model imports BaseItem, creating the initialization order
    if (!ModelClass) {
      // Fallback: try to access Model directly (works if already in module cache)
      try {
        // @ts-ignore - accessing module cache directly
        const modelModule = (globalThis as any).__seedModelModule || 
          (typeof window !== 'undefined' && (window as any).__seedModelModule)
        if (modelModule) {
          ModelClass = modelModule.Model
        }
      } catch {
        // If Model isn't available, throw a more helpful error
        throw new Error('Model class not available. This may indicate a circular dependency issue.')
      }
    }
  }
  return ModelClass!
}

export abstract class BaseItem<T extends ModelValues<ModelSchema>> implements IItem<T> {

  protected static instanceCache: Map<string, { instance: BaseItem<any>; refCount: number }> = new Map();
  protected _subscription: Subscription | undefined;
  protected readonly _storageTransactionId: string | undefined;
  [immerable] = true;
  protected _propertiesSubject: BehaviorSubject<Record<string, IItemProperty>> = new BehaviorSubject({});
  protected readonly _service: ActorRefFrom<typeof itemMachineSingle>;

  constructor(initialValues: NewItemProps<T>) {

    const {
      modelName,
      seedUid,
      schemaUid,
      seedLocalId,
      latestVersionLocalId,
      latestVersionUid,
      modelInstance,
    } = initialValues

    // Use passed modelInstance if available (preferred - avoids circular dependency lookup)
    // Otherwise fall back to cache lookup via getModel()
    let ModelClass: import('@/Model/Model').Model | undefined
    if (modelInstance) {
      ModelClass = modelInstance
    } else {
      // Fallback: Try to get model from cache (synchronous lookup)
      // If not found, ModelClass will be undefined and we'll handle it in the service
      const Model = getModel()
      const model = Model.getByName(modelName)
      ModelClass = model || undefined
    }

    if (
      ModelClass &&
      initialValues.storageTransactionId
    ) {
      // Check if any property has storageTransactionId (if needed)
      // Or remove this check if storageTransactionId is handled elsewhere
      this._storageTransactionId = initialValues.storageTransactionId
    }

    this._service = createActor(itemMachineSingle, {
      input: {
        seedLocalId,
        seedUid,
        schemaUid,
        ModelClass,
        modelName,
        latestVersionLocalId,
        latestVersionUid,
        storageTransactionId: this._storageTransactionId,
      },
    })

    this._subscription = this._service.subscribe((snapshot) => {
      const { context } = snapshot

      if (
        !context ||
        !context.propertyInstances ||
        context.propertyInstances.size === 0
      ) {
        return
      }

      const propertiesObj: Record<string, IItemProperty> = {}

      for (const [key, propertyInstance] of context.propertyInstances) {
        if (typeof key !== 'string' || INTERNAL_PROPERTY_NAMES.includes(key)) {
          propertiesObj[key.toString()] = propertyInstance
          continue
        }

        let transformedKey: string = key as string

        if (propertyInstance.alias) {
          transformedKey = propertyInstance.alias
        }

        if (!propertyInstance.alias && key.endsWith('Ids')) {
          transformedKey = key.slice(0, -3) // Remove 'Ids'
          transformedKey = pluralize(transformedKey)
        }

        if (!propertyInstance.alias && key.endsWith('Id')) {
          transformedKey = key.slice(0, -2) // Remove 'Id'
        }

        propertiesObj[transformedKey] = propertyInstance
      }

      this._propertiesSubject.next(propertiesObj)
    })

    this._service.start()

    const definedKeys: string[] = ['ModelClass']

    const itemPropertyBase: Partial<CreatePropertyInstanceProps> = {
      seedLocalId,
      seedUid,
      versionLocalId: latestVersionLocalId,
      versionUid: latestVersionUid,
      modelName,
    }

    if (ModelClass && ModelClass.properties) {
      // Model.properties now returns ModelProperty[] instead of object
      const properties = ModelClass.properties || []
      
      for (const propertyInstance of properties) {
        // propertyInstance is a ModelProperty instance
        const propertyName = propertyInstance.name
        if (!propertyName) {
          continue
        }
        
        // Get property schema from ModelProperty instance context
        const propContext = propertyInstance._getSnapshotContext()
        const propertyRecordSchema = {
          dataType: propContext.dataType,
          ref: propContext.refModelName || propContext.ref,
          refValueType: propContext.refValueType,
          storageType: propContext.storageType,
          localStorageDir: propContext.localStorageDir,
          filenameSuffix: propContext.filenameSuffix,
        }
        
        if (!propertyRecordSchema.dataType) {
          throw new Error(`Property ${propertyName} has no dataType`)
        }
        
        this._createPropertyInstance({
          ...itemPropertyBase,
          propertyName,
          propertyValue: initialValues[propertyName as keyof T],
        })
        
        definedKeys.push(propertyName)
        
        // Handle Relation and List types (same as before)
        if (
          propertyRecordSchema.dataType === 'Relation' &&
          !propertyName.endsWith('Id')
        ) {
          definedKeys.push(`${propertyName}Id`)
        }
        
        if (
          propertyRecordSchema.dataType === 'List' &&
          !propertyName.endsWith('Ids')
        ) {
          const singularPropertyName = pluralize.singular(propertyName)
          const propertyNameForSchema = `${singularPropertyName}${propertyRecordSchema.ref}Ids`
          definedKeys.push(propertyNameForSchema)
        }
      }
    }

    ; (Object.keys(initialValues) as Array<string & keyof Partial<T>>).forEach(
      (key) => {
        // If we already defined it, that means it was in the schema
        if (definedKeys.includes(key)) {
          return
        }

        this._createPropertyInstance({
          ...itemPropertyBase,
          propertyName: key,
          propertyValue: initialValues[key],
        })
      },
    )
  }

  static PlatformClass: typeof BaseItem

  static setPlatformClass(platformClass: typeof BaseItem) {
    this.PlatformClass = platformClass
  }

  static async create<T extends ModelValues<ModelSchema>>(
    props: Partial<ItemData> & { modelInstance?: import('@/Model/Model').Model },
  ): Promise<BaseItem<any>> {
    if (!props.modelName && props.type) {
      props.modelName = startCase(props.type)
    }
    if (props.seedUid || props.seedLocalId) {
      const seedId = (props.seedUid || props.seedLocalId) as string
      if (this.instanceCache.has(seedId)) {
        const { instance, refCount } = this.instanceCache.get(seedId)!
        this.instanceCache.set(seedId, {
          instance,
          refCount: refCount + 1,
        })
        for (const [propertyName, propertyValue] of Object.entries(props)) {
          const propertyInstances = instance.getService().getSnapshot()
            .context.propertyInstances
          if (!propertyInstances || !propertyInstances.has(propertyName)) {
            continue
          }
          const propertyInstance = propertyInstances.get(propertyName)
          if (!propertyInstance) {
            continue
          }
          propertyInstance.getService().send({
            type: 'updateContext',
            propertyValue,
          })
        }
        return instance
      }
      if (!this.instanceCache.has(seedId)) {
        if (!this.PlatformClass) {
          throw new Error('PlatformClass not set. Call setPlatformClass() first.')
        }
        const newInstance = new (this.PlatformClass as unknown as new (props: any) => BaseItem<any>)(props)
        this.instanceCache.set(seedId, {
          instance: newInstance,
          refCount: 1,
        })
        return newInstance
      }
    }
    if (!props.modelName) {
      throw new Error('Model name is required to create an item')
    }
    // Filter out ItemData metadata properties - only pass model schema properties
    // Use schemaName from props if available (passed from Model.create() instance method)
    const schemaName = (props as any).schemaName
    // Use passed modelInstance if available (preferred - avoids async lookup and circular dependency)
    // Otherwise fall back to async lookup
    let model = props.modelInstance
    if (!model) {
      // Dynamic import to break circular dependency
      const { Model } = await import('@/Model/Model')
      model = await Model.getByNameAsync(props.modelName, schemaName)
    }
    
    // Get property names directly from database to avoid race conditions with Model.properties getter
    // which depends on ModelProperty instances being in cache
    let propertyNames: string[] = []
    const db = BaseDb.getAppDb()
    if (db && model) {
      const snapshot = model.getService().getSnapshot()
      const modelId = snapshot.context.modelId
      const modelFileId = snapshot.context._modelFileId
      
      // Try querying by modelId first (if available)
      if (modelId) {
        const propertyRecords = await db
          .select({ name: propertiesTable.name })
          .from(propertiesTable)
          .where(eq(propertiesTable.modelId, modelId))
        
        propertyNames = propertyRecords.map((r: { name: string | null }) => r.name).filter((name: string | null): name is string => Boolean(name))
      }
      
      // If modelId query didn't work, try querying by model name and schema
      if (propertyNames.length === 0) {
        // First get the model record by name, optionally filtered by schema
        let modelRecords
        
        // If we have a schema name, join with modelSchemas to filter by schema
        if (schemaName) {
          const { modelSchemas } = await import('@/seedSchema/ModelSchemaSchema')
          const { schemas: schemasTable } = await import('@/seedSchema/SchemaSchema')
          
          modelRecords = await db
            .select({ id: modelsTable.id })
            .from(modelsTable)
            .innerJoin(modelSchemas, eq(modelsTable.id, modelSchemas.modelId))
            .innerJoin(schemasTable, eq(modelSchemas.schemaId, schemasTable.id))
            .where(
              and(
                eq(modelsTable.name, props.modelName),
                eq(schemasTable.name, schemaName)
              )
            )
            .limit(1)
        } else {
          modelRecords = await db
            .select({ id: modelsTable.id })
            .from(modelsTable)
            .where(eq(modelsTable.name, props.modelName))
            .limit(1)
        }
        
        if (modelRecords.length > 0 && modelRecords[0].id) {
          const propertyRecords = await db
            .select({ name: propertiesTable.name })
            .from(propertiesTable)
            .where(eq(propertiesTable.modelId, modelRecords[0].id))
          
          propertyNames = propertyRecords.map((r: { name: string | null }) => r.name).filter((name: string | null): name is string => Boolean(name))
        }
      }
    }
    
    // Fallback: Try to get property names from model's pending property definitions
    if (propertyNames.length === 0 && model) {
      const snapshot = model.getService().getSnapshot()
      const pendingPropertyDefinitions = snapshot.context._pendingPropertyDefinitions
      if (pendingPropertyDefinitions && typeof pendingPropertyDefinitions === 'object') {
        propertyNames = Object.keys(pendingPropertyDefinitions).filter((name): name is string => Boolean(name))
      }
    }
    
    // Final fallback: Use Model.properties if available
    if (propertyNames.length === 0 && model?.properties) {
      propertyNames = model.properties.map(p => p.name).filter((name): name is string => Boolean(name))
    }
    
    const modelPropertyData: Partial<ModelValues<ModelSchema>> & { modelName: string } = { modelName: props.modelName }
    
    // Only include properties that are in the model schema
    // Exclude modelInstance, modelName, and schemaName as they're metadata, not item properties
    for (const [key, value] of Object.entries(props)) {
      // Skip metadata properties that aren't part of the item's data
      if (key === 'modelName' || key === 'schemaName' || key === 'modelInstance') {
        continue
      }
      if (propertyNames.includes(key)) {
        // Type assertion: we've filtered out modelInstance above, so value should be a valid property value
        modelPropertyData[key] = value as any
      }
    }
    const { seedLocalId, versionLocalId, } = await createNewItem(modelPropertyData)
    props.seedLocalId = seedLocalId
    props.latestVersionLocalId = versionLocalId
    if (!this.PlatformClass) {
      throw new Error('PlatformClass not set. Call setPlatformClass() first.')
    }
    const newInstance = new (this.PlatformClass as unknown as new (props: any) => BaseItem<any>)(props)
    this.instanceCache.set(newInstance.seedUid || newInstance.seedLocalId, {
      instance: newInstance,
      refCount: 1,
    })
    return newInstance
  }

  static async find({
    modelName,
    seedLocalId,
    seedUid,
  }: ItemFindProps): Promise<IItem<any> | undefined> {
    if (!seedLocalId && !seedUid) {
      return
    }
    const itemData = await getItemData({
      modelName,
      seedLocalId,
      seedUid,
    })

    if (!itemData) {
      console.error('No item data found', { modelName, seedLocalId, seedUid })
      return
    }

    return BaseItem.create({
      ...itemData,
      modelName,
    })
  }

  static async all(
    modelName?: string,
    deleted?: boolean,
  ): Promise<BaseItem<any>[]> {
    const itemsData = await getItemsData({ modelName, deleted })
    const itemInstances: BaseItem<any>[] = []
    for (const itemData of itemsData) {
      itemInstances.push(
        await BaseItem.create({
          ...itemData,
          modelName,
        }),
      )
    }

    return orderBy(itemInstances, ['createdAt'], ['desc'])
  }

  protected _createPropertyInstance(props: Partial<CreatePropertyInstanceProps>) {
    if (this._storageTransactionId) {
      props.storageTransactionId = this._storageTransactionId
    }

    const propertyInstance = BaseItemProperty.create(props)

    if (!propertyInstance || !props.propertyName) {
      return
    }

    this._service.send({
      type: 'addPropertyInstance',
      propertyName: props.propertyName,
      propertyInstance,
    })

    Object.defineProperty(this, props.propertyName, {
      get: () => propertyInstance.value,
      set: (value) => (propertyInstance.value = value),
      enumerable: true,
    })
  }


  static async publish(item: IItem<any>): Promise<void> {
    await waitForEvent({
      req: {
        eventLabel: `item.${item.seedLocalId}.publish.request`,
        data: {
          seedLocalId: item.seedLocalId,
        },
      },
      res: {
        eventLabel: `item.${item.seedLocalId}.publish.success`,
      },
    })
  }

  subscribe = (callback: (itemProps: any) => void): Subscription => {
    return this._service.subscribe((snapshot) => {
      callback(snapshot.context)
    })
  }

  getService = (): ActorRefFrom<typeof itemMachineSingle> => {
    return this._service
  }

  getEditedProperties = async (): Promise<PropertyData[]> => {
    return await getItemProperties({
      seedLocalId: this.seedLocalId,
      edited: true,
    })
  }

  publish = async (): Promise<void> => {
    await waitForEvent({
      req: {
        eventLabel: `item.publish.request`,
        data: {
          seedLocalId: this.seedLocalId,
        },
      },
      res: {
        eventLabel: `item.${this.seedLocalId}.publish.success`,
      },
    })
  }

  getPublishUploads = async () => {
    // Use dynamic import to break circular dependency
    const { getPublishUploads } = await import('@/db/read/getPublishUploads')
    return await getPublishUploads(this)
  }

  getPublishPayload = async (uploadedTransactions: any[]) => {
    // Use dynamic import to break circular dependency
    const { getPublishPayload } = await import('@/db/read/getPublishPayload')
    return await getPublishPayload(this, uploadedTransactions)
  }

  get serviceContext() {
    const snapshot = this._service.getSnapshot()
    return (snapshot as any).context || {}
  }

  get seedLocalId(): string {
    return this.serviceContext.seedLocalId as string
  }

  get seedUid(): string | undefined {
    return this.serviceContext.seedUid
  }

  get schemaUid(): string | undefined {
    return this.serviceContext.schemaUid
  }

  get latestVersionUid(): VersionsType {
    return this.serviceContext.latestVersionUid as VersionsType
  }

  get latestVersionLocalId(): string {
    return this.serviceContext.latestVersionLocalId as string
  }

  get modelName(): string {
    return this.serviceContext.modelName as string
  }

  /**
   * Helper method to determine if a property key is a model-specific property
   * (as opposed to an internal/common property)
   * 
   * Since properties are transformed in the subscription to match schema keys
   * (e.g., "authorId" -> "author", "tagIds" -> "tags"), the transformed key
   * should match a schema key directly. We also check the property instance's
   * original propertyName to handle edge cases.
   */
  protected _isModelProperty(key: string, modelSchemaKeys: string[]): boolean {
    // Direct match with schema (transformed keys should match schema keys)
    if (modelSchemaKeys.includes(key)) {
      return true
    }

    // Check property instances to see if this key corresponds to a model property
    // This handles cases where the transformation might not perfectly match
    const serviceContext = this.serviceContext
    const propertyInstances = serviceContext.propertyInstances as Map<string, IItemProperty> | undefined
    
    if (propertyInstances) {
      for (const [originalKey, propertyInstance] of propertyInstances) {
        // Skip internal properties
        if (INTERNAL_PROPERTY_NAMES.includes(originalKey as string)) {
          continue
        }

        // Reconstruct the transformation to see if it matches our key
        let transformedKey = originalKey as string
        
        if (propertyInstance.alias) {
          transformedKey = propertyInstance.alias
        } else if (originalKey.endsWith('Ids')) {
          transformedKey = pluralize(originalKey.slice(0, -3))
        } else if (originalKey.endsWith('Id')) {
          transformedKey = originalKey.slice(0, -2)
        }
        
        // If the transformed key matches, check if it's a model property
        if (transformedKey === key) {
          // Check if the base property name (without Id/Ids) is in the schema
          const baseName = originalKey.endsWith('Id') 
            ? originalKey.slice(0, -2)
            : originalKey.endsWith('Ids')
            ? pluralize(originalKey.slice(0, -3))
            : originalKey
          
          // Also check the alias if it exists
          const checkName = propertyInstance.alias || baseName
          return modelSchemaKeys.includes(checkName)
        }
      }
    }

    return false
  }

  /**
   * Returns only properties that are defined in the Model's schema
   * (excludes internal/common properties)
   */
  get properties(): Record<string, IItemProperty> {
    const allProps = this._propertiesSubject.value
    const Model = getModel()
    const model = Model.getByName(this.modelName)
    const properties = model?.properties || []
    const modelSchemaKeys = properties.map(p => p.name).filter((name): name is string => Boolean(name))

    // Filter to only include properties defined in the Model schema or derived from it
    return Object.fromEntries(
      Object.entries(allProps).filter(([key]) => {
        // Exclude internal properties
        if (INTERNAL_PROPERTY_NAMES.includes(key)) {
          return false
        }
        // Include if it's a model property or derived from one
        return this._isModelProperty(key, modelSchemaKeys)
      })
    )
  }

  /**
   * Returns only internal/common properties that are shared across all Items
   * (e.g., seedLocalId, seedUid, createdAt, etc.)
   */
  get internalProperties(): Record<string, IItemProperty> {
    const allProps = this._propertiesSubject.value
    return Object.fromEntries(
      Object.entries(allProps).filter(([key]) =>
        INTERNAL_PROPERTY_NAMES.includes(key)
      )
    )
  }

  /**
   * Returns all properties (both model-specific and internal)
   * Useful for backward compatibility or debugging
   */
  get allProperties(): Record<string, IItemProperty> {
    return this._propertiesSubject.value
  }

  get attestationCreatedAt(): number {
    return this.serviceContext.attestationCreatedAt as number
  }

  get versionsCount(): number {
    return this.serviceContext.versionsCount as number
  }

  get lastVersionPublishedAt(): number {
    return this.serviceContext.lastVersionPublishedAt as number
  }

  get createdAt(): number | undefined {
    // Try to get from serviceContext first
    if (this.serviceContext.createdAt !== undefined) {
      return this.serviceContext.createdAt as number
    }
    // Try to get from allProperties if it exists as a property
    const createdAtProp = this.allProperties.createdAt
    if (createdAtProp) {
      return createdAtProp.value as number | undefined
    }
    return undefined
  }

  unload(): void {
    this._subscription?.unsubscribe()
    this._service.stop()
  }
}
