import { EventObject, fromCallback } from 'xstate'
import { FromCallbackInput } from '@/types/machines'
import {
  ItemPropertyValueType,
  PropertyMachineContext,
  SaveValueToDbEvent,
} from '@/types/property'
import { updateItemPropertyValue } from '@/db/write/updateItemPropertyValue'

import { getEasSchemaForItemProperty } from '@/helpers/getSchemaForItemProperty'
import { normalizeDataType } from '@/helpers/property'
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

  // Do NOT skip when existingValue === newValue: the value setter sends updateContext before save,
  // so context is already updated by the time we run. Skipping would prevent the first persist.
  // updateItemPropertyValue deduplicates by checking DB; saveFile/saveImage have their own logic.

  if (!propertyRecordSchema) {
    throw new Error('Missing propertyRecordSchema')
  }

  const _analyzeInput = async (): Promise<boolean> => {
    // Use dynamic import to break circular dependency
    const schemaMod = await import('../../../../Schema')
    const { ModelPropertyDataTypes } = schemaMod
    const { SchemaValidationService } = await import('../../../../Schema/service/validation/SchemaValidationService')

    let propertyName = propertyNameRaw
    if (!propertyName) {
      throw new Error('propertyName is required')
    }

    if (
      normalizeDataType(propertyRecordSchema.dataType) === ModelPropertyDataTypes.List &&
      typeof newValue === 'string' &&
      newValue.trim() !== ''
    ) {
      newValue = [newValue.trim()] as ItemPropertyValueType
    }

    // Validate value against property validation rules (enum, pattern, minLength, maxLength) before any save
    const validationService = new SchemaValidationService()
    const validationResult = validationService.validatePropertyValue(
      newValue,
      propertyRecordSchema.dataType as any,
      propertyRecordSchema.validation,
      propertyRecordSchema.refValueType as string | undefined
    )
    if (!validationResult.isValid) {
      sendBack({ type: 'saveValueValidationError', errors: validationResult.errors })
      return false
    }

    const normalizedDataType = normalizeDataType(propertyRecordSchema.dataType)
    const normalizedRefValueType = normalizeDataType(propertyRecordSchema.refValueType)

    if (
      propertyRecordSchema.refValueType &&
      normalizedRefValueType !== ModelPropertyDataTypes.Image &&
      normalizedDataType === ModelPropertyDataTypes.Relation
    ) {
      sendBack({
        type: 'saveRelation',
        newValue,
      })
      return false
    }

    if (
      normalizedRefValueType === ModelPropertyDataTypes.Image ||
      normalizedDataType === ModelPropertyDataTypes.Image
    ) {
      sendBack({
        type: 'saveImage',
        newValue,
      })
      return false
    }

    if (normalizedDataType === ModelPropertyDataTypes.File) {
      sendBack({
        type: 'saveFile',
        newValue,
      })
      return false
    }

    if (normalizedDataType === ModelPropertyDataTypes.Html) {
      sendBack({
        type: 'saveHtml',
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
          const normalizedType = normalizeDataType(propertyRecordSchema.dataType)
          easDataType = INTERNAL_DATA_TYPES[normalizedType as keyof typeof INTERNAL_DATA_TYPES]?.eas as TypedData['type']
        }

        const schemaFromEas = await getEasSchemaForItemProperty({
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

    // List (including list of relations / primitives): JSON in DB, array in context for publish (bytes32[])
    if (normalizedDataType === ModelPropertyDataTypes.List && Array.isArray(newValue)) {
      const stringValue = JSON.stringify(newValue)
      const result = await updateItemPropertyValue({
        localId,
        propertyName: propertyName!,
        newValue: stringValue,
        seedLocalId,
        versionLocalId,
        versionUid,
        modelName,
        schemaUid,
        dataType: propertyRecordSchema.dataType,
        refValueType: propertyRecordSchema.refValueType,
      } as any)

      const updatedContext: Partial<PropertyMachineContext> = {
        propertyValue: newValue,
        renderValue: newValue,
      }
      if (localId) updatedContext.localId = localId
      if (schemaUid) updatedContext.schemaUid = schemaUid
      if (!localId && result?.localId) updatedContext.localId = result.localId
      if (!schemaUid && result?.schemaUid) updatedContext.schemaUid = result.schemaUid

      sendBack({ type: 'updateContext', ...updatedContext })
      return true
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
      dataType: propertyRecordSchema.dataType,
      refValueType: propertyRecordSchema.refValueType,
    } as any) // Type assertion needed because newValue is not in MetadataType but is accepted by the function

    const stringValueForContext =
      typeof newValue === 'string' ? newValue : (newValue !== null && newValue !== undefined ? String(newValue) : undefined)
    let updatedContext: Partial<PropertyMachineContext> = {
      propertyValue: stringValueForContext,
      renderValue: stringValueForContext,
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
