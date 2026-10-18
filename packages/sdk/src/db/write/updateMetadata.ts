import { metadata, MetadataType } from '@/seedSchema'
import { BaseDb } from '@/db/Db/BaseDb'
import { eq } from 'drizzle-orm'
import { PropertyType } from '@/types'
import { resolveMetadataSchemaUid } from './createMetadata'
import { normalizePublisher } from '@/helpers/addresses'

type UpdateMetadata = (
  metadataValues: Partial<MetadataType>,
  propertyRecordSchema?: PropertyType | undefined,
  options?: {
    /**
     * The database or transaction to write and read; the app database by default. With one, the
     * EAS schema uid isn't looked up: set `schemaUid` (resolveMetadataSchemaUid) beforehand.
     */
    db?: ReturnType<typeof BaseDb.getAppDb>
  },
) => Promise<MetadataType>

export const updateMetadata: UpdateMetadata = async (metadataValues, propertyRecordSchema, options) => {
  const appDb = options?.db ?? BaseDb.getAppDb()

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

  // With a given db (a transaction), the caller resolves schemaUid first: the lookup may call EAS.
  // Without one it isn't required for a metadata update, so a failed lookup leaves it unset.
  if (
    !options?.db &&
    !isItemStorage &&
    metadataValues.propertyName &&
    (!metadataValues.schemaUid || metadataValues.schemaUid === 'undefined')
  ) {
    const schemaUid = await resolveMetadataSchemaUid(metadataValues.propertyName, propertyRecordSchema)
    if (schemaUid) {
      metadataValues.schemaUid = schemaUid
      rest.schemaUid = schemaUid
    }
  }

  const updated = await appDb
    .update(metadata)
    .set(rest)
    .where(eq(metadata.localId, localId))
    .returning()

  return updated[0]
}
