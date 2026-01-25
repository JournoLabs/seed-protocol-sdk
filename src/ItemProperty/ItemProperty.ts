import { ActorRefFrom, createActor, SnapshotFrom, Subscription, waitFor } from 'xstate'
import { BehaviorSubject, Subscriber } from 'rxjs'
import { Static } from '@sinclair/typebox'
import { IItemProperty } from '@/interfaces/IItemProperty'
import { CreatePropertyInstanceProps, PropertyMachineContext } from '@/types'
// Dynamic import to break circular dependency: Model -> Item -> ItemProperty -> Model
// import { Model } from '@/Model/Model'
import { propertyMachine } from './service/propertyMachine'
import { INTERNAL_PROPERTY_NAMES } from '@/helpers/constants'
import debug from 'debug'
import pluralize from 'pluralize'
import { getPropertyData } from '@/db/read/getPropertyData'
import { BaseFileManager, getCorrectId } from '@/helpers'
import { waitForEntityIdle } from '@/helpers/waitForEntityIdle'
import { findEntity } from '@/helpers/entity/entityFind'
import { setupEntityLiveQuery } from '@/helpers/entity/entityLiveQuery'
import { unloadEntity } from '@/helpers/entity/entityUnload'
// Dynamic import to break circular dependency: schema/index -> ... -> ItemProperty -> schema/index
// Note: TProperty is used as a type, so we can import it separately. ModelPropertyDataTypes is used at runtime.
import type { TProperty } from '@/Schema'
import { createReactiveProxy } from '@/helpers/reactiveProxy'

// Lazy import helper to break circular dependency for synchronous Model access
// Since Model.getByName() is synchronous and Model imports ItemProperty (via Item),
// Model is already initialized when ItemProperty constructor runs
let ModelClass: typeof import('@/Model/Model').Model | null = null
let modelImportPromise: Promise<typeof import('@/Model/Model')> | null = null

// Start loading Model at module load time (non-blocking)
modelImportPromise = import('@/Model/Model').then(module => {
  ModelClass = module.Model
  return module
}).catch(() => {
  // If import fails, ModelClass remains null
})

const getModel = (): typeof import('@/Model/Model').Model => {
  if (!ModelClass) {
    // Model should already be loaded because Model imports Item, which imports ItemProperty
    // If it's not loaded, this indicates a timing issue
    throw new Error('Model class not available. This may indicate a circular dependency or timing issue.')
  }
  return ModelClass
}

const logger = debug('seedSdk:property:class')

type ItemPropertyService = ActorRefFrom<typeof propertyMachine>
type ItemPropertySnapshot = SnapshotFrom<typeof propertyMachine>

// Define tracked properties for the Proxy
// These properties will be read from/written to the actor context
const TRACKED_PROPERTIES = [
  'propertyName',
  'propertyValue',
  'renderValue',
  'seedLocalId',
  'seedUid',
  'modelName',
  'dataType',
  'refResolvedValue',
  'versionLocalId',
  'versionUid',
  'schemaUid',
  'localId',
  'uid',
] as const

// WeakMap to store mutable state per ItemProperty instance
// This avoids issues with read-only properties when instances are frozen by Immer
const itemPropertyInstanceState = new WeakMap<ItemProperty<any>, {
  liveQuerySubscription: { unsubscribe: () => void } | null // LiveQuery subscription for cross-instance updates
}>()

type ItemPropertyFindProps = {
  propertyName: string
  propertyLocalId?: string
  seedLocalId?: string
  seedUid?: string
}

export class ItemProperty<PropertyType> implements IItemProperty<PropertyType> {
  protected static instanceCache: Map<
    string,
    { instance: ItemProperty<any>; refCount: number }
  > = new Map()
  protected readonly _service: ItemPropertyService
  protected _subject: BehaviorSubject<any>
  protected readonly _isRelation: boolean = false
  protected readonly _isList: boolean = false
  protected readonly _alias: string | undefined
  protected _subscription: Subscription
  protected _dataType: string | undefined
  protected _schemaUid: string | undefined

