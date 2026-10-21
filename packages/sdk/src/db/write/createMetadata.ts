import { metadata, MetadataType } from '@/seedSchema'
import { generateId } from '@/helpers'
import { resolveMetadataProperty } from '@/db/read/metadataProperty'
import { PropertyType } from '@/types'
import { getSeedPublisher } from '@/db/read/getSeedPublisher'
import { BaseDb } from '../Db/BaseDb'
import { lookupPropertySchemaUid } from '@/helpers/propertySchemaUid'
import { easName } from '@seedprotocol/eas'
import { ModelPropertyDataTypes, normalizeDataType } from '@/helpers/property'
import { metadataStorageName } from '@/helpers/metadataPropertyNames'

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
  /**
   * The database or transaction to write and read; the app database by default. With one, the EAS
   * schema uid isn't looked up: set `schemaUid` (resolveMetadataSchemaUid) beforehand.
   */
  db?: ReturnType<typeof BaseDb.getAppDb>
  /** schemaFileId of the item's models row; otherwise read from the seed (seeds.model_file_id). */
  modelFileId?: string
}

type CreateMetadata = (
  metadataValues: Partial<MetadataType> & { modelName?: string },
  propertyRecordSchema?: PropertyType | undefined,
  options?: CreateMetadataOptions,
) => Promise<MetadataType>

/**
 * The EAS schema uid a metadata row of this property takes, from the property's data type and EAS
 * name. Undefined for a data type with no EAS type or when the lookup fails. May call EAS, so run
 * it before a transaction, not inside one.
 */
/** The property's EAS schema UID from the shared lookup cache (lookupPropertySchemaUid). */
export const resolveMetadataSchemaUid = async (
  propertyName: string,
  propertyRecordSchema: PropertyType | undefined,
): Promise<string | undefined> =>
  lookupPropertySchemaUid(propertyName, propertyRecordSchema as Parameters<typeof lookupPropertySchemaUid>[1])

export const createMetadata: CreateMetadata = async (
  metadataValues,
  propertyRecordSchema?,
  options?,
) => {
  const appDb = options?.db ?? BaseDb.getAppDb()

  metadataValues.localId = generateId()

  // A property row belongs to its seed's wallet (none yet for a draft made with no wallet connected).
  const publisher = await getSeedPublisher(metadataValues.seedLocalId, appDb)
  if (publisher) {
    metadataValues.publisher = publisher
  }

  if (!metadataValues.modelType && metadataValues.modelName) {
    metadataValues.modelType = easName(metadataValues.modelName)
  }

  // property_id is the match key (decision D4); the row is written under the property's storage name.
  const property = await resolveMetadataProperty(
    {
      propertyId: metadataValues.propertyId,
      definitionId: propertyRecordSchema?.id as string | number | undefined,
      propertyName: metadataValues.propertyName,
      modelName: metadataValues.modelName ?? metadataValues.modelType,
      modelFileId: options?.modelFileId,
      seedLocalId: metadataValues.seedLocalId,
      seedUid: metadataValues.seedUid,
    },
    appDb,
    { onAmbiguousModel: 'none' },
  )
  if (property) {
    metadataValues.propertyId = property.id
    metadataValues.propertyName = property.storageName
  } else if (metadataValues.propertyName && propertyRecordSchema) {
    metadataValues.propertyName = metadataStorageName(metadataValues.propertyName, propertyRecordSchema)
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

  // With a given db (a transaction), the caller resolves schemaUid first: the lookup may call EAS.
  // Without one it isn't required for metadata insertion, so a failed lookup leaves it unset.
  if (!options?.db && !isItemStorage && !metadataValues.schemaUid && metadataValues.propertyName) {
    const schemaUid = await resolveMetadataSchemaUid(metadataValues.propertyName, propertyRecordSchema)
    if (schemaUid) metadataValues.schemaUid = schemaUid
  }

  let inserted: MetadataType[]
  try {
    inserted = await appDb
      .insert(metadata)
      .values({
        ...metadataValues,
        // Stamped here: a value carried in metadataValues would otherwise win over the column default.
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
