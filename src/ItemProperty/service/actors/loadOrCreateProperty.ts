import { EventObject, fromCallback } from 'xstate'
import { FromCallbackInput } from '@/types'
import { PropertyMachineContext } from '@/types/property'
import { BaseDb } from '@/db/Db/BaseDb'
import { metadata, models, properties } from '@/seedSchema'
import { eq, and } from 'drizzle-orm'
import { getMetadataLatest } from '@/db/read/subqueries/metadataLatest'
import debug from 'debug'

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

    // Use getMetadataLatest subquery pattern to get the latest metadata record for the property
    const metadataLatest = getMetadataLatest({ 
      seedLocalId: seedLocalId ?? undefined, 
      seedUid: seedUid ?? undefined 
    })
    
    const metadataRecords = await db
      .with(metadataLatest)
      .select()
      .from(metadataLatest)
      .where(
        and(
          eq(metadataLatest.propertyName, propertyName),
          eq(metadataLatest.rowNum, 1)
        )
      )
      .limit(1)

    if (metadataRecords.length === 0) {
      // Metadata not found - this is a new property, will be created elsewhere
      logger(`Metadata not found in database for propertyName: ${propertyName}, seedLocalId: ${seedLocalId}`)
      sendBack({
        type: 'loadOrCreatePropertySuccess',
        property: {
          propertyName,
          propertyValue: context.propertyValue || undefined,
          renderValue: context.renderValue || context.propertyValue || undefined,
          seedLocalId,
          seedUid,
          versionLocalId: versionLocalId || context.versionLocalId,
          versionUid: context.versionUid,
          schemaUid: context.schemaUid,
          localId: undefined,
          uid: undefined,
        },
      })
      return
    }

    const metadataRecord = metadataRecords[0]

    // Load propertyRecordSchema from database to make ItemProperty independent from Model
    let propertyRecordSchema: any = undefined
    const modelName = metadataRecord.modelType || context.modelName
    if (modelName) {
      try {
        // Query properties table to get property schema
        const modelRecords = await db
          .select({ id: models.id })
          .from(models)
          .where(eq(models.name, modelName))
          .limit(1)

        if (modelRecords.length > 0 && modelRecords[0].id) {
          const propertyRecords = await db
            .select()
            .from(properties)
            .where(
              and(
                eq(properties.modelId, modelRecords[0].id),
                eq(properties.name, propertyName)
              )
            )
            .limit(1)

          if (propertyRecords.length > 0) {
            const propRecord = propertyRecords[0]
            propertyRecordSchema = {
              dataType: propRecord.dataType,
              ref: propRecord.refModelName || undefined,
              refValueType: propRecord.refValueType || undefined,
              storageType: propRecord.storageType || undefined,
              localStorageDir: propRecord.localStorageDir || undefined,
              filenameSuffix: propRecord.filenameSuffix || undefined,
            }
          }
        }
      } catch (error) {
        logger(`Error loading propertyRecordSchema from database: ${error}`)
        // Continue without propertyRecordSchema
      }
    }

    // Return loaded property data
    sendBack({
      type: 'loadOrCreatePropertySuccess',
      property: {
        propertyName: metadataRecord.propertyName || propertyName,
        propertyValue: metadataRecord.propertyValue || undefined,
        renderValue: metadataRecord.propertyValue || undefined,
        seedLocalId: metadataRecord.seedLocalId || seedLocalId,
        seedUid: metadataRecord.seedUid || seedUid,
        versionLocalId: metadataRecord.versionLocalId || versionLocalId,
        versionUid: metadataRecord.versionUid || context.versionUid,
        schemaUid: metadataRecord.schemaUid || context.schemaUid,
        localId: metadataRecord.localId || undefined,
        uid: metadataRecord.uid || undefined,
        modelName: modelName || context.modelName,
        propertyRecordSchema,
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