  constructor(initialValues: Partial<CreatePropertyInstanceProps>) {
    const { modelName, propertyName, propertyValue, seedLocalId, seedUid, versionLocalId, versionUid, storageTransactionId, schemaUid } = initialValues

    if (!modelName) {
      throw new Error('Model name is required')
    }

    if (!propertyName) {
      throw new Error(`Property name not provided`)
    }

    // ItemProperty no longer depends on Model - property schema will be loaded from database
    // via loadOrCreateProperty actor or can be provided in initialValues
    const serviceInput: Partial<PropertyMachineContext> = {
      propertyValue,
      propertyName,
      seedLocalId,
      seedUid,
      versionLocalId,
      versionUid,
      modelName,
      storageTransactionId,
      // propertyRecordSchema will be loaded from database via loadOrCreateProperty actor
      // or can be provided in initialValues if available
      propertyRecordSchema: (initialValues as any).propertyRecordSchema,
      schemaUid,
      isSaving: false,
      isRelation: false,
      isDbReady: false,
    }



    // Property schema will be loaded from database via loadOrCreateProperty actor
    // For now, use propertyRecordSchema from initialValues if provided
    const propertyRecordSchema = (initialValues as any).propertyRecordSchema
    if (propertyRecordSchema) {
      this._dataType = propertyRecordSchema.dataType

      serviceInput.propertyRecordSchema = propertyRecordSchema

      // Use string literals to avoid circular dependency in constructor
      // ModelPropertyDataTypes values are stable string constants
      if (propertyRecordSchema.dataType === 'Relation') {
        this._isRelation = true
      }

      if (
        propertyRecordSchema.dataType === 'List' &&
        propertyRecordSchema.ref
      ) {
        this._isList = true
        this._isRelation = true

        if (propertyValue) {
          try {
            serviceInput.propertyValue = JSON.parse(propertyValue)
          } catch (e) {
            logger('List property value is not JSON', e)
          }
        }

        const propertyNameSingular = pluralize(propertyName!, 1)

        this._alias = propertyName

        serviceInput.propertyName = `${propertyNameSingular}${propertyRecordSchema.ref}Ids`
      }

      if (!this._alias && propertyName.endsWith('Id')) {
        this._alias = propertyName.slice(0, -2)
      } else if (!this._alias && propertyName.endsWith('Ids')) {
        this._alias = pluralize(propertyName.slice(0, -3))
      }
    }

    serviceInput.isRelation = this._isRelation

    this._subject = new BehaviorSubject(propertyValue)
    this._service = createActor(propertyMachine, {
      input: serviceInput as PropertyMachineContext,
    })

    this._subscription = this._service.subscribe(
      async (snapshot: ItemPropertySnapshot) => {
        if (!snapshot || !snapshot.context) {
          return
        }

        // Use dynamic import to break circular dependency
        const { ModelPropertyDataTypes } = await import('@/Schema')

        const { context } = snapshot
        const { propertyRecordSchema } = context

        if (context.seedLocalId && context.propertyName) {
          const cacheKey = ItemProperty.cacheKey(
            context.seedLocalId,
            context.propertyName,
          )
          if (!ItemProperty.instanceCache.has(cacheKey)) {
            ItemProperty.instanceCache.set(cacheKey, {
              instance: this,
              refCount: 1,
            })
          }
        }

        let renderValue

        const isImage =
          propertyRecordSchema &&
          propertyRecordSchema.dataType === ModelPropertyDataTypes.Image

        const isFile =
          propertyRecordSchema &&
          propertyRecordSchema.dataType === ModelPropertyDataTypes.File

        const isItemStorage = 
          propertyRecordSchema &&
          propertyRecordSchema.storageType &&
          propertyRecordSchema.storageType === 'ItemStorage' &&
          context.refResolvedValue &&
          context.localStorageDir

        if (!this._schemaUid && context.schemaUid) {
          this._schemaUid = context.schemaUid
        }

        if (
          isImage ||
          isFile ||
          isItemStorage
        ) {
          const filePath = `/files/${context.localStorageDir}/${context.refResolvedValue}`
          try {
            const exists = await BaseFileManager.pathExists(filePath)
            if (exists && isItemStorage) {
              renderValue = await BaseFileManager.readFileAsString(filePath,)
            }
            if (exists && isImage) {
              if (context.refResolvedDisplayValue) {
                renderValue = context.refResolvedDisplayValue
              } 
              if (!context.refResolvedDisplayValue) {
                renderValue = await BaseFileManager.getContentUrlFromPath(filePath)
              }
            }
            if (exists && isFile) {
              renderValue = await BaseFileManager.readFileAsString(filePath,)
            }
            if (!exists) {
              renderValue = 'No file found'
            }
          } catch (e) {
            logger(
              `[ItemProperty] [${context.seedLocalId}] [${context.propertyName}] [storageType] error`,
              e,
            )
            renderValue = 'No file found'
          }
        }

        if (!renderValue) {
          renderValue = context.renderValue || context.propertyValue
        }

        let transformedPropertyName = propertyName

        const skipTransform =
          INTERNAL_PROPERTY_NAMES.includes(propertyName) || !!this._alias

        if (!skipTransform && transformedPropertyName.endsWith('Id')) {
          transformedPropertyName = transformedPropertyName.slice(0, -2)
        }

        if (!skipTransform && transformedPropertyName.endsWith('Ids')) {
          transformedPropertyName = transformedPropertyName.slice(0, -3)
        }

        if (skipTransform && this._alias) {
          transformedPropertyName = this._alias
        }

        if (skipTransform && !this._alias) {
        }

        // Update context with renderValue instead of BehaviorSubject
        // The reactive proxy will handle reactivity
        const currentRenderValue = context.renderValue || context.propertyValue
        if (currentRenderValue === renderValue) {
          return
        }

        // Update context with new renderValue
        this._service.send({
          type: 'updateContext',
          renderValue,
        })
      },
    )

    this._service.start()

    // Initialize instance state in WeakMap
    itemPropertyInstanceState.set(this, {
      liveQuerySubscription: null,
    })
    
    // Set up liveQuery subscription for cross-instance updates
    this._setupLiveQuerySubscription()
  }

