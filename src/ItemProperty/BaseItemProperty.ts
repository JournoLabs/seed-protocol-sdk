import { ActorRefFrom, createActor, SnapshotFrom, Subscription, waitFor } from 'xstate'
import { BehaviorSubject, Subscriber } from 'rxjs'
import { Static } from '@sinclair/typebox'
import { IItemProperty } from '@/interfaces/IItemProperty'
import { immerable } from 'immer'
import { CreatePropertyInstanceProps, PropertyMachineContext } from '@/types'
import { getModel } from '@/stores/modelClass'
import { propertyMachine } from './service/propertyMachine'
import { internalPropertyNames } from '@/helpers/constants'
import debug from 'debug'
import pluralize from 'pluralize'
import { eventEmitter } from '@/eventBus'
import fs from '@zenfs/core'
import { getPropertyData } from '@/db/read/getPropertyData'
import { getCorrectId } from '@/helpers'
import { TProperty } from '@/schema'

const logger = debug('app:property:class')

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

    const ModelClass = getModel(modelName)

    if (!ModelClass) {
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
      modelName: modelName,
      storageTransactionId,
      propertyRecordSchema: ModelClass.schema[propertyName],
      schemaUid,
    }



    if (!internalPropertyNames.includes(propertyName)) {
      let propertyNameWithoutId

      const propertyRecordSchema =
        ModelClass.schema[propertyNameWithoutId || propertyName]
      if (propertyRecordSchema) {
        this._dataType = propertyRecordSchema.dataType

        serviceInput.propertyRecordSchema = propertyRecordSchema

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
      input: serviceInput,
    })

    this._subscription = this._service.subscribe(
      async (snapshot: ItemPropertySnapshot) => {
        if (!snapshot || !snapshot.context) {
          return
        }

        const { context } = snapshot
        const { propertyRecordSchema } = context

        if (context.seedLocalId) {
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

        if (
          propertyRecordSchema &&
          propertyRecordSchema.storageType &&
          propertyRecordSchema.storageType === 'ItemStorage' &&
          context.refResolvedValue &&
          context.localStorageDir
        ) {
          const filePath = `/files/${context.localStorageDir}/${context.refResolvedValue}`
          try {
            const exists = await fs.promises.exists(filePath)
            if (exists) {
              renderValue = await fs.promises.readFile(filePath, 'utf-8')
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
          internalPropertyNames.includes(propertyName) || !!this._alias

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
        // if (context.seedLocalId) {
        //   eventEmitter.emit(`item.${modelName}.${context.seedLocalId}.update`)
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
        const newInstance = new this(props)
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
        const newInstance = new this(props)
        this.instanceCache.set(cacheKey, { instance: newInstance, refCount: 1 })
        return newInstance
      }
    }
    return new this(props)
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

  get localId() {
    return this._getSnapshot().context.localId
  }

  get uid() {
    return this._getSnapshot().context.uid
  }

  get seedLocalId() {
    return this._getSnapshot().context.seedLocalId
  }

  get seedUid() {
    return this._getSnapshot().context.seedUid
  }

  get schemaUid() {
    return this._getSnapshot().context.schemaUid
  }

  get propertyName() {
    if (this._alias) {
      return this._alias
    }
    return this._getSnapshot().context.propertyName
  }

  get modelName() {
    return this._getSnapshot().context.modelName
  }

  get propertyDef(): Static<typeof TProperty> | undefined {
    return this._getSnapshot().context.propertyRecordSchema
  }

  get localStoragePath(): string | void {
    if (this.propertyDef && this.propertyDef.localStorageDir) {
      return `/files${this.propertyDef.localStorageDir}/${this._getSnapshot().context.refResolvedValue}`
    }
    if (this._getSnapshot().context.localStorageDir) {
      return `/files${this._getSnapshot().context.localStorageDir}/${this._getSnapshot().context.refResolvedValue}`
    }
  }

  get versionLocalId(): string | undefined {
    return this._getSnapshot().context.versionLocalId
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