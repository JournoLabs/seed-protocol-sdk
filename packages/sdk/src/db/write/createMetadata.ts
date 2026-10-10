import { resolveItemModelFileId } from '@/db/read/resolveModelRecord'
import { metadata, MetadataType } from '@/seedSchema'
import { generateId } from '@/helpers'
import { getPropertyIdForModelAndName, getPropertyIdForSchemaFileId } from '@/helpers/db'
import { PropertyType } from '@/types'
import { getPublisherForNewSeedsWithTimeout } from '@/helpers/publishConfig'
import { normalizePublisher } from '@/helpers/addresses'
import { BaseDb } from '../Db/BaseDb'
import { getEasSchemaUidForExactDefinition } from '@/stores/eas'
import { INTERNAL_DATA_TYPES } from '@/helpers/constants'
import { toSnakeCase } from 'drizzle-orm/casing'
import { ModelPropertyDataTypes, normalizeDataType } from '@/helpers/property'
import { listRelationEasPropertyName } from '@/helpers/metadataPropertyNames'

/** Validation error shape for MetadataValidationError */
type MetadataValidationErrorItem = { field: string; message: string; code?: string }

/** Error thrown when metadata validation fails (e.g. enum violation). */
export class MetadataValidationError extends Error {
  constructor(
    message: string,
    public readonly validationErrors: MetadataValidationErrorItem[],
  ) {
    super(message)
    this.name = 'MetadataValidationError'
  }
}

type CreateMetadataOptions = {
  skipValidation?: boolean
  /** schemaFileId of the item's models row; otherwise read from the seed (seeds.model_file_id). */
  modelFileId?: string
}

type CreateMetadata = (
  metadataValues: Partial<MetadataType> & { modelName?: string },
  propertyRecordSchema?: PropertyType | undefined,
  options?: CreateMetadataOptions,
) => Promise<MetadataType>