  /**
   * Set up liveQuery subscription to watch for metadata changes in the database
   * This enables cross-instance synchronization (e.g., changes in other tabs/windows)
   */
  private _setupLiveQuerySubscription(): void {
    const isBrowser = typeof window !== 'undefined'
    const logger = debug('seedSdk:itemProperty:liveQuery')
    
    // Use a closure variable to track setup state per instance
    const setupState = { subscriptionSetUp: false }

    const setupLiveQuery = async (seedLocalId: string, seedUid: string | undefined, propertyName: string, versionLocalId: string | undefined) => {
      if (setupState.subscriptionSetUp) {
        return
      }

      if (!seedLocalId && !seedUid) {
        logger('[ItemProperty._setupLiveQuerySubscription] No seedLocalId or seedUid')
        return
      }

      if (!propertyName) {
        logger('[ItemProperty._setupLiveQuerySubscription] No propertyName')
        return
      }

      setupState.subscriptionSetUp = true
      logger(`[ItemProperty._setupLiveQuerySubscription] Setting up liveQuery for propertyName: ${propertyName}, seedLocalId: ${seedLocalId}`)
      
      try {
        const { BaseDb } = await import('@/db/Db/BaseDb')
        const { metadata } = await import('@/seedSchema')
        const { eq, and, isNotNull } = await import('drizzle-orm')
        const { getMetadataLatest } = await import('@/db/read/subqueries/metadataLatest')
        
        const db = BaseDb.getAppDb()
        if (!db) {
          logger('[ItemProperty._setupLiveQuerySubscription] Database not available')
          return
        }

        // Query initial metadata using getMetadataLatest subquery pattern
        const metadataLatest = getMetadataLatest({ seedLocalId, seedUid })
        const initialMetadata = await db
          .with(metadataLatest)
          .select()
          .from(metadataLatest)
          .where(
            and(
              eq(metadataLatest.propertyName, propertyName),
              eq(metadataLatest.rowNum, 1)
            )
          )
          .limit(1)

        if (initialMetadata.length > 0) {
          const metaRow = initialMetadata[0]
          logger(`[ItemProperty._setupLiveQuerySubscription] Initial query returned metadata record`)
          
          // Update context with initial metadata
          this._service.send({
            type: 'updateContext',
            propertyValue: metaRow.propertyValue,
            renderValue: metaRow.propertyValue,
            localId: metaRow.localId || undefined,
            uid: metaRow.uid || undefined,
            versionLocalId: metaRow.versionLocalId || undefined,
            versionUid: metaRow.versionUid || undefined,
            schemaUid: metaRow.schemaUid || undefined,
          })
        }

        // Only set up liveQuery subscription in browser environment
        if (isBrowser) {
          // Set up liveQuery to watch metadata table for this property
          // Use proper SQL parameter binding - ensure values are strings, not objects
          const resolvedSeedUid = seedUid || null
          const resolvedSeedLocalId = seedLocalId || null
          
          const metadata$ = BaseDb.liveQuery<{ localId: string | null; uid: string | null; propertyName: string; propertyValue: string; versionLocalId: string | null; versionUid: string | null; schemaUid: string | null }>(
            (sql: any) => {
              if (resolvedSeedUid) {
                return sql`
                  SELECT local_id as localId, uid, property_name as propertyName, property_value as propertyValue, 
                         version_local_id as versionLocalId, version_uid as versionUid, schema_uid as schemaUid
                  FROM metadata
                  WHERE seed_uid = ${resolvedSeedUid}
                    AND property_name = ${propertyName}
                    AND property_name IS NOT NULL
                  ORDER BY COALESCE(created_at, attestation_created_at) DESC
                  LIMIT 1
                `
              } else if (resolvedSeedLocalId) {
                return sql`
                  SELECT local_id as localId, uid, property_name as propertyName, property_value as propertyValue, 
                         version_local_id as versionLocalId, version_uid as versionUid, schema_uid as schemaUid
                  FROM metadata
                  WHERE seed_local_id = ${resolvedSeedLocalId}
                    AND property_name = ${propertyName}
                    AND property_name IS NOT NULL
                  ORDER BY COALESCE(created_at, attestation_created_at) DESC
                  LIMIT 1
                `
              } else {
                // Fallback - should not happen, but handle gracefully
                return sql`
                  SELECT local_id as localId, uid, property_name as propertyName, property_value as propertyValue, 
                         version_local_id as versionLocalId, version_uid as versionUid, schema_uid as schemaUid
                  FROM metadata
                  WHERE 1 = 0
                `
              }
            }
          )

          const instanceState = itemPropertyInstanceState.get(this)
          if (!instanceState) {
            logger('[ItemProperty._setupLiveQuerySubscription] Instance state not found')
            return
          }

          // Subscribe to liveQuery updates
          const subscription = metadata$.subscribe({
            next: async (metadataRows) => {
              if (metadataRows.length === 0) return
              
              const metaRow = metadataRows[0]
              logger(`[ItemProperty._setupLiveQuerySubscription] Metadata updated in database for propertyName: ${propertyName}`)
              
              // Update context with metadata changes
              this._service.send({
                type: 'updateContext',
                propertyValue: metaRow.propertyValue,
                renderValue: metaRow.propertyValue,
                localId: metaRow.localId || undefined,
                uid: metaRow.uid || undefined,
                versionLocalId: metaRow.versionLocalId || undefined,
                versionUid: metaRow.versionUid || undefined,
                schemaUid: metaRow.schemaUid || undefined,
              })
            },
            error: (error) => {
              logger(`[ItemProperty._setupLiveQuerySubscription] LiveQuery error: ${error}`)
            },
          })

          instanceState.liveQuerySubscription = subscription
          logger(`[ItemProperty._setupLiveQuerySubscription] LiveQuery subscription set up for propertyName: ${propertyName}`)
        } else {
          logger(`[ItemProperty._setupLiveQuerySubscription] Skipping liveQuery subscription in Node.js environment`)
        }
      } catch (error) {
        logger(`[ItemProperty._setupLiveQuerySubscription] Error setting up subscription: ${error}`)
        setupState.subscriptionSetUp = false // Reset on error so we can retry
      }
    }

    // Set up liveQuery subscription as soon as we have required context
    const setupSubscription = this._service.subscribe(async (snapshot) => {
      const seedLocalId = snapshot.context.seedLocalId
      const seedUid = snapshot.context.seedUid
      const propertyName = snapshot.context.propertyName
      const versionLocalId = snapshot.context.versionLocalId
      
      if ((!seedLocalId && !seedUid) || !propertyName) {
        return // Need seed ID and propertyName to proceed
      }

      // Once we have required context, set up the liveQuery subscription (only once)
      if ((seedLocalId || seedUid) && propertyName && !setupState.subscriptionSetUp) {
        await setupLiveQuery(seedLocalId || '', seedUid, propertyName, versionLocalId)
        if (setupState.subscriptionSetUp) {
          setupSubscription.unsubscribe()
        }
      }
    })
    
    // Also check current state immediately in case context is already available
    const currentSnapshot = this._service.getSnapshot()
    const seedLocalId = currentSnapshot.context.seedLocalId
    const seedUid = currentSnapshot.context.seedUid
    const propertyName = currentSnapshot.context.propertyName
    const versionLocalId = currentSnapshot.context.versionLocalId
    
    if ((seedLocalId || seedUid) && propertyName && !setupState.subscriptionSetUp) {
      setupLiveQuery(seedLocalId || '', seedUid, propertyName, versionLocalId).catch((error) => {
        logger(`[ItemProperty._setupLiveQuerySubscription] Error in immediate setup: ${error}`)
      })
    }
  }

