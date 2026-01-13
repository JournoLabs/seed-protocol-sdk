import { ActorRefFrom, createActor, SnapshotFrom, Subscription, waitFor } from 'xstate'
import { BehaviorSubject, Subscriber } from 'rxjs'
import { Static } from '@sinclair/typebox'
import { IItemProperty } from '@/interfaces/IItemProperty'
import { immerable } from 'immer'
import { CreatePropertyInstanceProps, PropertyMachineContext } from '@/types'
// Dynamic import to break circular dependency: Model -> BaseItem -> BaseItemProperty -> Model
// import { Model } from '@/Model/Model'
import { propertyMachine } from './service/propertyMachine'
import { INTERNAL_PROPERTY_NAMES } from '@/helpers/constants'
import debug from 'debug'
import pluralize from 'pluralize'
import { getPropertyData } from '@/db/read/getPropertyData'
import { BaseFileManager, getCorrectId } from '@/helpers'
// Dynamic import to break circular dependency: schema/index -> ... -> BaseItemProperty -> schema/index
// Note: TProperty is used as a type, so we can import it separately. ModelPropertyDataTypes is used at runtime.
import type { TProperty } from '@/Schema'
import { eventEmitter } from '@/eventBus'
import { getSchemaUidForModel } from '@/db/read/getSchemaUidForModel'

// Lazy import helper to break circular dependency for synchronous Model access
// Since Model.getByName() is synchronous and Model imports BaseItemProperty (via BaseItem),
// Model is already initialized when BaseItemProperty constructor runs
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
    // Model should already be loaded because Model imports BaseItem, which imports BaseItemProperty
    // If it's not loaded, this indicates a timing issue
    throw new Error('Model class not available. This may indicate a circular dependency or timing issue.')
  }
  return ModelClass
}

const logger = debug('seedSdk:property:class')

type ItemPropertyService = ActorRefFrom<typeof propertyMachine>
type ItemPropertySnapshot = SnapshotFrom<typeof propertyMachine>

type ItemPropertyFindProps = {
  propertyName: string
  propertyLocalId?: string
  seedLocalId?: string
  seedUid?: string
}

export abstract class BaseItemProperty<PropertyType> implements IItemProperty<PropertyType> {
  protected static instanceCache: Map<
    string,
    { instance: BaseItemProperty<any>; refCount: number }
  > = new Map()
  protected readonly _service: ItemPropertyService
  protected _subject: BehaviorSubject<any>
  protected readonly _isRelation: boolean = false
  protected readonly _isList: boolean = false
  protected readonly _alias: string | undefined
  protected _subscription: Subscription
  protected _dataType: string | undefined
  protected _schemaUid: string | undefined
  [immerable] = true

