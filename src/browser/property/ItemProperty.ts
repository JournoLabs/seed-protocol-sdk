import { CreatePropertyInstanceProps, PropertyMachineContext } from '@/types'
import {
  ActorRefFrom,
  createActor,
  SnapshotFrom,
  Subscription,
  waitFor,
} from 'xstate'
import { BehaviorSubject, Subscriber } from 'rxjs'
import { propertyMachine } from './propertyMachine'
import { immerable } from 'immer'
import pluralize from 'pluralize'
import { eventEmitter } from '@/eventBus'
import { getPropertyData } from '@/browser/db/read'
import { internalPropertyNames } from '@/shared/helpers/constants'
import debug from 'debug'
import { getModel } from '@/browser/stores/modelClass'
import { getCorrectId } from '@/browser/helpers'
import { Static } from '@sinclair/typebox'
import { TProperty } from '@/browser/property'

const logger = debug('app:property:class')

type ItemPropertyService = ActorRefFrom<typeof propertyMachine>
type ItemPropertySnapshot = SnapshotFrom<typeof propertyMachine>

type ItemPropertyFindProps = {
  propertyName: string
  propertyLocalId?: string
  seedLocalId?: string
  seedUid?: string
}

const namesThatEndWithId: string[] = []

export class ItemProperty<PropertyType> {
  private static instanceCache: Map<
    string,
    { instance: ItemProperty<any>; refCount: number }
  > = new Map()
  private readonly _service: ItemPropertyService
  private _subject: BehaviorSubject<any>
  private readonly _isRelation: boolean = false
  private readonly _isList: boolean = false
  private readonly _alias: string | undefined
  private _subscription: Subscription
  private _dataType: string | undefined
  private _schemaUid: string | undefined
  private _updateResponseEvent: string | undefined;
  [immerable] = true

  // private constructor(localIdOrUid) {
  // }

  constructor({
    propertyValue,
    seedUid,
    seedLocalId,
    versionLocalId,
    versionUid,
    modelName,
    propertyName,
    storageTransactionId,
    schemaUid,
  }: Partial<CreatePropertyInstanceProps>) {
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

      if (
        propertyName.endsWith('Id') &&
        !namesThatEndWithId.includes(propertyName)
      ) {
        propertyNameWithoutId = propertyName.slice(0, -2)
      }

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

        // if (
        //   context.propertyName &&
        //   context.propertyName.includes('featureImage')
        // ) {
        //   console.log(
        //     `${context.localId} context for ${snapshot.value}`,
        //     context,
        //   )
        // }

        if (context.seedLocalId) {
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
          // this._updateResponseEvent = `property.${context.seedLocalId}.${this.propertyName}.save.response`
          // eventEmitter.addListener(
          //   this._updateResponseEvent,
          //   this._updateResponseListener,
          // )
        }

        let renderValue

        // if (
        //   propertyRecordSchema &&
        //   propertyRecordSchema.storageType &&
        //   propertyRecordSchema.storageType === 'ItemStorage' &&
        //   context.resolvedValue &&
        //   context.localStorageDir
        // ) {
        //   const filePath = `/files/${context.localStorageDir}/${context.resolvedValue}`
        //   try {
        //     const exists = await fs.promises.exists(filePath)
        //     if (exists) {
        //       renderValue = await fs.promises.readFile(filePath, 'utf-8')
        //     }
        //   } catch (e) {
        //     logger(
        //       `[ItemProperty] [${context.seedLocalId}] [${context.propertyName}] [storageType] error`,
        //       e,
        //     )
        //   }
        // }

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

        this._subject.next(renderValue)
        if (context.seedLocalId) {
          eventEmitter.emit(`item.${modelName}.${context.seedLocalId}.update`)
        }
        if (context.seedUid) {
          eventEmitter.emit(`item.${modelName}.${context.seedUid}.update`)
        }
      },
    )

    this._service.start()
  }

  private _updateResponseListener(event) {
    logger(
      `[ItemProperty] [_updateResponseListener] [${this.modelName}.${this.seedLocalId}] ${this.propertyName} event`,
      event,
    )
  }

  static create(
    props: Partial<CreatePropertyInstanceProps>,
  ): ItemProperty<any> | undefined {
    const { propertyName, seedLocalId, seedUid, versionLocalId, versionUid } =
      props
    if (!propertyName || (!seedLocalId && !seedUid)) {
      return
    }
    const cacheKey = ItemProperty.cacheKey(
      (seedUid || seedLocalId) as string,
      propertyName,
    )
    if (seedLocalId && propertyName) {
      if (ItemProperty.instanceCache.has(cacheKey)) {
        const { instance, refCount } = ItemProperty.instanceCache.get(cacheKey)!
        ItemProperty.instanceCache.set(cacheKey, {
          instance,
          refCount: refCount + 1,
        })
        return instance
      }
      if (!ItemProperty.instanceCache.has(cacheKey)) {
        const newInstance = new ItemProperty(props)
        ItemProperty.instanceCache.set(cacheKey, {
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
        const newInstance = new ItemProperty(props)
        this.instanceCache.set(cacheKey, { instance: newInstance, refCount: 1 })
        return newInstance
      }
    }
    return new ItemProperty(props)
  }

  static async find({
    propertyName,
    seedLocalId,
    seedUid,
  }: ItemPropertyFindProps): Promise<ItemProperty<any> | undefined> {
    if ((!seedLocalId && !seedUid) || !propertyName) {
      return
    }
    const cacheKeyId = seedUid || seedLocalId
    const cacheKey = ItemProperty.cacheKey(cacheKeyId!, propertyName)
    if (this.instanceCache.has(cacheKey)) {
      const { instance, refCount } = this.instanceCache.get(cacheKey)!
      this.instanceCache.set(cacheKey, {
        instance,
        refCount: refCount + 1,
      })
      return instance
    }
    const propertyData = await getPropertyData(
      propertyName,
      seedLocalId,
      seedUid,
    )
    if (!propertyData) {
      return
    }
    return ItemProperty.create(propertyData)
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
    logger(
      `[XXXXXX] [ItemProperty] [${this.seedLocalId}] [unload] removing listener`,
      this._updateResponseEvent,
    )
    eventEmitter.removeListener(
      this._updateResponseEvent,
      this._updateResponseListener,
    )
  }
}
