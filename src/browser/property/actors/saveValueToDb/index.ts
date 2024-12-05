import { EventObject, fromCallback } from 'xstate'
import { updateItemPropertyValue } from '@/browser/db/write'
import { FromCallbackInput } from '@/types/machines'
import {
  ItemPropertyValueType,
  PropertyMachineContext,
  SaveValueToDbEvent,
} from '@/types/property'

export * from './saveImageSrc'
export * from './saveRelation'
export * from './saveItemStorage'

export const analyzeInput = fromCallback<
  EventObject,
  FromCallbackInput<PropertyMachineContext, SaveValueToDbEvent>
>(({ sendBack, input: { context, event } }) => {
  const {
    localId,
    propertyName: propertyNameRaw,
    seedLocalId,
    versionLocalId,
    propertyValue: existingValue,
    propertyRecordSchema,
    itemModelName,
    schemaUid,
  } = context

  let newValue: ItemPropertyValueType

  if (event) {
    newValue = event.newValue
  }

  if (existingValue === newValue) {
    sendBack({ type: 'saveValueToDbSuccess' })
    return
  }

  if (!propertyRecordSchema) {
    throw new Error('Missing propertyRecordSchema')
  }

  const _analyzeInput = async (): Promise<boolean> => {
    let propertyName = propertyNameRaw

    if (
      propertyRecordSchema.refValueType &&
      propertyRecordSchema.refValueType !== 'ImageSrc' &&
      propertyRecordSchema.dataType === 'Relation'
    ) {
      sendBack({
        type: 'saveRelation',
        newValue,
      })
      return false
    }

    // if (
    //   propertyRecordSchema.dataType === 'List' &&
    //   propertyRecordSchema.ref
    // ) {
    //   sendBack({
    //     type: 'saveListRelation',
    //     newValue,
    //   })
    //   return false
    // }

    if (
      propertyRecordSchema.refValueType === 'ImageSrc' ||
      propertyRecordSchema.dataType === 'ImageSrc'
    ) {
      sendBack({
        type: 'saveImageSrc',
        newValue,
      })
      return false
    }

    if (
      propertyRecordSchema.storageType &&
      propertyRecordSchema.storageType === 'ItemStorage'
    ) {
      sendBack({
        type: 'saveItemStorage',
        newValue,
      })
      return false
    }

    await updateItemPropertyValue({
      propertyLocalId: localId,
      propertyName,
      newValue,
      seedLocalId,
      versionLocalId,
      modelName: itemModelName,
      schemaUid,
    })

    sendBack({
      type: 'updateContext',
      propertyValue: newValue,
    })

    return true
  }

  _analyzeInput().then((isDone) => {
    if (isDone) {
      sendBack({ type: 'saveValueToDbSuccess' })
    }
  })
})
