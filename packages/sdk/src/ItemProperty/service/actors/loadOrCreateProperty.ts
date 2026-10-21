import { EventObject, fromCallback } from 'xstate'
import { FromCallbackInput } from '@/types'
import { PropertyMachineContext } from '@/types/property'
import { BaseDb } from '@/db/Db/BaseDb'
import { easName } from '@seedprotocol/eas'
import { parseListPropertyValueFromStorage } from '@/helpers/listPropertyValueFromStorage'
import { normalizeDataType } from '@/helpers/property'
import debug from 'debug'
import { timingMarks } from '@/helpers/timing'
import { resolveStorageDisplay, storedValueKind } from '@/storageValue/resolve'

const logger = debug('seedSdk:itemProperty:actors:loadOrCreateProperty')

export const loadOrCreateProperty = fromCallback<
  EventObject,
  FromCallbackInput<PropertyMachineContext>
>(({ sendBack, input: { context } }) => {
  const _loadOrCreateProperty = async (): Promise<void> => {
    const { seedLocalId, seedUid, propertyName, versionLocalId } = context

    logger(`loadOrCreateProperty called for propertyName: ${propertyName}, seedLocalId: ${seedLocalId}, seedUid: ${seedUid}`)

    if (!seedLocalId && !seedUid) {
      throw new Error('seedLocalId or seedUid is required')
    }

    if (!propertyName) {
      throw new Error('propertyName is required')
    }

    const db = BaseDb.getAppDb()
    if (!db) {
      throw new Error('Database not available')
    }
    const timing = timingMarks()
    const timingLabel = `property ${seedLocalId ?? seedUid} ${propertyName} loadOrCreateProperty`

    // The row that holds the property's value, a pending outbox value over it (ADR 0019)
    const { currentPropertyRow } = await import('@/db/read/currentPropertyRow')
    const metadataRecord = await currentPropertyRow(
      { seedLocalId, seedUid },
      {
        propertyId: context.propertyId,
        propertyName,
        modelName: context.modelName,
        modelFileId: context.modelFileId,
      },
    )
    timing.mark('metadata')

    if (!metadataRecord) {
      // Metadata not found - this is a new property, will be created elsewhere.
      // Still resolve propertyRecordSchema from Model so getSegmentedItemProperties and
      // getPublishPayload can route and attest the property (e.g. title, description).
      let propertyRecordSchema: any = undefined
      const modelNameForNew = context.modelName
      if (modelNameForNew) {
        try {
          const { Model } = await import('../../../Model/Model')
          const { modelPropertiesToObject } = await import('../../../helpers/model')
          const { resolveItemModelFileId, modelNameForType } = await import('../../../db/read/resolveModelRecord')
          const itemModelFileId = await resolveItemModelFileId({
            modelFileId: context.modelFileId,
            seedLocalId,
            seedUid,
          })
          const normalizedModelName =
            (await modelNameForType(modelNameForNew, { modelFileId: itemModelFileId }).catch(() => undefined)) ??
            modelNameForNew
          let model = await Model.resolveAsync(normalizedModelName, { modelFileId: itemModelFileId })
          if (!model?.properties?.length && !itemModelFileId) {
            model = Model.findByModelType(easName(modelNameForNew))
          }
          if (model?.properties?.length) {
            const schemas = modelPropertiesToObject(model.properties)
            propertyRecordSchema = schemas[propertyName]
            if (propertyRecordSchema) {
              logger(`Metadata not found: loaded propertyRecordSchema from Model for propertyName "${propertyName}"`)
            }
          }
        } catch (error) {
          logger(`Metadata not found: Model fallback failed for propertyName "${propertyName}": ${error}`)
        }
      }
      logger(`Metadata not found in database for propertyName: ${propertyName}, seedLocalId: ${seedLocalId}`)
      sendBack({
        type: 'loadOrCreatePropertySuccess',
        property: {
          propertyName,
          propertyValue: context.propertyValue,
          renderValue: context.renderValue || context.propertyValue,
          seedLocalId,
          seedUid,
          versionLocalId: versionLocalId || context.versionLocalId,
          versionUid: context.versionUid,
          schemaUid: context.schemaUid,
          localId: undefined,
          uid: undefined,
          modelName: modelNameForNew || context.modelName,
          propertyRecordSchema,
          refSeedType: context.refSeedType,
        },
      })
      return
    }

    // Load propertyRecordSchema from database to make ItemProperty independent from Model
    let propertyRecordSchema: any = undefined
    // Model names are only unique per schema: pin lookups to the item's own model row.
    const { resolveItemModelFileId, modelNameForType } = await import('../../../db/read/resolveModelRecord')
    const modelFileId = await resolveItemModelFileId({
      modelFileId: context.modelFileId,
      seedLocalId: seedLocalId ?? metadataRecord.seedLocalId,
      seedUid: seedUid ?? metadataRecord.seedUid,
      propertyId: metadataRecord.propertyId,
    })
    timing.mark('model file id')
    // metadata.modelType is the EAS model type ("test_post"), not the model name ("TestPost"); it
    // ends up in the context below, so map it (and a context name) to the model it names.
    const modelNameOrType = context.modelName || metadataRecord.modelType || undefined
    const modelName = modelNameOrType
      ? ((await modelNameForType(modelNameOrType, { modelFileId }).catch(() => undefined)) ?? modelNameOrType)
      : undefined
    if (modelName) {
      try {
        // One read for the whole model, shared by the item's other properties loading now
        const { loadModelPropertyRecordSchemas } = await import('./modelPropertyRecordSchemas')
        const schemas = await loadModelPropertyRecordSchemas(modelName, modelFileId, db)
        propertyRecordSchema = schemas.get(propertyName)
        timing.mark('model schema')
      } catch (error) {
        logger(`Error loading propertyRecordSchema from database: ${error}`)
        // Continue without propertyRecordSchema
      }
    }

    // Fix 1: Fallback to in-memory Model when DB doesn't have model/properties yet (e.g. runtime-created model)
    if (!propertyRecordSchema && modelName) {
      try {
        const { Model } = await import('../../../Model/Model')
        const { modelPropertiesToObject } = await import('../../../helpers/model')
        // Try the name first ("post" -> "Post"); then findByModelType for names with spaces ("new_model" -> "New model")
        let model = Model.resolve(modelName, { modelFileId })
        if (!model?.properties?.length && !modelFileId) {
          model = Model.findByModelType(easName(modelName))
        }
        if (model?.properties?.length) {
          const schemas = modelPropertiesToObject(model.properties)
          propertyRecordSchema = schemas[propertyName]
          if (propertyRecordSchema) {
            logger(`Fallback: loaded propertyRecordSchema from Model for propertyName "${propertyName}"`)
          }
        }
      } catch (error) {
        logger(`Fallback Model lookup failed for propertyName "${propertyName}": ${error}`)
      }
    }

    // A file's display: a session URL for an Image or File, the text of an Html body, fetched when
    // it isn't on disk. ItemStorage content is read by the display subscriber.
    let renderValue: string | string[] | undefined = metadataRecord.propertyValue || undefined
    const refSeedType = metadataRecord.refSeedType ?? undefined
    const normalizedDataType = normalizeDataType(propertyRecordSchema?.dataType)
    const kind = storedValueKind(propertyRecordSchema, metadataRecord)
    // A stored display value is a dead blob: URL after reload (or a file:// URL that breaks when
    // filesDir moves): Image, File and Html never read it.
    let refResolvedDisplayValue: string | undefined =
      kind === 'image' || kind === 'file'
        ? context.refResolvedDisplayValue ?? undefined
        : kind === 'html'
          ? undefined
          : (metadataRecord.refResolvedDisplayValue ?? context.refResolvedDisplayValue) ?? undefined
    if (kind && kind !== 'itemStorage') {
      try {
        const display = await resolveStorageDisplay(kind, metadataRecord, { fetch: true })
        metadataRecord.refResolvedValue = display.ref.refResolvedValue ?? null
        metadataRecord.localStorageDir = display.ref.localStorageDir ?? null
        if (display.renderValue !== undefined) {
          renderValue = display.renderValue
          if (kind !== 'html') refResolvedDisplayValue = display.renderValue
        }
      } catch (e) {
        logger(`Failed to resolve the ${kind} file for ${propertyName}: ${e}`)
      }
    }

    let propertyValueOut: string | string[] | undefined =
      metadataRecord.propertyValue || undefined
    if (normalizedDataType === 'List' && typeof propertyValueOut === 'string') {
      propertyValueOut = parseListPropertyValueFromStorage(propertyValueOut)
      renderValue = propertyValueOut
    }

    // A stored row with no value is a cleared property (ADR 0021): send null so the machine drops
    // what context held (undefined keeps it).
    const cleared = metadataRecord.propertyValue === null && !metadataRecord.refResolvedValue

    timing.mark('value')
    timing.log(timingLabel)
    // Return loaded property data (use propertyName from context to match schema key, e.g. "html" not "htmlId")
    sendBack({
      type: 'loadOrCreatePropertySuccess',
      property: {
        propertyName,
        propertyValue: propertyValueOut ?? (cleared ? null : undefined),
        renderValue: renderValue ?? (cleared ? null : undefined),
        seedLocalId: metadataRecord.seedLocalId || seedLocalId,
        seedUid: metadataRecord.seedUid || seedUid,
        versionLocalId: metadataRecord.versionLocalId || versionLocalId,
        versionUid: metadataRecord.versionUid || context.versionUid,
        schemaUid: metadataRecord.schemaUid || context.schemaUid,
        localId: metadataRecord.localId || undefined,
        uid: metadataRecord.uid || undefined,
        modelName: modelName || context.modelName,
        modelFileId: modelFileId ?? context.modelFileId,
        propertyRecordSchema,
        refSeedType: refSeedType ?? context.refSeedType,
        refResolvedValue: metadataRecord.refResolvedValue ?? (cleared ? null : context.refResolvedValue),
        refResolvedDisplayValue,
        localStorageDir: metadataRecord.localStorageDir ?? context.localStorageDir ?? (normalizedDataType === 'Image' ? '/images' : undefined),
      },
    })
  }

  _loadOrCreateProperty().catch((error) => {
    logger(`Error in loadOrCreateProperty: ${error}`)
    sendBack({
      type: 'loadOrCreatePropertyError',
      error: error instanceof Error ? error.message : String(error),
    })
  })
})