export const createMetadata: CreateMetadata = async (
  metadataValues,
  propertyRecordSchema?,
  options?,
) => {
  const appDb = BaseDb.getAppDb()

  metadataValues.localId = generateId()

  const publisher = normalizePublisher(await getPublisherForNewSeedsWithTimeout())
  if (publisher) {
    metadataValues.publisher = publisher
  }

  if (!metadataValues.modelType && metadataValues.modelName) {
    metadataValues.modelType = toSnakeCase(metadataValues.modelName)
  }

  // List of Relation rows live under the storage name (authors → authorIdentityIds), never the schema key.
  if (metadataValues.propertyName) {
    const storageName = listRelationEasPropertyName(metadataValues.propertyName, propertyRecordSchema)
    if (storageName) metadataValues.propertyName = storageName
  }

  const isItemStorage = propertyRecordSchema && propertyRecordSchema.storageType === 'ItemStorage'

  // if (
  //   propertyRecordSchema &&
  //   propertyRecordSchema.localStorageDir &&
  //   isItemStorage
  // ) {
  //   const filename = `${metadataValues.seedUid || metadataValues.seedLocalId}${propertyRecordSchema.filenameSuffix}`
  //   const filePath = path.join(propertyRecordSchema.localStorageDir, filename)
  //   await fs.promises.writeFile(filePath, metadataValues.propertyValue)
  //   metadataValues.propertyValue = filename
  //   metadataValues.refValueType = 'file'
  // }

  // Convert propertyValue to string if it's not already (metadata table expects text)
  if (metadataValues.propertyValue !== undefined && metadataValues.propertyValue !== null) {
    if (Array.isArray(metadataValues.propertyValue)) {
      // List values: JSON array is the storage format (String() would give legacy comma-separated ids)
      metadataValues.propertyValue = JSON.stringify(metadataValues.propertyValue)
    } else if (typeof metadataValues.propertyValue !== 'string') {
      metadataValues.propertyValue = String(metadataValues.propertyValue)
    }
  }

  // Validate against property validation rules (enum, pattern, minLength, maxLength) unless skipped
  if (
    !options?.skipValidation &&
    propertyRecordSchema?.validation &&
    metadataValues.propertyValue != null &&
    metadataValues.propertyValue !== ''
  ) {
    const { SchemaValidationService } = await import(
      '@/Schema/service/validation/SchemaValidationService'
    )
    const validationService = new SchemaValidationService()
    const validationResult = validationService.validatePropertyValue(
      metadataValues.propertyValue,
      normalizeDataType(propertyRecordSchema.dataType) as ModelPropertyDataTypes,
      propertyRecordSchema.validation,
      propertyRecordSchema.refValueType
        ? normalizeDataType(String(propertyRecordSchema.refValueType))
        : undefined,
    )
    if (!validationResult.isValid && validationResult.errors.length > 0) {
      const validationErrors: MetadataValidationErrorItem[] = validationResult.errors.map((e) => ({
        field: e.field,
        message: e.message,
        code: e.code,
      }))
      const message = validationErrors.map((e) => e.message).join('; ')
      throw new MetadataValidationError(message, validationErrors)
    }
  }

  if (!isItemStorage && !metadataValues.schemaUid && propertyRecordSchema && metadataValues.propertyName) {
    try {
      if (propertyRecordSchema.dataType) {
        // Type-safe lookup of EAS data type (normalize for case-insensitive schema JSON)
        const dataTypeKey = normalizeDataType(
          propertyRecordSchema.dataType,
        ) as keyof typeof INTERNAL_DATA_TYPES
        const easDataType = INTERNAL_DATA_TYPES[dataTypeKey]?.eas

        if (easDataType) {
          const propertyNameSnakeCase = toSnakeCase(metadataValues.propertyName)
          // Cached, including misses: every item of a model looks up the same property schemas.
          const schemaUid = await getEasSchemaUidForExactDefinition(
            `${easDataType} ${propertyNameSnakeCase}`,
          )
          if (schemaUid) {
            metadataValues.schemaUid = schemaUid
          }
        }
      }
    } catch (error) {
      // If EAS query fails, continue without schemaUid - it's not required for metadata insertion
      // Log error in development but don't throw
      if (process.env.NODE_ENV === 'development') {
        console.warn(`Failed to fetch schemaUid for property ${metadataValues.propertyName}:`, error)
      }
    }
  }

  // Resolve property_id for FK: prefer explicit value, then propertyRecordSchema.id, else lookup.
  // propertyRecordSchema.id is the integer properties.id only when built from a DB row; from schema
  // files and Model it is the schemaFileId string, which must be looked up (Number() gives NaN).
  if (metadataValues.propertyId == null) {
    const schemaId = propertyRecordSchema?.id as unknown
    const modelKey = metadataValues.modelName ?? metadataValues.modelType ?? undefined
    if (typeof schemaId === 'number' && Number.isInteger(schemaId)) {
      metadataValues.propertyId = schemaId
    } else if (modelKey) {
      // Model names are only unique per schema: resolve against the item's own model row.
      const modelFileId = await resolveItemModelFileId({
        modelFileId: options?.modelFileId,
        seedLocalId: metadataValues.seedLocalId,
        seedUid: metadataValues.seedUid,
      })
      if (typeof schemaId === 'string' && schemaId) {
        metadataValues.propertyId =
          (await getPropertyIdForSchemaFileId(modelKey, schemaId, { modelFileId })) ?? undefined
      }
      if (metadataValues.propertyId == null && metadataValues.propertyName) {
        metadataValues.propertyId =
          (await getPropertyIdForModelAndName(modelKey, metadataValues.propertyName, { modelFileId })) ??
          undefined
      }
    }
  }

  let inserted: MetadataType[]
  try {
    inserted = await appDb
      .insert(metadata)
      .values({
        ...metadataValues,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      .returning()
  } catch (error) {
    // Drizzle's message is the full SQL; the driver error that explains it is only on `cause`.
    const cause = (error as { cause?: unknown })?.cause
    const reason = cause instanceof Error ? cause.message : cause != null ? String(cause) : undefined
    throw new Error(
      `Failed to insert metadata for property ${metadataValues.propertyName}` +
        (reason ? `: ${reason}` : `: ${error instanceof Error ? error.message : String(error)}`),
      { cause: error },
    )
  }

  if (!inserted || inserted.length === 0) {
    throw new Error(`Failed to insert metadata record for property ${metadataValues.propertyName}`)
  }

  return inserted[0]
}
