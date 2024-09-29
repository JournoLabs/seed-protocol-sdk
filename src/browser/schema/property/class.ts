import { ItemPropertyProps } from '@/types'
import { ActorRefFrom, createActor, Subscription } from 'xstate'
import { BehaviorSubject, Subscriber } from 'rxjs'
import { propertyMachine } from '@/browser/schema/property/machine'
import { immerable } from 'immer'
import { eventEmitter } from '@/eventBus'
import pluralize from 'pluralize'

export class ItemProperty<PropertyType> {
  [immerable] = true
  private readonly _service: ActorRefFrom<typeof propertyMachine>
  private _subject: BehaviorSubject<any>
  private readonly _isRelation: boolean = false
  private readonly _isList: boolean = false
  private readonly _alias: string | undefined
  private _subscription: Subscription
  private _lastSavedValue: any

  constructor({
    propertyRecordSchema,
    initialValue,
    seedUid,
    seedLocalId,
    itemModelName,
    propertyName,
  }: ItemPropertyProps) {
    if (typeof propertyRecordSchema === 'object') {
      if (propertyRecordSchema.dataType === 'Relation') {
        this._isRelation = true
      }
      if (
        propertyRecordSchema.dataType === 'List' &&
        propertyRecordSchema.ref
      ) {
        this._isList = true
        this._isRelation = true

        const propertyNameSingular = pluralize(propertyName!, 1)

        this._alias = propertyName

        propertyName = `${propertyNameSingular}${propertyRecordSchema.ref}Ids`
      }
    }

    this._subject = new BehaviorSubject(initialValue)
    this._service = createActor(propertyMachine, {
      input: {
        propertyValue: initialValue,
        propertyName,
        seedUid,
        seedLocalId,
        propertyRecordSchema,
        isRelation: this._isRelation,
        itemModelName,
      },
    })
    this._subscription = this._service.subscribe((snapshot) => {
      const { context } = snapshot
      if (
        context &&
        context.propertyName &&
        context.propertyValue !== this._lastSavedValue
      ) {
        this._subject.next(context.propertyValue)
        this._lastSavedValue = context.propertyValue
        eventEmitter.emit(
          `item.${itemModelName}.${seedLocalId}.property.update`,
          {
            propertyName,
            propertyValue: context.propertyValue,
          },
        )
      }
    })
    this._service.start()
  }

  getService() {
    return this._service
  }

  get propertyName() {
    if (this._alias) {
      return this._alias
    }
    return this._service.getSnapshot().context.propertyName
  }

  get propertyDef() {
    return this._service.getSnapshot().context.propertyRecordSchema
  }

  get status() {
    return this._service.getSnapshot().value
  }

  get value() {
    const context = this._service.getSnapshot().context
    if (!context || !context.isRelation) {
      return this._subject.value
    }

    if (context && context.isRelation) {
      if (context.propertyRelationDisplayValue) {
        console.log(
          '[itemProperty] [value] context.propertyRelationDisplayValue',
          context,
        )
      }
      return (
        context.propertyRelationDisplayValue ||
        context.propertyRelationValue ||
        this._subject.value
      )
    }
    return this._subject.value
  }

  set value(value: any) {
    if (this._subject.value === value) {
      return
    }
    this._subject.next(value)
    this._service.send({
      type: 'updatePropertyValue',
      propertyValue: value,
    })
  }

  subscribe(callback: Partial<Subscriber<any>>) {
    return this._subject.subscribe(callback)
  }

  unload() {
    this._service.stop()
  }
}
