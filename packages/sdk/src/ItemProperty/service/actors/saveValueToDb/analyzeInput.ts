import { EventObject, fromCallback } from 'xstate'
import { FromCallbackInput } from '@/types/machines'
import {
  ItemPropertyValueType,
  PropertyMachineContext,
  SaveValueToDbEvent,
} from '@/types/property'
import { updateItemPropertyValue } from '@/db/write/updateItemPropertyValue'
import { beginPropertyWrite, propertyWriteKey } from '@/helpers/propertyWriteTickets'
import { rowContext } from './rowContext'
import type { SetPropertyValueOp, SetPropertyValueResult } from '@/outbox/itemAppliers'

import { lookupPropertySchemaUid } from '@/helpers/propertySchemaUid'
import { timed } from '@/helpers/timing'
import { normalizeDataType } from '@/helpers/property'
// Dynamic import to break circular dependency: schema/index -> ... -> analyzeInput -> schema/index
// import { ModelPropertyDataTypes } from '@/schema'

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

  // Taken now, before the async checks below, so a newer save always replaces this one.
  const writeKey = propertyWriteKey(seedLocalId ?? context.seedUid, propertyNameRaw)
  const writeTicket = writeKey ? beginPropertyWrite(writeKey) : undefined

  /**
   * Writes a plain value through the outbox (ADR 0019): appends a `set` op and waits until it
   * applies. Skipped when a newer save of this property started first (in this tab) or a newer
   * value superseded it. Rejects when the op fails. An item known only by its seed uid has no
   * outbox key yet and writes directly.
   */
  const writePlainValue = async (props: SetPropertyValueOp) => {
    if (!seedLocalId || !propertyNameRaw) {
      if (writeTicket && !writeTicket.isLatest()) return { skipped: true as const }
      const result = await updateItemPropertyValue({ ...props, seedLocalId, propertyName: propertyNameRaw } as any)
      return { skipped: false as const, result }
    }
    const { appendOutboxOp, getOutboxOps, outboxOpResult, startItemOutbox, throwItemWriteError, waitForOutboxOp } =
      await import('@/outbox')
    startItemOutbox()
    // Checked right before appending (no await in between): ops apply in append order
    if (writeTicket && !writeTicket.isLatest()) return { skipped: true as const }
    const opId = await appendOutboxOp({
      seedLocalId,
      propertyName: propertyNameRaw,
      kind: 'set',
      value: props,
      baseRowId: localId ?? null,
    })
    await waitForOutboxOp(opId).catch(throwItemWriteError)
    const [op] = await getOutboxOps([opId])
    if (op?.status !== 'applied') return { skipped: true as const }
    return { skipped: false as const, result: outboxOpResult<SetPropertyValueResult>(op) ?? undefined }
  }

  const _analyzeInput = async (): Promise<boolean> => {
    // Assignment writes straight to the DB, so check ownership here as save()/destroy()/publish() do.
    const label = `save ${modelName ?? '?'}.${propertyNameRaw ?? '?'}`
    const { isItemOwned, OwnershipError } = await import('@/helpers/ownership')
    const owned = await timed(`${label} write ownership`, () =>
      isItemOwned({ seedLocalId: seedLocalId ?? undefined, seedUid: context.seedUid ?? undefined }),
    )
    if (!owned) {
      sendBack({ type: 'saveFailed', error: new OwnershipError() })
      return false
    }

    // Use dynamic import to break circular dependency
    const schemaMod = await import('../../../../Schema')
    const { ModelPropertyDataTypes } = schemaMod
    const { SchemaValidationService } = await import('../../../../Schema/service/validation/SchemaValidationService')

    const propertyName = propertyNameRaw
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

    // A Relation with a non-Image refValueType stores the related seed id like any other value,
    // through the write below.
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
      // Cached lookup, shared with item creation, so a save doesn't wait on the EAS indexer each
      // time. Not required for the row; publish resolves the schema again.
      schemaUid = await timed(`${label} schema lookup`, () =>
        lookupPropertySchemaUid(propertyName, propertyRecordSchema as Parameters<typeof lookupPropertySchemaUid>[1]),
      )
    }

    // List (including list of relations / primitives): JSON in DB, array in context for publish (bytes32[])
    if (normalizedDataType === ModelPropertyDataTypes.List && Array.isArray(newValue)) {
      const stringValue = JSON.stringify(newValue)
      const written = await timed(`${label} write`, () => writePlainValue({
        localId,
        newValue: stringValue,
        versionLocalId,
        versionUid,
        modelName,
        schemaUid,
        dataType: propertyRecordSchema.dataType,
        refValueType: propertyRecordSchema.refValueType,
      }))
      // A newer save replaced this one: it writes, and sets the context, instead.
      if (written.skipped) return true
      const result = written.result

      const updatedContext: Partial<PropertyMachineContext> = {
        propertyValue: newValue,
        renderValue: newValue,
      }
      if (localId) updatedContext.localId = localId
      if (schemaUid) updatedContext.schemaUid = schemaUid
      Object.assign(updatedContext, rowContext(result))
      if (!schemaUid && result?.schemaUid) updatedContext.schemaUid = result.schemaUid

      sendBack({ type: 'updateContext', ...updatedContext })
      return true
    }

    // Convert newValue to string for database storage
    const stringValue = newValue !== null && newValue !== undefined 
      ? (typeof newValue === 'string' ? newValue : String(newValue))
      : null

    const written = await timed(`${label} write`, () => writePlainValue({
      localId,
      newValue: stringValue,
      versionLocalId,
      versionUid,
      modelName,
      schemaUid,
      dataType: propertyRecordSchema.dataType,
      refValueType: propertyRecordSchema.refValueType,
    }))
    if (written.skipped) return true
    const result = written.result

    const stringValueForContext =
      typeof newValue === 'string' ? newValue : (newValue !== null && newValue !== undefined ? String(newValue) : undefined)
    const updatedContext: Partial<PropertyMachineContext> = {
      propertyValue: stringValueForContext,
      renderValue: stringValueForContext,
    }

    if (localId) {
      updatedContext.localId = localId
    }

    if (schemaUid) {
      updatedContext.schemaUid = schemaUid
    }

    Object.assign(updatedContext, rowContext(result))

    if (!schemaUid && result?.schemaUid) {
      updatedContext.schemaUid = result.schemaUid
    }

    sendBack({
      type: 'updateContext',
      ...updatedContext,
    })

    return true
  }

  _analyzeInput()
    .finally(() => writeTicket?.end())
    .then((isDone) => {
      if (isDone) {
        sendBack({ type: 'saveValueToDbSuccess' })
      }
    })
    .catch((error: unknown) => {
      sendBack({ type: 'saveFailed', error })
    })
})
