import { EventObject, fromCallback } from 'xstate'
import { FromCallbackInput } from '@/types'
import { PropertyMachineContext } from '@/types/property'
import { BaseDb } from '@/db/Db/BaseDb'
import { metadata, models, properties, type MetadataType } from '@/seedSchema'
import { eq, and, or } from 'drizzle-orm'
import { toSnakeCase } from 'drizzle-orm/casing'
import { camelCase, upperFirst } from 'lodash-es'
import { getMetadataLatest } from '@/db/read/subqueries/metadataLatest'
import {
  BaseFileManager,
  getMetadataPropertyNamesForQuery,
  resolveMetadataRecord,
} from '@/helpers'
import { parseListPropertyValueFromStorage } from '@/helpers/listPropertyValueFromStorage'
import { ModelPropertyDataTypes, normalizeDataType } from '@/helpers/property'
import debug from 'debug'
import { downloadTransactionIdWithDedupe } from '@/events/files/download'
import {
  readHtmlBodyForStorageSeedPropertyValue,
  resolveHtmlStorageSeedLocalId,
} from '@/helpers/readHtmlBodyForStorageSeed'
import { updateMetadata } from '@/db/write/updateMetadata'

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
    
    // Html/Image/File/Relation store metadata with Id suffix (e.g. htmlId); query both variants
    const propertyNames = getMetadataPropertyNamesForQuery(propertyName)
    const propertyNameWhere =
      propertyNames.length > 1
        ? or(...propertyNames.map((n) => eq(metadataLatest.propertyName, n)))
        : eq(metadataLatest.propertyName, propertyNames[0])

    const metadataRecords = await db
      .with(metadataLatest)
      .select()
      .from(metadataLatest)
      .where(and(propertyNameWhere, eq(metadataLatest.rowNum, 1)))
      .limit(5)

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
          refSeedType: context.refSeedType,
        },
      })
      return
    }

    // Resolve best metadata record when multiple variants exist (base + Id)
    const metadataRecord = resolveMetadataRecord(
      metadataRecords as (MetadataType & { refResolvedValue?: string | null; refSeedType?: string })[],
      propertyName
    )

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
              id: propRecord.id,
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

    // For Html: read file content for renderValue (propertyValue is seed ID; blob URLs in DB are invalid after reload)
    let renderValue: string | string[] | undefined = metadataRecord.propertyValue || undefined
    const refSeedType = (metadataRecord as { refSeedType?: string }).refSeedType
    const normalizedHtmlDt = normalizeDataType(propertyRecordSchema?.dataType)
    const isHtml =
      refSeedType === 'html' || normalizedHtmlDt === ModelPropertyDataTypes.Html
    // Fallback: derive refResolvedValue/localStorageDir from propertyValue when missing (e.g. EAS sync, legacy data).
    // After publish, propertyValue may be the Html storage seed uid while files stay named `{localId}.html`.
    if (isHtml && !metadataRecord.refResolvedValue && metadataRecord.propertyValue) {
      const lid = await resolveHtmlStorageSeedLocalId(metadataRecord.propertyValue)
      if (lid) {
        metadataRecord.refResolvedValue = `${lid}.html`
        metadataRecord.localStorageDir = '/html'
      }
    }
    // Fallback: when Html has refResolvedValue but localStorageDir is null (e.g. EAS sync, legacy records)
    if (isHtml && metadataRecord.refResolvedValue && !metadataRecord.localStorageDir) {
      metadataRecord.localStorageDir = '/html'
    }
    if (isHtml && metadataRecord.refResolvedValue && metadataRecord.localStorageDir) {
      try {
        const dir = metadataRecord.localStorageDir.replace(/^\//, '')
        const filePath = BaseFileManager.getFilesPath(dir, metadataRecord.refResolvedValue)
        let exists = await BaseFileManager.pathExists(filePath)
        if (!exists) {
          await BaseFileManager.waitForFileWithContent(filePath, 100, 5000).catch(() => {})
          exists = await BaseFileManager.pathExists(filePath)
        }
        if (exists) {
          renderValue = await BaseFileManager.readFileAsString(filePath)
        } else {
          const viaSeedPointer = await readHtmlBodyForStorageSeedPropertyValue(
            metadataRecord.propertyValue,
          )
          if (viaSeedPointer) {
            renderValue = viaSeedPointer
          }
        }
      } catch (e) {
        logger(`Failed to read Html file for ${propertyName}: ${e}`)
      }
    }
    // Covers missing ref row, wrong ref, or DB dataType casing "html" (handled by isHtml above).
    if (isHtml && metadataRecord.propertyValue) {
      const pv = String(metadataRecord.propertyValue).trim()
      const rv = typeof renderValue === 'string' ? renderValue.trim() : ''
      if (!rv || rv === pv) {
        const recovered = await readHtmlBodyForStorageSeedPropertyValue(metadataRecord.propertyValue)
        if (recovered) {
          renderValue = recovered
        }
      }
    }

    // Image: always resolve display value from file (blob URLs in DB are invalid after reload)
    let refResolvedDisplayValue: string | undefined =
      (metadataRecord.refResolvedDisplayValue ?? context.refResolvedDisplayValue) ?? undefined
    const normalizedDataType = normalizeDataType(propertyRecordSchema?.dataType)
    const normalizedRefValueType = normalizeDataType(propertyRecordSchema?.refValueType)
    const isImage =
      refSeedType === 'image' ||
      normalizedDataType === 'Image' ||
      normalizedRefValueType === 'Image'

    const resolveMatchingFilePath = async (dir: string, needle: string): Promise<string | undefined> => {
      const dirPath = BaseFileManager.getFilesPath(dir)
      const dirExists = await BaseFileManager.pathExists(dirPath)
      if (!dirExists) return undefined
      const fs = await BaseFileManager.getFs()
      const path = BaseFileManager.getPathModule()
      const files = await fs.promises.readdir(dirPath)
      const matchingFiles = files.filter((file: string) =>
        path.basename(file).includes(needle)
      )
      if (!matchingFiles?.length) return undefined
      return BaseFileManager.getFilesPath(dir, matchingFiles[0])
    }

    // EAS-synced rows: parent metadata stores the image seed uid in property_value; filename/Arweave id is on the image seed's metadata.
    // hydrateFromDb already repairs this; doing it here avoids a multi-second gap where UI shows a non-blob value until rehydrate runs.
    if (
      isImage &&
      !metadataRecord.refResolvedValue &&
      typeof metadataRecord.propertyValue === 'string' &&
      metadataRecord.propertyValue.length === 66
    ) {
      const storageTxRows = await db
        .select({ propertyValue: metadata.propertyValue })
        .from(metadata)
        .where(
          and(
            eq(metadata.seedUid, metadataRecord.propertyValue),
            or(
              eq(metadata.propertyName, 'storageTransactionId'),
              eq(metadata.propertyName, 'transactionId'),
            ),
          ),
        )
        .limit(1)
      const derivedTxId = storageTxRows[0]?.propertyValue
      if (derivedTxId) {
        metadataRecord.refResolvedValue = derivedTxId
        metadataRecord.localStorageDir = metadataRecord.localStorageDir ?? '/images'
        if (metadataRecord.localId) {
          try {
            await updateMetadata({
              localId: metadataRecord.localId,
              refResolvedValue: derivedTxId,
              localStorageDir: '/images',
            })
          } catch (e) {
            logger(`loadOrCreateProperty: updateMetadata refResolvedValue failed for ${propertyName}:`, e)
          }
        }
      }
    }

    if (isImage && metadataRecord.refResolvedValue) {
      try {
        const dir = (metadataRecord.localStorageDir ?? '/images').replace(/^\//, '')
        let filePath = await resolveMatchingFilePath(dir, metadataRecord.refResolvedValue)
        if (!filePath) {
          await downloadTransactionIdWithDedupe(metadataRecord.refResolvedValue)
          filePath = await resolveMatchingFilePath(dir, metadataRecord.refResolvedValue)
        }
        if (filePath) {
          const file = await BaseFileManager.readFile(filePath)
          const freshBlobUrl = URL.createObjectURL(file)
          renderValue = freshBlobUrl
          refResolvedDisplayValue = freshBlobUrl
        }
      } catch (e) {
        logger(`Failed to resolve Image file for ${propertyName}: ${e}`)
      }
    }

    const isFile =
      refSeedType === 'file' ||
      normalizedDataType === 'File'
    if (isFile && metadataRecord.refResolvedValue) {
      try {
        const dir = (metadataRecord.localStorageDir ?? '/files').replace(/^\//, '')
        let filePath = await resolveMatchingFilePath(dir, metadataRecord.refResolvedValue)
        if (!filePath) {
          await downloadTransactionIdWithDedupe(metadataRecord.refResolvedValue)
          filePath = await resolveMatchingFilePath(dir, metadataRecord.refResolvedValue)
        }
        if (filePath) {
          renderValue = await BaseFileManager.readFileAsString(filePath)
        }
      } catch (e) {
        logger(`Failed to resolve File for ${propertyName}: ${e}`)
      }
    }

    let propertyValueOut: string | string[] | undefined =
      metadataRecord.propertyValue || undefined
    if (normalizedDataType === 'List' && typeof propertyValueOut === 'string') {
      propertyValueOut = parseListPropertyValueFromStorage(propertyValueOut)
      renderValue = propertyValueOut
    }

    // Return loaded property data (use propertyName from context to match schema key, e.g. "html" not "htmlId")
    sendBack({
      type: 'loadOrCreatePropertySuccess',
      property: {
        propertyName,
        propertyValue: propertyValueOut,
        renderValue,
        seedLocalId: metadataRecord.seedLocalId || seedLocalId,
        seedUid: metadataRecord.seedUid || seedUid,
        versionLocalId: metadataRecord.versionLocalId || versionLocalId,
        versionUid: metadataRecord.versionUid || context.versionUid,
        schemaUid: metadataRecord.schemaUid || context.schemaUid,
        localId: metadataRecord.localId || undefined,
        uid: metadataRecord.uid || undefined,
        modelName: modelName || context.modelName,
        propertyRecordSchema,
        refSeedType: refSeedType ?? context.refSeedType,
        refResolvedValue: metadataRecord.refResolvedValue ?? context.refResolvedValue,
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
