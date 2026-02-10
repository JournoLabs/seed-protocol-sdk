import { IItem, IItemProperty } from '@/interfaces'
import { itemMachineSingle } from '@/Item/service/itemMachineSingle'
import { INTERNAL_PROPERTY_NAMES } from '@/helpers/constants'
import { VersionsType } from '@/seedSchema'
// Dynamic import to break circular dependency: Model -> Item -> Model
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
import type { CreateWaitOptions } from '@/types'

import { BehaviorSubject } from 'rxjs'
import { ActorRefFrom, Subscription, createActor, SnapshotFrom } from 'xstate'
import pluralize from 'pluralize'
import { orderBy, startCase } from 'lodash-es'
import { getItemData } from '@/db/read/getItemData'
import { getItemsData } from '@/db/read/getItems'
import { ItemProperty } from '@/ItemProperty/ItemProperty'
import { getItemProperties } from '@/db/read/getItemProperties'
import { createNewItem } from '@/db/write/createNewItem'
import { BaseDb } from '@/db/Db/BaseDb'
import { properties as propertiesTable, models as modelsTable } from '@/seedSchema'
import { modelPropertiesToObject } from '@/helpers/model'
import { waitForEntityIdle } from '@/helpers/waitForEntityIdle'
import { findEntity } from '@/helpers/entity/entityFind'
import { unloadEntity } from '@/helpers/entity/entityUnload'
import {
  clearDestroySubscriptions,
  forceRemoveFromCaches,
  runDestroyLifecycle,
} from '@/helpers/entity/entityDestroy'
import { deleteItem } from '@/db/write/deleteItem'
import { updateSeedUid } from '@/db/write/updateSeedUid'
import { eq, and } from 'drizzle-orm'
import debug from 'debug'

const itemLogger = debug('seedSdk:Item')

// Fallback helper for synchronous Model access when modelInstance is not provided
// This is only used as a fallback - the preferred approach is to pass modelInstance
// directly to Item constructor (which Model.create() instance method does).
// Since Model.getByName() is synchronous and just accesses a cache, Model must be loaded
// when Item constructor runs (because Model imports Item).
let ModelClass: typeof import('@/Model/Model').Model | null = null
let modelImportPromise: Promise<typeof import('@/Model/Model')> | null = null

