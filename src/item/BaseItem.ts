import { IItem, IItemProperty } from '@/interfaces'
import { itemMachineSingle } from '@/Item/service/itemMachineSingle'
import { INTERNAL_PROPERTY_NAMES } from '@/helpers/constants'
import { VersionsType } from '@/seedSchema'
import { getModel } from '@/stores/modelClass'

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
import { eventEmitter } from '@/eventBus'
import pluralize from 'pluralize'
import { orderBy, startCase } from 'lodash-es'
import { waitForEvent } from '@/events'
import { getItemData } from '@/db/read/getItemData'
import { getItemsData } from '@/db/read/getItems'
import { BaseItemProperty } from '@/ItemProperty/BaseItemProperty'
import { getItemProperties } from '@/db/read/getItemProperties'
import { getPublishUploads } from '@/db/read/getPublishUploads'
import { getPublishPayload } from '@/db/read/getPublishPayload'
import { createNewItem } from '@/db/write/createNewItem'


export abstract class BaseItem<T extends ModelValues<ModelSchema>> implements IItem<T> {

  protected static instanceCache: Map<string, { instance: BaseItem<any>; refCount: number }> = new Map();
  protected _subscription: Subscription | undefined;
  protected readonly _storageTransactionId: string | undefined;
  [immerable] = true;
  protected _propertiesSubject: BehaviorSubject<Record<string, IItemProperty<any>>> = new BehaviorSubject({});
  protected readonly _service: ActorRefFrom<typeof itemMachineSingle>;

  constructor(initialValues: NewItemProps<T>) {

    const {
      modelName,
      seedUid,
      schemaUid,
      seedLocalId,
      latestVersionLocalId,
      latestVersionUid,
    } = initialValues

    const ModelClass = getModel(modelName)

    if (
      ModelClass &&
      Object.keys(ModelClass?.schema).includes('storageTransactionId') &&
      initialValues.storageTransactionId
    ) {
      this._storageTransactionId = initialValues.storageTransactionId
    }

    this._service = createActor(itemMachineSingle, {
      input: {
        seedLocalId,
        seedUid,
        schemaUid,
        ModelClass,
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

      const propertiesObj: Record<string, IItemProperty<any>> = {}

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
      // eventEmitter.emit(`item.${modelName}.${seedUid || seedLocalId}.update`)
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

    if (ModelClass && ModelClass.schema) {
      const schema = ModelClass.schema

      for (const [propertyName, propertyRecordSchema] of Object.entries(
        schema,
      )) {
        if (!propertyRecordSchema) {
          throw new Error(`Property ${propertyName} has no definition`)
        }

        this._createPropertyInstance({
          ...itemPropertyBase,
          propertyName,
          propertyValue: initialValues[propertyName as keyof T],
        })

        definedKeys.push(propertyName)

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
    props: Partial<ItemData>,
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
        const newInstance = new this(props)
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
    const { seedLocalId, versionLocalId, } = await createNewItem({
      modelName: props.modelName,
      ...props,
    })
    props.seedLocalId = seedLocalId
    props.latestVersionLocalId = versionLocalId
    const newInstance = new this(props)
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
    return await getPublishUploads(this)
  }

  getPublishPayload = async (uploadedTransactions: any[]) => {
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

  get schemaUid(): string {
    return this.serviceContext.schemaUid as string
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

  get properties(): Record<string, IItemProperty<any>> {
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

  unload(): void {
    this._subscription?.unsubscribe()
    this._service.stop()
  }
}
