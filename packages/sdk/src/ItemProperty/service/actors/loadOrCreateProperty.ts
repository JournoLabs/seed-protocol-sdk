import { EventObject, fromCallback } from 'xstate'
import { FromCallbackInput } from '@/types'
import { PropertyMachineContext } from '@/types/property'
import { BaseDb } from '@/db/Db/BaseDb'
import { metadata, models, properties } from '@/seedSchema'
import { eq, and } from 'drizzle-orm'
import { toSnakeCase } from 'drizzle-orm/casing'
import { camelCase, upperFirst } from 'lodash-es'
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
      // Metadata not found - this is a new property, will be created elsewhere.
      // Still resolve propertyRecordSchema from Model so getSegmentedItemProperties and
      // getPublishPayload can route and attest the property (e.g. title, description).
      let propertyRecordSchema: any = undefined
      const modelNameForNew = context.modelName
      if (modelNameForNew) {
        try {
          const { Model } = await import('../../../Model/Model')
          const { modelPropertiesToObject } = await import('../../../helpers/model')
          const normalizedModelName = upperFirst(camelCase(modelNameForNew))
          let model = Model.getByName(normalizedModelName)
          if (!model?.properties?.length) {
            model = Model.findByModelType(toSnakeCase(modelNameForNew))
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
          propertyValue: context.propertyValue || undefined,
          renderValue: context.renderValue || context.propertyValue || undefined,
          seedLocalId,
          seedUid,
          versionLocalId: versionLocalId || context.versionLocalId,
          versionUid: context.versionUid,
          schemaUid: context.schemaUid,
          localId: undefined,
          uid: undefined,
          modelName: modelNameForNew || context.modelName,
          propertyRecordSchema,
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
        // Normalize snake_case to PascalCase: "test_post" -> "TestPost" (startCase gives "Test Post" which fails)
        const normalizedModelName = upperFirst(camelCase(modelName))
        // Query properties table to get property schema
        const modelRecords = await db
          .select({ id: models.id })
          .from(models)
          .where(eq(models.name, normalizedModelName))
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
            // properties table has refModelId but not refModelName; resolve ref model name when refModelId is set
            let refModelName: string | undefined
            if (propRecord.refModelId != null) {
              const refModelRows = await db
                .select({ name: models.name })
                .from(models)
                .where(eq(models.id, propRecord.refModelId))
                .limit(1)
              refModelName = refModelRows[0]?.name ?? undefined
            }
            propertyRecordSchema = {
              dataType: propRecord.dataType,
              ref: refModelName ?? undefined,
              refValueType: propRecord.refValueType || undefined,
              storageType: propRecord.storageType || undefined,
              localStorageDir: propRecord.localStorageDir || undefined,
              filenameSuffix: propRecord.filenameSuffix || undefined,
              required: (propRecord as { required?: boolean }).required ?? undefined,
            }
            // Merge with schema from file/DB to get validation rules (enum, pattern, etc.) - properties table doesn't store these
            try {
              const { getPropertySchema } = await import('../../../helpers/property')
              let schemaFromFile = await getPropertySchema(normalizedModelName, propertyName)
              if (!schemaFromFile?.validation) {
                // Fallback: get validation from schemaData in database (Schema context may not be loaded yet)
                const { schemas: schemasTable } = await import('../../../seedSchema/SchemaSchema')
                const { modelSchemas } = await import('../../../seedSchema/ModelSchemaSchema')
                const modelSchemaRows = await db
                  .select({ schemaId: modelSchemas.schemaId })
                  .from(modelSchemas)
                  .where(eq(modelSchemas.modelId, modelRecords[0].id))
                  .limit(1)
                if (modelSchemaRows.length > 0 && modelSchemaRows[0].schemaId) {
                  const schemaRows = await db
                    .select({ schemaData: schemasTable.schemaData })
                    .from(schemasTable)
                    .where(eq(schemasTable.id, modelSchemaRows[0].schemaId))
                    .limit(1)
                  if (schemaRows.length > 0 && schemaRows[0].schemaData) {
                    const parsed = JSON.parse(schemaRows[0].schemaData) as { models?: Record<string, { properties?: Record<string, { validation?: unknown }> }> }
                    const modelDef = parsed?.models?.[normalizedModelName]
                    const propDef = modelDef?.properties?.[propertyName]
                    if (propDef?.validation) {
                      propertyRecordSchema = { ...propertyRecordSchema, validation: propDef.validation }
                    }
                  }
                }
              } else {
                propertyRecordSchema = { ...propertyRecordSchema, validation: schemaFromFile.validation }
              }
            } catch {
              // Schema not loaded or lookup failed - continue with DB schema only
            }
          }
        }
      } catch (error) {
        logger(`Error loading propertyRecordSchema from database: ${error}`)
        // Continue without propertyRecordSchema
      }
    }

    // Fix 1: Fallback to in-memory Model when DB doesn't have model/properties yet (e.g. runtime-created model)
    const fromDbBeforeFallback = !!propertyRecordSchema
    if (!propertyRecordSchema && modelName) {
      try {
        const { Model } = await import('../../../Model/Model')
        const { modelPropertiesToObject } = await import('../../../helpers/model')
        const normalizedModelName = upperFirst(camelCase(modelName))
        // Try PascalCase first ("post" -> "Post"); then findByModelType for names with spaces ("new_model" -> "New model")
        let model = Model.getByName(normalizedModelName)
        if (!model?.properties?.length) {
          model = Model.findByModelType(toSnakeCase(modelName))
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
        refResolvedValue: metadataRecord.refResolvedValue ?? context.refResolvedValue,
        refResolvedDisplayValue: metadataRecord.refResolvedDisplayValue ?? context.refResolvedDisplayValue,
        localStorageDir: metadataRecord.localStorageDir ?? context.localStorageDir ?? (propertyRecordSchema?.dataType === 'Image' ? '/images' : undefined),
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
