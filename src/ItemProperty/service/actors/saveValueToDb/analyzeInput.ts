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
// Dynamic import to break circular dependency: schema/index -> ... -> analyzeInput -> schema/index
// import { ModelPropertyDataTypes } from '@/schema'
import type { EIP712MessageTypes } from '@ethereum-attestation-service/eas-sdk'

// Extract TypedData type from EIP712MessageTypes
// EIP712MessageTypes is defined as { [key: string]: TypedData[] }
type ExtractTypedData<T> = T extends { [key: string]: infer U }
  ? U extends Array<infer V>
    ? V
    : never
  : never
type TypedData = ExtractTypedData<EIP712MessageTypes>

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
    // Use dynamic import to break circular dependency
    const { ModelPropertyDataTypes } = await import('@/Schema')
    
    let propertyName = propertyNameRaw
    if (!propertyName) {
      throw new Error('propertyName is required')
    }

    if (
      propertyRecordSchema.refValueType &&
      propertyRecordSchema.refValueType !== ModelPropertyDataTypes.Image &&
      propertyRecordSchema.dataType === ModelPropertyDataTypes.Relation
    ) {
      sendBack({
        type: 'saveRelation',
        newValue,
      })
      return false
    }

    if (
      propertyRecordSchema.refValueType === ModelPropertyDataTypes.Image ||
      propertyRecordSchema.dataType === ModelPropertyDataTypes.Image
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
      try {
        let easDataType

        if (propertyRecordSchema.dataType) {
          easDataType = INTERNAL_DATA_TYPES[propertyRecordSchema.dataType]
            .eas as TypedData['type']
        }

        const schemaFromEas = await getSchemaForItemProperty({
          propertyName: propertyName!,
          easDataType,
        })
        if (schemaFromEas) {
          schemaUid = schemaFromEas.id
        }
      } catch (error) {
        // If schema fetch fails, continue without schemaUid - it's not required for local metadata
        // Log error in development but don't throw
        if (process.env.NODE_ENV === 'development') {
          console.warn(`Failed to fetch schemaUid for property ${propertyName}:`, error)
        }
      }
    }

    // Convert newValue to string for database storage
    const stringValue = newValue !== null && newValue !== undefined 
      ? (typeof newValue === 'string' ? newValue : String(newValue))
      : null

    const result = await updateItemPropertyValue({
      localId,
      propertyName: propertyName!,
      newValue: stringValue,
      seedLocalId,
      versionLocalId,
      versionUid,
      modelName,
      schemaUid,
    } as any) // Type assertion needed because newValue is not in MetadataType but is accepted by the function

    let updatedContext: Partial<PropertyMachineContext> = {
      propertyValue: typeof newValue === 'string' ? newValue : (newValue !== null && newValue !== undefined ? String(newValue) : undefined),
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
