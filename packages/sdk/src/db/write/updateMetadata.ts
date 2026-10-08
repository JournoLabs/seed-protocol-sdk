import { metadata, MetadataType } from '@/seedSchema'
import { BaseDb } from '@/db/Db/BaseDb'
import { eq } from 'drizzle-orm'
import { PropertyType } from '@/types'
import { INTERNAL_DATA_TYPES } from '@/helpers/constants'
import { toSnakeCase } from 'drizzle-orm/casing'
import { getEasSchemaUidForExactDefinition } from '@/stores/eas'
import { normalizeDataType } from '@/helpers/property'
import { normalizePublisher } from '@/helpers/addresses'

type UpdateMetadata = (
  metadataValues: Partial<MetadataType>,
  propertyRecordSchema?: PropertyType | undefined,
) => Promise<MetadataType>

export const updateMetadata: UpdateMetadata = async (metadataValues, propertyRecordSchema) => {
  const appDb = BaseDb.getAppDb()

  const { localId, ...rest } = metadataValues

  if (!localId) {
    throw new Error('No localId provided to updateMetadata')
  }

  // Publisher is immutable once set: do not overwrite existing publisher
  if (rest.publisher != null && rest.publisher !== '') {
    rest.publisher = normalizePublisher(rest.publisher) ?? rest.publisher
    const [row] = await appDb
      .select({ publisher: metadata.publisher })
      .from(metadata)
      .where(eq(metadata.localId, localId))
      .limit(1)
    if (row?.publisher != null && row.publisher !== '') {
      delete rest.publisher
    }
  }
  
  const isItemStorage = propertyRecordSchema && propertyRecordSchema.storageType === 'ItemStorage'

  // Convert propertyValue to string if it's not already (metadata table expects text)
  if (rest.propertyValue !== undefined && rest.propertyValue !== null) {
    if (typeof rest.propertyValue !== 'string') {
      rest.propertyValue = String(rest.propertyValue)
    }
  }

  if (
    !isItemStorage && 
    propertyRecordSchema &&
    metadataValues.propertyName &&
    (!metadataValues.schemaUid || metadataValues.schemaUid === 'undefined' )
  ) {
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
            rest.schemaUid = schemaUid
          }
        }
      }
    } catch (error) {
      // If EAS query fails, continue without schemaUid - it's not required for metadata update
      // Log error in development but don't throw
      if (process.env.NODE_ENV === 'development') {
        console.warn(`Failed to fetch schemaUid for property ${metadataValues.propertyName}:`, error)
      }
    }
  }

  const updated = await appDb
    .update(metadata)
    .set(rest)
    .where(eq(metadata.localId, localId))
    .returning()

  return updated[0]
}