  static create(
    props: Partial<CreatePropertyInstanceProps>,
  ): ItemProperty<any> | undefined {
    const { propertyName, seedLocalId, seedUid, versionLocalId, versionUid } =
      props
    if (!propertyName || (!seedLocalId && !seedUid)) {
      return
    }
    const cacheKey = this.cacheKey(
      (seedUid || seedLocalId) as string,
      propertyName,
    )
    if (seedLocalId && propertyName) {
      if (this.instanceCache.has(cacheKey)) {
        const { instance, refCount } = this.instanceCache.get(cacheKey)!
        this.instanceCache.set(cacheKey, {
          instance,
          refCount: refCount + 1,
        })
        return instance
      }
      if (!this.instanceCache.has(cacheKey)) {
        const newInstance = new ItemProperty(props)
        
        // Wrap instance in Proxy for reactive property access
        const proxiedInstance = createReactiveProxy<ItemProperty<any>>({
          instance: newInstance,
          service: newInstance._service,
          trackedProperties: TRACKED_PROPERTIES,
          getContext: (instance) => {
            return instance._getSnapshotContext()
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
        return proxiedInstance
      }
    }
    if (seedUid && propertyName) {
      if (this.instanceCache.has(cacheKey)) {
        const { instance, refCount } = this.instanceCache.get(cacheKey)!
        this.instanceCache.set(cacheKey, { instance, refCount: refCount + 1 })
        return instance
      }
      if (!this.instanceCache.has(cacheKey)) {
        const newInstance = new ItemProperty(props)
        
        // Wrap instance in Proxy for reactive property access
        const proxiedInstance = createReactiveProxy<ItemProperty<any>>({
          instance: newInstance,
          service: newInstance._service,
          trackedProperties: TRACKED_PROPERTIES,
          getContext: (instance) => {
            return instance._getSnapshotContext()
          },
          sendUpdate: (instance, prop: string, value: any) => {
            instance._service.send({
              type: 'updateContext',
              [prop]: value,
            })
          },
        })
        
        this.instanceCache.set(cacheKey, { instance: proxiedInstance, refCount: 1 })
        return proxiedInstance
      }
    }
    const newInstance = new ItemProperty(props)
    
    // Wrap instance in Proxy for reactive property access
    return createReactiveProxy<ItemProperty<any>>({
      instance: newInstance,
      service: newInstance._service,
      trackedProperties: TRACKED_PROPERTIES,
      getContext: (instance) => {
        return instance._getSnapshotContext()
      },
      sendUpdate: (instance, prop: string, value: any) => {
        instance._service.send({
          type: 'updateContext',
          [prop]: value,
        })
      },
    })
  }

  static async find({
    propertyName,
    seedLocalId,
    seedUid,
    waitForReady = true,
    readyTimeout = 5000,
  }: ItemPropertyFindProps & {
    waitForReady?: boolean
    readyTimeout?: number
  }): Promise<IItemProperty<any> | undefined> {
    if ((!seedLocalId && !seedUid) || !propertyName) {
      return undefined
    }
    
    const cacheKeyId = seedUid || seedLocalId
    const cacheKey = ItemProperty.cacheKey(cacheKeyId!, propertyName)
    let foundProperty: IItemProperty<any> | undefined
    
    // Check cache first
    if (this.instanceCache.has(cacheKey)) {
      const { instance, refCount } = this.instanceCache.get(cacheKey)!
      this.instanceCache.set(cacheKey, {
        instance,
        refCount: refCount + 1,
      })
      foundProperty = instance
    } else {
      // Query database
      const propertyData = await getPropertyData({
        propertyName,
        seedLocalId,
        seedUid,
      })
      if (!propertyData) {
        return undefined
      }
      foundProperty = await ItemProperty.create(propertyData)
    }

    if (!foundProperty) {
      return undefined
    }

    if (waitForReady) {
      await waitForEntityIdle(foundProperty, { timeout: readyTimeout })
    }

    return foundProperty
  }

  static cacheKey(seedLocalIdOrUid: string, propertyName: string): string {
    const { uid, localId } = getCorrectId(seedLocalIdOrUid)
    return `Item_${uid || localId}_${propertyName}`
  }

  getService() {
    return this._service
  }

  private _getSnapshot(): ItemPropertySnapshot {
    return this._service.getSnapshot() as ItemPropertySnapshot
  }

  private _getSnapshotContext(): PropertyMachineContext {
    return this._getSnapshot().context
  }

  get localId() {
    return this._getSnapshotContext().localId ?? ''
  }

  get uid() {
    return this._getSnapshotContext().uid ?? ''
  }

  get seedLocalId() {
    return this._getSnapshotContext().seedLocalId ?? ''
  }

  get seedUid() {
    return this._getSnapshotContext().seedUid ?? ''
  }

  get schemaUid(): string | undefined {
    return this._getSnapshotContext().schemaUid
  }

  get propertyName() {
    if (this._alias) {
      return this._alias
    }
    return this._getSnapshotContext().propertyName
  }

  get modelName() {
    return this._getSnapshotContext().modelName
  }

  get propertyDef(): Static<typeof TProperty> | undefined {
    return this._getSnapshotContext().propertyRecordSchema
  }

  get localStorageDir(): string | void {
    const propertyDef = this.propertyDef
    if (propertyDef && propertyDef.localStorageDir) {
      return this.propertyDef.localStorageDir
    }
    if (this._getSnapshot().context.localStorageDir) {
      return this._getSnapshot().context.localStorageDir
    }
  }

  get refResolvedValue(): string | undefined {
    return this._getSnapshotContext().refResolvedValue
  }

  get localStoragePath(): string | void {
    if (this.localStorageDir) {
      return `/files${this.localStorageDir}/${this.refResolvedValue}`
    }
  }

  get versionLocalId(): string | undefined {
    return this._getSnapshotContext().versionLocalId
  }

  get status() {
    return this._getSnapshot().value
  }

  get alias() {
    return this._alias
  }

  get value() {
    // Use string literal to avoid circular dependency
    const context = this._getSnapshotContext()
    if (this._dataType === 'Image') {
      return context.refResolvedValue
    }
    // Read from context via proxy (renderValue or propertyValue)
    return context.renderValue || context.propertyValue
  }

  set value(value: any) {
    const context = this._getSnapshotContext()
    const currentValue = context.renderValue || context.propertyValue
    if (currentValue === value) {
      return
    }
    // If no propertyRecordSchema, just update context directly
    if (!context.propertyRecordSchema) {
      this._service.send({
        type: 'updateContext',
        propertyValue: value,
        renderValue: value,
      })
    } else {
      // Otherwise trigger save
      this._service.send({
        type: 'save',
        newValue: value,
      })
    }
  }

  get published(): boolean {
    return !!this._getSnapshot().context.uid
  }

  subscribe(callback: Partial<Subscriber<any>>) {
    // Subscribe to service instead of BehaviorSubject for reactivity
    return this._service.subscribe((snapshot) => {
      const context = snapshot.context
      const value = context.renderValue || context.propertyValue
      if (callback.next) {
        callback.next(value)
      }
    })
  }

  async save(): Promise<void> {
    await waitFor(
      this._service,
      (snapshot) => !snapshot.context.isSaving && snapshot.value === 'idle',
      {
        timeout: 10_000,
      },
    )
    // return new Promise((resolve) => {
    //   const saveSub = this._service.subscribe((snapshot) => {
    //     if (!snapshot.context.isSaving) {
    //       saveSub.unsubscribe()
    //       resolve()
    //     }
    //   })
    // })
  }

  unload() {
    try {
      const context = this._getSnapshotContext()
      const cacheKey = ItemProperty.cacheKey(
        context.seedUid || context.seedLocalId || '',
        context.propertyName || ''
      )
      const cacheKeys: string[] = []
      
      if (cacheKey && cacheKey !== 'Item__') {
        cacheKeys.push(cacheKey)
      }
      
      unloadEntity(this, {
        getCacheKeys: () => cacheKeys,
        caches: [ItemProperty.instanceCache],
        instanceState: itemPropertyInstanceState,
        getService: (instance) => instance._service,
        onUnload: (instance) => {
          // Clean up additional subscription
          instance._subscription?.unsubscribe()
        },
      })
    } catch (error) {
      // Still try to clean up what we can
      const instanceState = itemPropertyInstanceState.get(this)
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
}