const getModel = (): typeof import('@/Model/Model').Model => {
  if (!ModelClass) {
    // Start loading Model if not already started
    if (!modelImportPromise) {
      modelImportPromise = import('@/Model/Model')
      // Try to get Model synchronously if already loaded
      // This works because Model imports Item, so Model is initialized when Item runs
      modelImportPromise.then(module => {
        ModelClass = module.Model
      }).catch(() => {
        // If import fails, ModelClass remains null
      })
    }
    // For synchronous access, we need Model to already be loaded
    // If it's not loaded yet, this will throw, but in practice Model is always loaded
    // because Model imports Item, creating the initialization order
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

// Define tracked properties for the Proxy
// These properties will be read from/written to the actor context
const TRACKED_PROPERTIES = [
  'seedLocalId',
  'seedUid',
  'modelName',
  'schemaUid',
  'latestVersionLocalId',
  'latestVersionUid',
] as const

// WeakMap to store mutable state per Item instance
// This avoids issues with read-only properties when instances are frozen by Immer
const itemInstanceState = new WeakMap<Item<any>, {
  liveQuerySubscription: { unsubscribe: () => void } | null // LiveQuery subscription for cross-instance updates
  definedPropertyNames: Set<string>
}>()

export class Item<T extends ModelValues<ModelSchema>> implements IItem<T> {

  protected static instanceCache: Map<string, { instance: Item<any>; refCount: number }> = new Map();
  protected _subscription: Subscription | undefined;
  protected readonly _storageTransactionId: string | undefined;
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

    // Store modelInstance if provided (for backward compatibility)
    // But Item no longer depends on Model being loaded - it loads properties from database directly
    if (initialValues.storageTransactionId) {
      this._storageTransactionId = initialValues.storageTransactionId
    }

    this._service = createActor(itemMachineSingle, {
      input: {
        seedLocalId,
        seedUid,
        schemaUid,
        modelName,
        latestVersionLocalId,
        latestVersionUid,
        storageTransactionId: this._storageTransactionId,
        // ModelClass is no longer needed - Item loads properties from database independently
      },
    })

    this._subscription = this._service.subscribe((snapshot: SnapshotFrom<typeof itemMachineSingle>) => {
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

      // Define accessors for any property instances we don't have yet (e.g. from loadOrCreateItem)
      const state = itemInstanceState.get(this)
      const definedSet = state?.definedPropertyNames
      if (definedSet) {
        for (const key of context.propertyInstances.keys()) {
          if (typeof key !== 'string' || INTERNAL_PROPERTY_NAMES.includes(key)) {
            continue
          }
          if (!definedSet.has(key)) {
            this._definePropertyAccessor(key)
          }
        }
      }

      this._propertiesSubject.next(propertiesObj)
    })

    this._service.start()

    // Initialize instance state in WeakMap
    itemInstanceState.set(this, {
      liveQuerySubscription: null,
      definedPropertyNames: new Set(),
    })
    
    // Set up liveQuery subscription for cross-instance updates
    this._setupLiveQuerySubscription()

    // Properties are now loaded from database via loadOrCreateItem actor
    // Create property instances for all model properties plus any keys in initialValues,
    // so that e.g. newPost.title = '...' works even when the item was created with no initial values.
    const itemPropertyBase: Partial<CreatePropertyInstanceProps> = {
      seedLocalId,
      seedUid,
      versionLocalId: latestVersionLocalId,
      versionUid: latestVersionUid,
      modelName,
    }

    const metadataKeys = [
      'modelName',
      'schemaName',
      'modelInstance',
      'seedLocalId',
      'seedUid',
      'schemaUid',
      'latestVersionLocalId',
      'latestVersionUid',
    ] as const

    const keysFromInitial = (Object.keys(initialValues) as Array<string & keyof Partial<T>>).filter(
      (key) => !metadataKeys.includes(key as any),
    )
    const schemaNameForModel = (initialValues as Record<string, unknown>).schemaName as string | undefined
    const modelPropertyNames = this._getModelPropertyNames(schemaNameForModel)
    const allKeys = new Set<string>([...keysFromInitial, ...modelPropertyNames])

    let model: import('@/Model/Model').Model | undefined
    try {
      const M = getModel()
      model = M != null ? M.getByName(modelName, schemaNameForModel) : undefined
    } catch {
      model = undefined
    }
    const propertySchemas = model?.properties?.length
      ? modelPropertiesToObject(model.properties)
      : {}

    for (const key of allKeys) {
      if (INTERNAL_PROPERTY_NAMES.includes(key)) {
        continue
      }
      this._createPropertyInstance({
        ...itemPropertyBase,
        propertyName: key,
        propertyValue: (initialValues as Record<string, unknown>)[key] ?? undefined,
        propertyRecordSchema: propertySchemas[key] ?? undefined,
      })
    }
  }

  static async create<T extends ModelValues<ModelSchema>>(
    props: Partial<ItemData> & { modelInstance?: import('@/Model/Model').Model },
    options?: CreateWaitOptions,
  ): Promise<Item<any>> {
    const waitForReady = options?.waitForReady !== false
    const readyTimeout = options?.readyTimeout ?? 5000

    if (!props.modelName && props.type) {
      props.modelName = startCase(props.type)
    }
    if (props.seedUid || props.seedLocalId) {
      const seedId = (props.seedUid || props.seedLocalId) as string
        if (this.instanceCache.has(seedId)) {
        const { instance, refCount } = this.instanceCache.get(seedId)!
        console.log(`[Item.create] Returning cached instance for ${seedId}`)
        this.instanceCache.set(seedId, {
          instance,
          refCount: refCount + 1,
        })
        for (const [propertyName, propertyValue] of Object.entries(props)) {
          const snapshot = instance.getService().getSnapshot() as SnapshotFrom<typeof itemMachineSingle>
          const propertyInstances = snapshot.context.propertyInstances
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
        if (!waitForReady) return instance
        await waitForEntityIdle(instance, { timeout: readyTimeout })
        return instance
      }
      if (!this.instanceCache.has(seedId)) {
        // Item no longer needs modelInstance - it loads properties from database independently
        // Exclude latestVersionUid from props as it has incompatible types (string vs VersionsType)
        const { latestVersionUid, ...propsWithoutVersionUid } = props
        const propsWithModel = { ...propsWithoutVersionUid } as any
        const newInstance = new Item(propsWithModel)
        
        // Wrap instance in Proxy for reactive property access
        const proxiedInstance = new Proxy(newInstance, {
          get(target, prop: string | symbol) {
            // Log all property accesses to see what's being called
            if (typeof prop === 'string' && prop === 'properties') {
              console.log(`[Item.Proxy.get] properties accessed on Item instance`)
            }
            // Handle special properties
            if (prop === '_service') {
              return Reflect.get(target, prop)
            }
            
            // Handle tracked properties
            if (typeof prop === 'string' && TRACKED_PROPERTIES.includes(prop as any)) {
              const context = target._getSnapshotContext()
              return (context as any)[prop]
            }
            
            // Handle 'properties' getter - not tracked, but accessible via getter
            if (typeof prop === 'string' && prop === 'properties') {
              // Delegate to the getter method on the instance
              return target.properties
            }
            
            // For methods and other properties, use Reflect
            return Reflect.get(target, prop)
          },
          
          set(target, prop: string | symbol, value: any) {
            // Handle special properties
            if (prop === '_service') {
              return Reflect.set(target, prop, value)
            }
            
            // Handle tracked properties
            if (typeof prop === 'string' && TRACKED_PROPERTIES.includes(prop as any)) {
              // Standard property update
              target._service.send({
                type: 'updateContext',
                [prop]: value,
              })
              // Auto-persist seedUid to DB when assigned so future loads and getPublishPayload see it
              if (prop === 'seedUid' && typeof value === 'string' && value.length > 0) {
                const seedLocalId = target._getSnapshotContext().seedLocalId
                if (seedLocalId) {
                  void updateSeedUid({ seedLocalId, seedUid: value }).catch((err) => {
                    itemLogger('updateSeedUid failed:', err)
                  })
                }
              }
              return true
            }
            
            // Handle 'properties' - read-only computed property
            if (typeof prop === 'string' && prop === 'properties') {
              // Properties are read-only computed values from propertyInstances
              // Cannot be set directly - properties are managed via ItemProperty instances
              throw new Error('Cannot set item.properties directly. Properties are computed from ItemProperty instances.')
            }
            
            // For non-tracked properties, use Reflect
            return Reflect.set(target, prop, value)
          },
          
          has(target, prop: string | symbol) {
            // Check tracked properties
            if (typeof prop === 'string' && TRACKED_PROPERTIES.includes(prop as any)) {
              const context = target._getSnapshotContext()
              return prop in context
            }
            return Reflect.has(target, prop)
          },
          
          ownKeys(target) {
            // Return keys from target
            return Reflect.ownKeys(target)
          },
          
          getOwnPropertyDescriptor(target, prop: string | symbol) {
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
        }) as Item<any>
        
        this.instanceCache.set(seedId, {
          instance: proxiedInstance,
          refCount: 1,
        })
        if (!waitForReady) return proxiedInstance
        await waitForEntityIdle(proxiedInstance, { timeout: readyTimeout })
        return proxiedInstance
      }
    }
    if (!props.modelName) {
      throw new Error('Model name is required to create an item')
    }
    // Filter out ItemData metadata properties - only pass model schema properties
    // Use schemaName from props if available (passed from Model.create() instance method)
    const schemaName = (props as any).schemaName
    
    // Get property names directly from database to make Item independent from Model
    let propertyNames: string[] = []
    const db = BaseDb.getAppDb()
    if (db && props.modelName) {
      // Query properties table directly by model name
      // First get the model record by name, optionally filtered by schema
      let modelRecords
      
      // If we have a schema name, join with modelSchemas to filter by schema
      if (schemaName) {
        const modelSchemaSchemaMod = await import('../seedSchema/ModelSchemaSchema')
        const { modelSchemas } = modelSchemaSchemaMod
        const schemaSchemaMod = await import('../seedSchema/SchemaSchema')
        const { schemas: schemasTable } = schemaSchemaMod
        
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
    
    const modelPropertyData: Partial<ModelValues<ModelSchema>> & { modelName: string } = { modelName: props.modelName }
    
    // Only include properties that are in the model schema
    // Exclude modelInstance, modelName, and schemaName as they're metadata, not item properties
    for (const [key, value] of Object.entries(props)) {
      // Skip metadata properties that aren't part of the item's data
      if (key === 'modelName' || key === 'schemaName' || key === 'modelInstance') {
        continue
      }
      if (propertyNames.length === 0 || propertyNames.includes(key)) {
        // If we couldn't get property names from DB, include all properties
        // Type assertion: we've filtered out modelInstance above, so value should be a valid property value
        modelPropertyData[key] = value as any
      }
    }
    const { seedLocalId, versionLocalId, } = await createNewItem(modelPropertyData)
    props.seedLocalId = seedLocalId
    props.latestVersionLocalId = versionLocalId
    // Item no longer needs modelInstance - it loads properties from database independently
    // Exclude latestVersionUid from props as it has incompatible types (string vs VersionsType)
    const { latestVersionUid, ...propsWithoutVersionUid } = props
    const propsWithModel = { ...propsWithoutVersionUid } as any
    const newInstance = new Item(propsWithModel)
    
    // Wrap instance in Proxy for reactive property access
    const proxiedInstance = new Proxy(newInstance, {
      get(target, prop: string | symbol) {
        // Log all property accesses to see what's being called
        if (typeof prop === 'string' && prop === 'properties') {
          console.log(`[Item.Proxy.get] properties accessed on Item instance (second Proxy setup)`)
        }
        // Handle special properties
        if (prop === '_service') {
          return Reflect.get(target, prop)
        }
        
        // Handle tracked properties
        if (typeof prop === 'string' && TRACKED_PROPERTIES.includes(prop as any)) {
          // Special handling for properties - compute from propertyInstances Map
          if (prop === 'properties') {
            console.log(`[Item.Proxy.properties] Proxy handler called for properties (second Proxy setup)`)
            const snapshot = target._service.getSnapshot() as SnapshotFrom<typeof itemMachineSingle>
            const context = snapshot.context
            const propertyInstances = context.propertyInstances as Map<string, IItemProperty> | undefined
            const modelName = context.modelName as string
            
            console.log(`[Item.Proxy.properties] ${modelName}: propertyInstances size: ${propertyInstances?.size || 0}`)
            if (!propertyInstances || propertyInstances.size === 0) {
              console.log(`[Item.Proxy.properties] ${modelName}: No property instances`)
              return []
            }
            
            // Get model schema keys for filtering
            const modelSchemaKeys = target._getModelSchemaKeys()
            console.log(`[Item.Proxy.properties] ${modelName}: modelSchemaKeys:`, modelSchemaKeys)
            console.log(`[Item.Proxy.properties] ${modelName}: propertyInstances keys:`, Array.from(propertyInstances.keys()))
            
            // Convert Map to array, filtering by model schema
            const properties: IItemProperty[] = []
            for (const [key, propertyInstance] of propertyInstances) {
              // Skip internal properties
              if (INTERNAL_PROPERTY_NAMES.includes(key)) {
                continue
              }
              
              // Include if it's a model property
              const isModelProp = target._isModelProperty(key, modelSchemaKeys)
              const propValue = propertyInstance.value
              console.log(`[Item.Proxy.properties] ${modelName}: key="${key}", propertyName="${propertyInstance.propertyName}", isModelProperty=${isModelProp}, value=${propValue}`)
              if (isModelProp) {
                properties.push(propertyInstance)
                console.log(`[Item.Proxy.properties] ${modelName}: Added property "${propertyInstance.propertyName}" with value:`, propValue)
              }
            }
            
            const propertiesInfo = properties.map(p => ({
              propertyName: p.propertyName,
              value: p.value,
              hasValue: p.value !== undefined && p.value !== null
            }))
            console.log(`[Item.Proxy.properties] ${modelName}: Returning ${properties.length} properties:`, JSON.stringify(propertiesInfo, null, 2))
            // CRITICAL: Always create a new array reference so React detects changes
            return [...properties]
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
        
        // Handle tracked properties
        if (typeof prop === 'string' && TRACKED_PROPERTIES.includes(prop as any)) {
          if (prop === 'properties') {
            // Properties are read-only computed values from propertyInstances
            // Cannot be set directly - properties are managed via ItemProperty instances
            throw new Error('Cannot set item.properties directly. Properties are computed from ItemProperty instances.')
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
        // Check tracked properties
        if (typeof prop === 'string' && TRACKED_PROPERTIES.includes(prop as any)) {
          const context = target._getSnapshotContext()
          return prop in context
        }
        return Reflect.has(target, prop)
      },
      
      ownKeys(target) {
        // Return keys from target
        return Reflect.ownKeys(target)
      },
      
      getOwnPropertyDescriptor(target, prop: string | symbol) {
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
    }) as Item<any>
    
    this.instanceCache.set((proxiedInstance.seedUid || proxiedInstance.seedLocalId) as string, {
      instance: proxiedInstance,
      refCount: 1,
    })
    if (!waitForReady) return proxiedInstance
    await waitForEntityIdle(proxiedInstance, { timeout: readyTimeout })
    return proxiedInstance
  }

  /**
   * Get Item instance by ID from cache
   * The ID can be either seedUid or seedLocalId
   * @param id - seedUid or seedLocalId
   * @returns Cached Item instance or null if not found
   */
  static getById(id: string): Item<any> | null {
    if (!id) {
      return null
    }
    
    // Check cache - the cache key is seedUid || seedLocalId
    if (this.instanceCache.has(id)) {
      const { instance, refCount } = this.instanceCache.get(id)!
      this.instanceCache.set(id, {
        instance,
        refCount: refCount + 1,
      })
      return instance
    }
    
    return null
  }

  /**
   * Create Item instance by ID (queries database if not in cache)
   * The ID can be either seedUid or seedLocalId
   * @param id - seedUid or seedLocalId
   * @param modelName - Optional model name for querying
   * @returns Item instance or undefined if not found
   */
  static async createById(id: string, modelName?: string): Promise<Item<any> | undefined> {
    if (!id) {
      return undefined
    }

    // Check cache first
    const cached = this.getById(id)
    if (cached) {
      return cached
    }

    // Determine if id is seedUid or seedLocalId by querying database
    // Try seedUid first, then seedLocalId
    let itemData = await getItemData({
      modelName,
      seedUid: id,
    })

    if (!itemData) {
      // Try as seedLocalId
      itemData = await getItemData({
        modelName,
        seedLocalId: id,
      })
    }

    if (!itemData) {
      return undefined
    }

    // Item.create() will handle caching the new instance
    return await Item.create({
      ...itemData,
      modelName,
    })
  }

  static async find({
    modelName,
    seedLocalId,
    seedUid,
    waitForReady = true,
    readyTimeout = 5000,
  }: ItemFindProps & {
    waitForReady?: boolean
    readyTimeout?: number
  }): Promise<IItem<any> | undefined> {
    if (!seedLocalId && !seedUid) {
      return undefined
    }

    // Use seedUid as primary ID if available, otherwise use seedLocalId
    const id = seedUid || seedLocalId
    if (!id) {
      return undefined
    }

    try {
      return await findEntity<Item<any>>(
        {
          getById: (id) => Item.getById(id) || undefined,
          createById: async (id) => {
            // Pass modelName to createById if available
            return await Item.createById(id, modelName)
          },
        },
        { id },
        {
          waitForReady,
          readyTimeout,
        }
      )
    } catch (error) {
      return undefined
    }
  }

  static async all(
    modelName?: string,
    deleted?: boolean,
    options?: { waitForReady?: boolean; readyTimeout?: number },
  ): Promise<Item<any>[]> {
    const { waitForReady = false, readyTimeout = 5000 } = options ?? {}
    const itemsData = await getItemsData({ modelName, deleted })
    const itemInstances: Item<any>[] = []
    for (const itemData of itemsData) {
      itemInstances.push(
        await Item.create({
          ...itemData,
          modelName,
        }),
      )
    }

    if (waitForReady && itemInstances.length > 0) {
      await Promise.all(
        itemInstances.map((item) =>
          waitForEntityIdle(item, { timeout: readyTimeout }),
        ),
      )
    }

    return orderBy(itemInstances, ['createdAt'], ['desc'])
  }

  protected _createPropertyInstance(props: Partial<CreatePropertyInstanceProps>) {
    if (this._storageTransactionId) {
      props.storageTransactionId = this._storageTransactionId
    }

    const propertyInstance = ItemProperty.create(props, {
        waitForReady: false,
      })

    if (!propertyInstance || !props.propertyName) {
      return
    }

    this._service.send({
      type: 'addPropertyInstance',
      propertyName: props.propertyName,
      propertyInstance,
    })

    this._definePropertyAccessor(props.propertyName)
  }

  /**
   * Defines a property accessor on this Item that delegates get/set to the
   * ItemProperty in context.propertyInstances at access time (so the correct
   * instance is used after loadOrCreateItemSuccess merges DB-backed instances).
   */
  protected _definePropertyAccessor(propertyName: string): void {
    let state = itemInstanceState.get(this)
    if (!state) {
      state = { liveQuerySubscription: null, definedPropertyNames: new Set() }
      itemInstanceState.set(this, state)
    }
    if (state.definedPropertyNames.has(propertyName)) {
      return
    }
    Object.defineProperty(this, propertyName, {
      get: () => {
        const inst = this._service.getSnapshot().context.propertyInstances?.get(propertyName)
        return inst?.value
      },
      set: (value: any) => {
        const inst = this._service.getSnapshot().context.propertyInstances?.get(propertyName)
        if (inst) {
          inst.value = value
        }
      },
      enumerable: true,
    })
    state.definedPropertyNames.add(propertyName)
  }

  static async publish(item: IItem<any>): Promise<void> {
    await item.publish()
  }

  subscribe = (callback: (itemProps: any) => void): Subscription => {
    return this._service.subscribe((snapshot: SnapshotFrom<typeof itemMachineSingle>) => {
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
    this._service.send({ type: 'startPublish' })
    return new Promise<void>((resolve, reject) => {
      let wasPublishing = false
      const timeoutMs = 300000 // 5 minutes, match previous handler timeout
      const timeoutId = setTimeout(() => {
        unsub.unsubscribe()
        if (!wasPublishing) {
          reject(new Error('Publish did not start (timeout)'))
        } else {
          reject(new Error('Publish timed out'))
        }
      }, timeoutMs)
      const unsub = this._service.subscribe((snapshot: SnapshotFrom<typeof itemMachineSingle>) => {
        const value = snapshot.value as string
        if (value === 'publishing') {
          wasPublishing = true
        }
        if (value === 'idle' && wasPublishing) {
          clearTimeout(timeoutId)
          unsub.unsubscribe()
          const ctx = snapshot.context as { _publishError?: { message: string } | null }
          if (ctx._publishError) {
            reject(new Error(ctx._publishError.message))
          } else {
            resolve()
          }
        }
      })
    })
  }

  getPublishUploads = async () => {
    // Use dynamic import to break circular dependency
    const getPublishUploadsMod = await import('../db/read/getPublishUploads')
    const { getPublishUploads } = getPublishUploadsMod
    return await getPublishUploads(this)
  }

  getPublishPayload = async (uploadedTransactions: any[]) => {
    // Use dynamic import to break circular dependency
    const getPublishPayloadMod = await import('../db/read/getPublishPayload')
    const { getPublishPayload } = getPublishPayloadMod
    return await getPublishPayload(this, uploadedTransactions)
  }

  persistSeedUid = async (): Promise<void> => {
    const ctx = this._getSnapshotContext()
    const seedLocalId = ctx.seedLocalId
    const seedUid = ctx.seedUid
    if (seedLocalId && seedUid && typeof seedUid === 'string' && seedUid.length > 0) {
      await updateSeedUid({ seedLocalId, seedUid })
    }
  }

  get serviceContext() {
    const snapshot = this._service.getSnapshot()
    return (snapshot as any).context || {}
  }

  /**
   * Get snapshot context from the service
   * Used by the reactive proxy to read tracked properties
   */
  _getSnapshotContext() {
    return (this._service.getSnapshot() as SnapshotFrom<typeof itemMachineSingle>).context
  }

  // These getters are now handled by the reactive proxy
  // They read from the service context via the proxy
  // Keeping them for backward compatibility, but they delegate to serviceContext
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
   * Returns model property names from the Model cache (for use in constructor when
   * property instances are not yet available). Returns [] if modelName is missing
   * or Model is not in cache. Pass schemaName when available so the correct model
   * is resolved (cache is keyed by schemaName:modelName).
   */
  protected _getModelPropertyNames(schemaName?: string): string[] {
    try {
      const Model = getModel()
      const modelName = this.modelName
      if (!modelName) {
        return []
      }
      const model = Model.getByName(modelName, schemaName)
      if (!model) {
        return []
      }
      const modelProperties = model.properties || []
      if (modelProperties.length === 0) {
        return []
      }
      const names: string[] = []
      for (const modelProperty of modelProperties) {
        const propContext = modelProperty._getSnapshotContext()
        const propertyName = propContext.name
        if (propertyName && !INTERNAL_PROPERTY_NAMES.includes(propertyName)) {
          if (!names.includes(propertyName)) {
            names.push(propertyName)
          }
        }
      }
      return names
    } catch {
      return []
    }
  }

  /**
   * Helper method to get model schema keys for filtering properties
   * Since properties are loaded from metadata (which already corresponds to the model),
   * we can infer schema keys from the property instances themselves
   * This makes Item independent from Model
   */
  protected _getModelSchemaKeys(): string[] {
    // Get model schema keys - prefer property instances since they come from the database
    // and are already filtered to the correct model. Fall back to Model if property instances
    // aren't available yet.
    const serviceContext = this.serviceContext
    const propertyInstances = serviceContext.propertyInstances as Map<string, IItemProperty> | undefined
    const modelName = this.modelName
    
    // First, try to get schema keys from property instances (most reliable)
    // Property instances come from the database and are already model-specific
    if (propertyInstances && propertyInstances.size > 0) {
      const schemaKeys = this._getSchemaKeysFromPropertyInstances(propertyInstances)
      if (schemaKeys.length > 0) {
        return schemaKeys
      }
    }
    
    // Fall back to Model if property instances aren't available yet
    try {
      const Model = getModel()
      if (!modelName) {
        return []
      }
      
      const model = Model.getByName(modelName)
      if (!model) {
        return []
      }
      
      // Get property names from Model.properties
      const modelProperties = model.properties || []
      if (modelProperties.length === 0) {
        return []
      }
      
      const schemaKeys: string[] = []
      for (const modelProperty of modelProperties) {
        const propContext = modelProperty._getSnapshotContext()
        const propertyName = propContext.name
        if (propertyName && !INTERNAL_PROPERTY_NAMES.includes(propertyName)) {
          if (!schemaKeys.includes(propertyName)) {
            schemaKeys.push(propertyName)
          }
        }
      }
      
      return schemaKeys
    } catch (error) {
      // If Model access fails, return empty array (property instances should be used instead)
      return []
    }
  }
  
  protected _getSchemaKeysFromPropertyInstances(propertyInstances: Map<string, IItemProperty> | undefined): string[] {
    if (!propertyInstances || propertyInstances.size === 0) {
      return []
    }
    
    const schemaKeys: string[] = []
    for (const [key, propertyInstance] of propertyInstances) {
      // Skip internal properties
      if (INTERNAL_PROPERTY_NAMES.includes(key)) {
        continue
      }
      
      // Prefer propertyInstance.propertyName if available (most reliable)
      // Otherwise use the Map key
      let propertyName = propertyInstance.propertyName || key
      
      // Apply transformations if needed
      let transformedKey = propertyName
      if (propertyInstance.alias) {
        transformedKey = propertyInstance.alias
      } else if (propertyName.endsWith('Ids')) {
        transformedKey = pluralize(propertyName.slice(0, -3))
      } else if (propertyName.endsWith('Id')) {
        transformedKey = propertyName.slice(0, -2)
      }
      
      if (!schemaKeys.includes(transformedKey)) {
        schemaKeys.push(transformedKey)
      }
    }
    return schemaKeys
  }

  /**
   * Helper method to determine if a property key is a model-specific property
   * (as opposed to an internal/common property)
   *
   * Uses the same transformation as _getSchemaKeysFromPropertyInstances so that
   * Map keys (e.g. "authorId", "tagIds") are correctly matched to schema keys
   * (e.g. "author", "tags").
   */
  protected _isModelProperty(key: string, modelSchemaKeys: string[]): boolean {
    if (INTERNAL_PROPERTY_NAMES.includes(key)) {
      return false
    }
    if (modelSchemaKeys.includes(key)) {
      return true
    }
    const propertyInstances = this.serviceContext.propertyInstances as Map<string, IItemProperty> | undefined
    if (!propertyInstances) {
      return false
    }
    const propertyInstance = propertyInstances.get(key)
    if (!propertyInstance) {
      return false
    }
    // Apply same transformation as _getSchemaKeysFromPropertyInstances
    const propertyName = propertyInstance.propertyName || key
    let transformedKey = propertyName
    if (propertyInstance.alias) {
      transformedKey = propertyInstance.alias
    } else if (propertyName.endsWith('Ids')) {
      transformedKey = pluralize(propertyName.slice(0, -3))
    } else if (propertyName.endsWith('Id')) {
      transformedKey = propertyName.slice(0, -2)
    }
    return modelSchemaKeys.includes(transformedKey)
  }

  /**
   * Returns only properties that are defined in the Model's schema
   * (excludes internal/common properties)
   */
  get properties(): IItemProperty[] {
    const serviceContext = this.serviceContext
    const propertyInstances = serviceContext.propertyInstances as Map<string, IItemProperty> | undefined
    const modelName = this.modelName
    
    if (!propertyInstances || propertyInstances.size === 0) {
      console.log(`[Item.properties getter] ${modelName}: No property instances`)
      return []
    }
    
    // Get model schema keys for filtering
    const modelSchemaKeys = this._getModelSchemaKeys()
    console.log(`[Item.properties getter] ${modelName}: modelSchemaKeys:`, modelSchemaKeys)
    console.log(`[Item.properties getter] ${modelName}: propertyInstances keys:`, Array.from(propertyInstances.keys()))
    
    // Convert Map to array, filtering by model schema
    const properties: IItemProperty[] = []
    for (const [key, propertyInstance] of propertyInstances) {
      // Skip internal properties
      if (INTERNAL_PROPERTY_NAMES.includes(key)) {
        continue
      }
      
      // Include if it's a model property
      const isModelProp = this._isModelProperty(key, modelSchemaKeys)
      console.log(`[Item.properties getter] ${modelName}: key="${key}", propertyName="${propertyInstance.propertyName}", isModelProperty=${isModelProp}`)
      if (isModelProp) {
        properties.push(propertyInstance)
      }
    }
    
    console.log(`[Item.properties getter] ${modelName}: Returning ${properties.length} properties:`, properties.map(p => p.propertyName))
    // Always return new array reference for React reactivity
    return [...properties]
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

  /**
   * Set up liveQuery subscription to watch for item and version changes in the database
   * This enables cross-instance synchronization (e.g., changes in other tabs/windows)
   */
  private _setupLiveQuerySubscription(): void {
    const isBrowser = typeof window !== 'undefined'
    const logger = debug('seedSdk:item:liveQuery')
    
    // Use a closure variable to track setup state per instance
    const setupState = { subscriptionSetUp: false }

    const setupLiveQuery = async (seedLocalId: string, seedUid?: string) => {
      if (setupState.subscriptionSetUp) {
        return
      }

      setupState.subscriptionSetUp = true
      logger(`[Item._setupLiveQuerySubscription] Setting up liveQuery for seedLocalId: ${seedLocalId}`)
      
      try {
        const seedSchemaMod = await import('../seedSchema')
        const { seeds, versions, metadata } = seedSchemaMod
        const drizzleMod = await import('drizzle-orm')
        const { eq, and } = drizzleMod
        const versionDataMod = await import('../db/read/subqueries/versionData')
        const { getVersionData } = versionDataMod
        
        const db = BaseDb.getAppDb()
        if (!db) {
          logger('[Item._setupLiveQuerySubscription] Database not available')
          return
        }

        // Query initial seed and version data
        const versionData = getVersionData()
        const seedRecords = await db
          .with(versionData)
          .select({
            seedLocalId: seeds.localId,
            seedUid: seeds.uid,
            schemaUid: seeds.schemaUid,
            latestVersionUid: versionData.latestVersionUid,
            latestVersionLocalId: versionData.latestVersionLocalId,
          })
          .from(seeds)
          .leftJoin(versionData, eq(seeds.localId, versionData.seedLocalId))
          .where(
            seedUid ? eq(seeds.uid, seedUid) : eq(seeds.localId, seedLocalId)
          )
          .limit(1)

        if (seedRecords.length === 0) {
          logger(`[Item._setupLiveQuerySubscription] Seed not found for seedLocalId: ${seedLocalId}`)
          return
        }

        const seedRecord = seedRecords[0]
        const currentVersionLocalId = seedRecord.latestVersionLocalId

        if (!currentVersionLocalId) {
          logger(`[Item._setupLiveQuerySubscription] No version found for seedLocalId: ${seedLocalId}`)
          return
        }

        // Query initial metadata records for the latest version
        const initialMetadata = await db
          .select()
          .from(metadata)
          .where(
            and(
              eq(metadata.seedLocalId, seedLocalId),
              eq(metadata.versionLocalId, currentVersionLocalId)
            )
          )

        const initialMetadataIds = initialMetadata
          .map((row: any) => row.localId || row.uid)
          .filter((id: string | null | undefined): id is string => Boolean(id))

        logger(`[Item._setupLiveQuerySubscription] Initial query returned ${initialMetadataIds.length} metadata records`)

        // CRITICAL: Create ItemProperty instances BEFORE updating context
        if (initialMetadataIds.length > 0) {
          try {
            const itemPropertyMod = await import('../ItemProperty/ItemProperty')
            const { ItemProperty } = itemPropertyMod
            const itemModelName = this._service.getSnapshot().context.modelName
            const createPromises = initialMetadata.map(async (metaRow: any) => {
              try {
                const property = await ItemProperty.find({
                  propertyName: metaRow.propertyName,
                  seedLocalId,
                  seedUid,
                  modelName: itemModelName,
                })
                if (property) {
                  logger(`[Item._setupLiveQuerySubscription] Created/cached ItemProperty instance for propertyName "${metaRow.propertyName}"`)
                }
              } catch (error) {
                logger(`[Item._setupLiveQuerySubscription] Error creating ItemProperty instance: ${error}`)
              }
            })
            await Promise.all(createPromises)
          } catch (error) {
            logger(`[Item._setupLiveQuerySubscription] Error importing ItemProperty or creating instances: ${error}`)
          }
        }

        // Update context with latest version info
        this._service.send({
          type: 'updateContext',
          latestVersionLocalId: currentVersionLocalId,
          latestVersionUid: seedRecord.latestVersionUid,
        })

        // Only set up liveQuery subscription in browser environment
        if (isBrowser) {
          // Set up liveQuery to watch seeds table
          // Use proper SQL parameter binding - ensure values are strings, not objects
          const resolvedSeedUid = seedUid || null
          const resolvedSeedLocalId = seedLocalId || null
          
          const seeds$ = BaseDb.liveQuery<{ localId: string; uid: string | null; schemaUid: string | null }>(
            (sql: any) => {
              if (resolvedSeedUid) {
                return sql`
                  SELECT local_id as localId, uid, schema_uid as schemaUid
                  FROM seeds
                  WHERE uid = ${resolvedSeedUid}
                `
              } else if (resolvedSeedLocalId) {
                return sql`
                  SELECT local_id as localId, uid, schema_uid as schemaUid
                  FROM seeds
                  WHERE local_id = ${resolvedSeedLocalId}
                `
              } else {
                // Fallback - should not happen, but handle gracefully
                return sql`
                  SELECT local_id as localId, uid, schema_uid as schemaUid
                  FROM seeds
                  WHERE 1 = 0
                `
              }
            }
          )

          // Set up liveQuery to watch versions table for this seed
          const versions$ = BaseDb.liveQuery<{ localId: string; uid: string | null; seedLocalId: string }>(
            (sql: any) => sql`
              SELECT local_id as localId, uid, seed_local_id as seedLocalId
              FROM versions
              WHERE seed_local_id = ${seedLocalId}
              ORDER BY COALESCE(attestation_created_at, created_at) DESC
            `
          )

          const instanceState = itemInstanceState.get(this)
          if (!instanceState) {
            logger('[Item._setupLiveQuerySubscription] Instance state not found')
            return
          }

          // Subscribe to seeds updates
          const seedsSubscription = seeds$.subscribe({
            next: async (seedRows) => {
              if (seedRows.length === 0) return
              
              const seedRow = seedRows[0]
              logger(`[Item._setupLiveQuerySubscription] Seed updated in database`)
              
              // Update context with seed data
              this._service.send({
                type: 'updateContext',
                seedLocalId: seedRow.localId,
                seedUid: seedRow.uid || undefined,
                schemaUid: seedRow.schemaUid || undefined,
              })
            },
            error: (error) => {
              logger(`[Item._setupLiveQuerySubscription] Seeds liveQuery error: ${error}`)
            },
          })

          // Subscribe to versions updates
          const versionsSubscription = versions$.subscribe({
            next: async (versionRows) => {
              if (versionRows.length === 0) return
              
              // Get the most recent version
              const latestVersion = versionRows[0]
              const latestVersionLocalId = latestVersion.localId
              
              logger(`[Item._setupLiveQuerySubscription] Versions updated, latest version: ${latestVersionLocalId}`)
              
              // Query metadata for the latest version
              const metadataRows = await db
                .select()
                .from(metadata)
                .where(
                  and(
                    eq(metadata.seedLocalId, seedLocalId),
                    eq(metadata.versionLocalId, latestVersionLocalId)
                  )
                )

              // CRITICAL: Create ItemProperty instances BEFORE updating context
              if (metadataRows.length > 0) {
                try {
                  const itemPropertyMod = await import('../ItemProperty/ItemProperty')
                  const { ItemProperty } = itemPropertyMod
                  const itemModelName = this._service.getSnapshot().context.modelName
                  const createPromises = metadataRows.map(async (metaRow: any) => {
                    try {
                      const property = await ItemProperty.find({
                        propertyName: metaRow.propertyName,
                        seedLocalId,
                        seedUid,
                        modelName: itemModelName,
                      })
                      if (property) {
                        // Add property instance to context
                        this._service.send({
                          type: 'addPropertyInstance',
                          propertyName: metaRow.propertyName,
                          propertyInstance: property,
                        })
                        logger(`[Item._setupLiveQuerySubscription] Created/cached ItemProperty instance for propertyName "${metaRow.propertyName}" from liveQuery`)
                      }
                    } catch (error) {
                      logger(`[Item._setupLiveQuerySubscription] Error creating ItemProperty instance: ${error}`)
                    }
                  })
                  await Promise.all(createPromises)
                } catch (error) {
                  logger(`[Item._setupLiveQuerySubscription] Error importing ItemProperty or creating instances from liveQuery: ${error}`)
                }
              }
              
              // Update context with latest version info
              this._service.send({
                type: 'updateContext',
                latestVersionLocalId,
                latestVersionUid: latestVersion.uid || undefined,
              })
            },
            error: (error) => {
              logger(`[Item._setupLiveQuerySubscription] Versions liveQuery error: ${error}`)
            },
          })

          // Store combined subscription
          instanceState.liveQuerySubscription = {
            unsubscribe: () => {
              seedsSubscription.unsubscribe()
              versionsSubscription.unsubscribe()
            }
          }
          
          logger(`[Item._setupLiveQuerySubscription] LiveQuery subscription set up for seedLocalId: ${seedLocalId}`)
        } else {
          logger(`[Item._setupLiveQuerySubscription] Skipping liveQuery subscription in Node.js environment`)
        }
      } catch (error) {
        logger(`[Item._setupLiveQuerySubscription] Error setting up subscription: ${error}`)
        setupState.subscriptionSetUp = false // Reset on error so we can retry
      }
    }

    // Set up liveQuery subscription as soon as we have seedLocalId
    const setupSubscription = this._service.subscribe(async (snapshot: SnapshotFrom<typeof itemMachineSingle>) => {
      const seedLocalId = snapshot.context.seedLocalId
      const seedUid = snapshot.context.seedUid
      
      if (!seedLocalId && !seedUid) {
        return // Need seed ID to proceed
      }

      // Once we have seed ID, set up the liveQuery subscription (only once)
      if ((seedLocalId || seedUid) && !setupState.subscriptionSetUp) {
        await setupLiveQuery(seedLocalId || '', seedUid)
        if (setupState.subscriptionSetUp) {
          setupSubscription.unsubscribe()
        }
      }
    })
    
    // Also check current state immediately in case seedLocalId is already available
    const currentSnapshot = this._service.getSnapshot() as SnapshotFrom<typeof itemMachineSingle>
    if ((currentSnapshot.context.seedLocalId || currentSnapshot.context.seedUid) && !setupState.subscriptionSetUp) {
      setupLiveQuery(currentSnapshot.context.seedLocalId || '', currentSnapshot.context.seedUid || undefined).catch((error) => {
        logger(`[Item._setupLiveQuerySubscription] Error in immediate setup: ${error}`)
      })
    }
  }

  unload(): void {
    try {
      const context = this._getSnapshotContext()
      const cacheKey = context.seedUid || context.seedLocalId
      const cacheKeys: string[] = []
      
      if (cacheKey) {
        cacheKeys.push(cacheKey)
      }
      
      unloadEntity(this, {
        getCacheKeys: () => cacheKeys,
        caches: [Item.instanceCache],
        instanceState: itemInstanceState,
        getService: (instance) => instance._service,
        onUnload: (instance) => {
          // Clean up additional subscription
          instance._subscription?.unsubscribe()
        },
      })
    } catch (error) {
      // Still try to clean up what we can
      const instanceState = itemInstanceState.get(this)
      if (instanceState?.liveQuerySubscription) {
        instanceState.liveQuerySubscription.unsubscribe()
        instanceState.liveQuerySubscription = null
      }
      this._subscription?.unsubscribe()
      try {
        this._service.stop()
      } catch {
        // Service might already be stopped
      }
    }
  }

  /**
   * Destroy the item: soft delete in DB, remove from caches, clean up subscriptions, stop service.
   */
  async destroy(): Promise<void> {
    const context = this._getSnapshotContext()
    const cacheKey = context.seedUid || context.seedLocalId
    const cacheKeys: string[] = cacheKey ? [cacheKey] : []

    clearDestroySubscriptions(this, {
      instanceState: itemInstanceState,
      onUnload: (instance) => (instance as Item<any>)._subscription?.unsubscribe(),
    })

    forceRemoveFromCaches(this, {
      getCacheKeys: () => cacheKeys,
      caches: [Item.instanceCache as Map<string, unknown>],
    })

    await runDestroyLifecycle(this, {
      getService: (instance) =>
        instance._service as { send: (ev: unknown) => void; stop: () => void },
      doDestroy: async () => {
        await deleteItem({
          seedLocalId: context.seedLocalId,
          seedUid: context.seedUid,
        })
      },
    })
  }
}