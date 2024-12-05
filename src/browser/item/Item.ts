import {
  CreatePropertyInstanceProps,
  ItemData,
  ItemFindProps,
  ModelSchema,
  ModelValues,
  NewItemProps,
  PropertyData,
} from '@/types'
import { ActorRefFrom, createActor, Subscription } from 'xstate'
import { ItemProperty } from '@/browser/property/ItemProperty'
import { itemMachineSingle } from './single/itemMachineSingle'
import { immerable } from 'immer'
import pluralize from 'pluralize'
import { getItemsData } from '@/browser/db/read/getItems'
import { getItemDataFromDb } from '@/browser/db/read/getItem'
import { BehaviorSubject } from 'rxjs'
import { internalPropertyNames } from '@/shared/helpers/constants'
import { orderBy } from 'lodash-es'
import { eventEmitter } from '@/eventBus'
import { getModel } from '@/browser/stores/modelClass'
import { createNewItem } from '@/browser/db/write'
import { waitForEvent } from '@/browser/events'
import { getItemProperties } from '@/browser/db/read/getItemProperties'
import { VersionsType } from '@/shared/seedSchema/VersionSchema'

export class Item<T extends ModelValues<ModelSchema>> {
  private static instanceCache: Map<
    string,
    { instance: Item<any>; refCount: number }
  > = new Map()
  private readonly _service: ActorRefFrom<typeof itemMachineSingle>
  private _subscription: Subscription | undefined
  private readonly _storageTransactionId: string | undefined;
  [immerable] = true
  private _propertiesSubject: BehaviorSubject<
    Record<string, ItemProperty<any>>
  > = new BehaviorSubject({})

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

      const propertiesObj: Record<string, ItemProperty<any>> = {}

      for (const [key, propertyInstance] of context.propertyInstances) {
        if (typeof key !== 'string' || internalPropertyNames.includes(key)) {
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
      eventEmitter.emit(`item.${modelName}.${seedUid || seedLocalId}.update`)
    })

    this._service.start()

    const definedKeys: string[] = ['ModelClass']

    const itemPropertyBase: Partial<CreatePropertyInstanceProps> = {
      seedLocalId,
      seedUid,
      versionLocalId: latestVersionLocalId,
      versionUid: latestVersionUid,
      itemModelName: modelName,
      schemaUid,
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
      }
    }

    ;(Object.keys(initialValues) as Array<string & keyof Partial<T>>).forEach(
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

  static async create<T extends ModelValues<ModelSchema>>(
    props: Partial<ItemData>,
  ): Promise<Item<any>> {
    if (!props.seedUid) {
      console.log('Creating new item without seedUid')
    }
    if (props.seedUid || props.seedLocalId) {
      const seedId = (props.seedUid || props.seedLocalId) as string
      if (Item.instanceCache.has(seedId)) {
        const { instance, refCount } = Item.instanceCache.get(seedId)!
        Item.instanceCache.set(seedId, {
          instance,
          refCount: refCount + 1,
        })
        return instance
      }
      if (!Item.instanceCache.has(seedId)) {
        const newInstance = new Item<any>(props)
        Item.instanceCache.set(seedId, {
          instance: newInstance,
          refCount: 1,
        })
        return newInstance
      }
    }
    if (!props.modelName) {
      throw new Error('Model name is required to create an item')
    }
    const { seedLocalId } = await createNewItem({
      modelName: props.modelName,
    })
    props.seedLocalId = seedLocalId
    const newInstance = new Item<any>(props)
    Item.instanceCache.set(newInstance.seedUid || newInstance.seedLocalId, {
      instance: newInstance,
      refCount: 1,
    })
    return newInstance
  }

  static async find({
    modelName,
    seedLocalId,
    seedUid,
  }: ItemFindProps): Promise<Item<any> | undefined> {
    if (!seedLocalId && !seedUid) {
      return
    }
    const itemData = await getItemDataFromDb({
      modelName,
      seedLocalId,
      seedUid,
    })

    if (!itemData) {
      console.error('No item data found', { modelName, seedLocalId, seedUid })
      return
    }

    return Item.create({
      ...itemData,
      modelName,
    })
  }

  static async all(
    modelName?: string,
    deleted?: boolean,
  ): Promise<Item<any>[]> {
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

    return orderBy(itemInstances, ['createdAt'], ['desc'])
  }

  static async publish(item: Item<any>): Promise<void> {
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

  private _createPropertyInstance(props: Partial<CreatePropertyInstanceProps>) {
    if (this._storageTransactionId) {
      props.storageTransactionId = this._storageTransactionId
    }

    const propertyInstance = ItemProperty.create(props)

    if (!propertyInstance) {
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

  get seedLocalId(): string {
    return this._service.getSnapshot().context.seedLocalId as string
  }

  get seedUid(): string | undefined {
    return this._service.getSnapshot().context.seedUid
  }

  get schemaUid(): string {
    return this.properties['schemaUid'].value
  }

  get latestVersionUid(): VersionsType {
    return this.properties['latestVersionUid'].value
  }

  get modelName(): string {
    return this._service.getSnapshot().context.modelName as string
  }

  get properties(): Record<string, ItemProperty<any>> {
    return this._propertiesSubject.value
  }

  unload(): void {
    this._subscription?.unsubscribe()
    this._service.stop()
  }
}