  constructor(initialValues: Partial<CreatePropertyInstanceProps>) {
    const { modelName, propertyName, propertyValue, seedLocalId, seedUid, versionLocalId, versionUid, storageTransactionId, schemaUid } = initialValues

    if (!modelName) {
      throw new Error('Model name is required')
    }

    // Try to get model from cache (synchronous lookup)
    const Model = getModel()
    const model = Model.getByName(modelName)

    if (!model) {
      throw new Error(`Model ${modelName} not found`)
    }

    if (!propertyName) {
      throw new Error(`Property name not provided`)
    }

    const serviceInput: Partial<PropertyMachineContext> = {
      propertyValue,
      propertyName,
      seedLocalId,
      seedUid,
      versionLocalId,
      versionUid,
      modelName,
      storageTransactionId,
      propertyRecordSchema: model?.properties ? (() => {
        const prop = model.properties.find(p => p.name === propertyName)
        if (!prop) return undefined
        const propContext = prop._getSnapshotContext()
        return {
          dataType: propContext.dataType,
          ref: propContext.refModelName || propContext.ref,
          refValueType: propContext.refValueType,
          storageType: propContext.storageType,
          localStorageDir: propContext.localStorageDir,
          filenameSuffix: propContext.filenameSuffix,
        }
      })() : undefined,
      schemaUid,
      isSaving: false,
      isRelation: false,
      isDbReady: false,
    }



    if (!INTERNAL_PROPERTY_NAMES.includes(propertyName)) {
      let propertyNameWithoutId

      if (propertyName.endsWith('Id')) {
        propertyNameWithoutId = propertyName.slice(0, -2)
      }

      if (propertyName.endsWith('Ids')) {
        propertyNameWithoutId = propertyName.slice(0, -3)
        propertyNameWithoutId = pluralize(propertyNameWithoutId)
      }

      const propertyRecordSchema = model?.properties ? (() => {
        const propName = propertyNameWithoutId || propertyName
        const prop = model.properties.find(p => p.name === propName)
        if (!prop) return undefined
        const propContext = prop._getSnapshotContext()
        return {
          dataType: propContext.dataType,
          ref: propContext.refModelName || propContext.ref,
          refValueType: propContext.refValueType,
          storageType: propContext.storageType,
          localStorageDir: propContext.localStorageDir,
          filenameSuffix: propContext.filenameSuffix,
        }
      })() : undefined
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

        if (!this._alias && propertyNameWithoutId) {
          this._alias = propertyNameWithoutId
        }
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
          const cacheKey = BaseItemProperty.cacheKey(
            context.seedLocalId,
            context.propertyName,
          )
          if (!BaseItemProperty.instanceCache.has(cacheKey)) {
            BaseItemProperty.instanceCache.set(cacheKey, {
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

        if (this._subject.value === renderValue) {
          return
        }

        this._subject.next(renderValue)
        // TODO: Maybe have this only update the property?
        // if (context.seedLocalId || context.seedUid) {
        //   eventEmitter.emit(`property.${context.seedUid || context.seedLocalId}.${propertyName}.update`)
        // }
        // if (context.seedUid) {
        //   eventEmitter.emit(`item.${modelName}.${context.seedUid}.update`)
        // }
      },
    )

    this._service.start()
  }

  static PlatformClass: typeof BaseItemProperty

  static setPlatformClass(platformClass: typeof BaseItemProperty) {
    this.PlatformClass = platformClass
  }

  static create(
    props: Partial<CreatePropertyInstanceProps>,
  ): BaseItemProperty<any> | undefined {
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
        if (!this.PlatformClass) {
          throw new Error('PlatformClass not set. Call setPlatformClass() first.')
        }
        const newInstance = new this.PlatformClass(props)
        this.instanceCache.set(cacheKey, {
          instance: newInstance,
          refCount: 1,
        })
        return newInstance
      }
    }
    if (seedUid && propertyName) {
      if (this.instanceCache.has(cacheKey)) {
        const { instance, refCount } = this.instanceCache.get(cacheKey)!
        this.instanceCache.set(cacheKey, { instance, refCount: refCount + 1 })
        return instance
      }
      if (!this.instanceCache.has(cacheKey)) {
        if (!this.PlatformClass) {
          throw new Error('PlatformClass not set. Call setPlatformClass() first.')
        }
        const newInstance = new this.PlatformClass(props)
        this.instanceCache.set(cacheKey, { instance: newInstance, refCount: 1 })
        return newInstance
      }
    }
    if (!this.PlatformClass) {
      throw new Error('PlatformClass not set. Call setPlatformClass() first.')
    }
    return new this.PlatformClass(props)
  }

  static async find({
    propertyName,
    seedLocalId,
    seedUid,
  }: ItemPropertyFindProps): Promise<IItemProperty<any> | undefined> {
    if ((!seedLocalId && !seedUid) || !propertyName) {
      return
    }
    const cacheKeyId = seedUid || seedLocalId
    const cacheKey = BaseItemProperty.cacheKey(cacheKeyId!, propertyName)
    if (this.instanceCache.has(cacheKey)) {
      const { instance, refCount } = this.instanceCache.get(cacheKey)!
      this.instanceCache.set(cacheKey, {
        instance,
        refCount: refCount + 1,
      })
      return instance
    }
    const propertyData = await getPropertyData({
      propertyName,
      seedLocalId,
      seedUid,
    })
    if (!propertyData) {
      return
    }
    return BaseItemProperty.create(propertyData)
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
    // logger(
    //   `[XXXXXXXXXX] [value] [get] subjectValue: ${this._subject.value} serviceValue: ${this._service.getSnapshot().context.renderValue}`,
    // )
    // Use string literal to avoid circular dependency
    if (this._dataType === 'Image') {
      return this._getSnapshot().context.refResolvedValue
    }
    return this._subject.value
  }

  set value(value: any) {
    if (this._subject.value === value) {
      return
    }
    const context = this._service.getSnapshot().context
    if (!context.propertyRecordSchema) {
      this._subject.next(value)
    }
    this._service.send({
      type: 'save',
      newValue: value,
    })
  }

  get published(): boolean {
    return !!this._getSnapshot().context.uid
  }

  subscribe(callback: Partial<Subscriber<any>>) {
    return this._subject.subscribe(callback)
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
    this._service.stop()
  }
} 