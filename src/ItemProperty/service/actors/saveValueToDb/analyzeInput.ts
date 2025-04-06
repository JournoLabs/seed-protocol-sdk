import { EventObject, fromCallback } from 'xstate'
import { FromCallbackInput } from '@/types/machines'
import {
  ItemPropertyValueType,
  PropertyMachineContext,
  SaveValueToDbEvent,
} from '@/types/property'
import { updateItemPropertyValue } from '@/db/write/updateItemPropertyValue'

import { getSchemaForItemProperty } from '@/helpers/getSchemaForItemProperty'
import { INTERNAL_DATA_TYPES } from '@/helpers/constants'
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
      propertyRecordSchema.refValueType !== 'Image' &&
      propertyRecordSchema.dataType === 'Relation'
    ) {
      sendBack({
        type: 'saveRelation',
        newValue,
      })
      return false
    }

    if (
      propertyRecordSchema.refValueType === 'Image' ||
      propertyRecordSchema.dataType === 'Image'
    ) {
      sendBack({
        type: 'saveImage',
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

    const result = await updateItemPropertyValue({
      localId,
      propertyName,
      newValue,
      seedLocalId,
      versionLocalId,
      versionUid,
      modelName,
      schemaUid,
    })

    let updatedContext: Partial<PropertyMachineContext> = {
      propertyValue: newValue,
    }

    if (localId) {
      updatedContext.localId = localId
    }

    if (schemaUid) {
      updatedContext.schemaUid = schemaUid
    }

    if (!localId && result?.localId) {
      updatedContext.localId = result.localId
    }

    if (!schemaUid && result?.schemaUid) {
      updatedContext.schemaUid = result.schemaUid
    }

    sendBack({
      type: 'updateContext',
      ...updatedContext,
    })

    return true
  }

  _analyzeInput().then((isDone) => {
    if (isDone) {
      sendBack({ type: 'saveValueToDbSuccess' })
    }
  })
})
