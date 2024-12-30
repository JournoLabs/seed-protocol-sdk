import { EventObject, fromCallback } from 'xstate'
import { FromCallbackInput } from '@/types/machines'
import {
  ItemPropertyValueType,
  PropertyMachineContext,
  SaveValueToDbEvent,
} from '@/types/property'
import { updateItemPropertyValue } from '@/browser/db/write/updateItemPropertyValue'

import { getSchemaForItemProperty } from '@/browser/helpers/getSchemaForItemProperty'
import { INTERNAL_DATA_TYPES } from '@/shared/helpers/constants'
import { TypedData } from '@ethereum-attestation-service/eas-sdk/dist/offchain/typed-data-handler'

export const analyzeInput = fromCallback<
  EventObject,
  FromCallbackInput<PropertyMachineContext, SaveValueToDbEvent>
>(({ sendBack, input: { context, event } }) => {
  const {
    localId,
    propertyName: propertyNameRaw,
    seedLocalId,
    versionLocalId,
    versionUid,
    propertyValue: existingValue,
    propertyRecordSchema,
    modelName,
  } = context

  let { schemaUid } = context

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

    if (!schemaUid) {
      let easDataType

      if (propertyRecordSchema.dataType) {
        easDataType = INTERNAL_DATA_TYPES[propertyRecordSchema.dataType]
          .eas as TypedData['type']
      }

      const schemaFromEas = await getSchemaForItemProperty({
        propertyName,
        easDataType,
      })
      if (schemaFromEas) {
        schemaUid = schemaFromEas.id
      }
    }

    await updateItemPropertyValue({
      localId,
      propertyName,
      newValue,
      seedLocalId,
      versionLocalId,
      versionUid,
      modelName,
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
