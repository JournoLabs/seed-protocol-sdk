import { ModelSchema, ModelValues, NewItemProps } from '@/types'
import { ActorRefFrom, createActor, Subscription } from 'xstate'
import { ItemProperty } from '@/browser/schema/property/class'
import { singleItemMachine } from './singleItemMachine'
import { immerable } from 'immer'
import { eventEmitter } from '@/eventBus'


export class Item<T extends ModelValues<ModelSchema>> {
  private readonly _service: ActorRefFrom<typeof singleItemMachine>
  private _subscription: Subscription | undefined
  private readonly _eventKey: string;
  [immerable] = true

  constructor(initialValues: NewItemProps<T>) {
    let versionLocalId = initialValues.seedLocalId

    const { ModelClass, seedUid, schemaUid, seedLocalId } = initialValues

    const modelName = ModelClass!.originalConstructor.name

    this._eventKey = `item.${modelName}.${versionLocalId}.property.update`

    this._service = createActor(singleItemMachine, {
      input: {
        seedLocalId,
        seedUid,
        schemaUid,
        ModelClass,
      },
    })

    this._subscription = this._service.subscribe((snapshot) => {
      // console.log('[item/class] [constructor] context', snapshot.context)
      // eventEmitter.emit(this._eventKey, snapshot.context)
    })

    this._service.start()

    const internalKeys: string[] = ['schemaUid']
    const definedKeys: string[] = ['ModelClass']

    if (ModelClass && ModelClass.schema) {
      const schema = ModelClass.schema
      for (const [propertyName, propertyRecordSchema] of Object.entries(
        schema,
      )) {
        if (!propertyRecordSchema) {
          throw new Error(`Property ${propertyName} has no definition`)
        }

        if (propertyRecordSchema.dataType === 'List') {
          console.log(
            '[item/class] [constructor] relation property',
            propertyName,
            propertyRecordSchema,
          )
        }

        const propertyInstance = new ItemProperty({
          propertyName,
          propertyRecordSchema,
          schemaUid,
          initialValue: initialValues[propertyName],
          seedLocalId,
          seedUid,
          itemModelName: ModelClass!.originalConstructor.name,
        })

        this._service.send({
          type: 'addPropertyInstance',
          propertyName,
          propertyInstance,
        })

        Object.defineProperty(this, propertyName, {
          get: () => propertyInstance.value,
          set: (value) => (propertyInstance.value = value),
          enumerable: true,
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

        const propertyInstance = new ItemProperty({
          propertyName: key,
          propertyRecordSchema: key,
          initialValue: initialValues[key],
          seedLocalId,
          seedUid,
          itemModelName: ModelClass!.originalConstructor.name,
        })

        this._service.send({
          type: 'addPropertyInstance',
          propertyName: key,
          propertyInstance,
        })

        Object.defineProperty(this, key, {
          get: () => propertyInstance.value,
          set: (value) => (propertyInstance.value = value),
          enumerable: true,
        })
      },
    )

    this._listenForUpdates()
  }

  // This method was originally intended to handle any async operations required
  // by an Item. It was intended to be invoked by the static `create` method on
  // a ModelClass. Currently, all this is handled by the itemService at `_service`
  // which is created from itemMachine. This method may no longer be necessary.
  async initialize(): Promise<void> {}

  private _listenForUpdates() {
    eventEmitter.addListener(this._eventKey, this._propertyUpdateHandler)
  }

  private _propertyUpdateHandler = (event) => {
    // console.log('[item/class] [_propertyUpdateHandler] event', event)
  }

  subscribe = (callback: (itemProps: any) => void): Subscription => {
    return this._service.subscribe((snapshot) => {
      callback(snapshot.context)
    })
  }

  getService = (): ActorRefFrom<typeof singleItemMachine> => {
    return this._service
  }

  get properties(): Record<string, ItemProperty<any>> {
    const propertiesMap = this._service.getSnapshot().context.propertyInstances
    return Object.fromEntries(propertiesMap!.entries())
  }

  unload(): void {
    eventEmitter.removeListener(this._eventKey, this._propertyUpdateHandler)
    this._subscription?.unsubscribe()
    this._service.stop()
  }
}
