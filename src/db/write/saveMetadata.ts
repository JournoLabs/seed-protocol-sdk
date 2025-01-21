import { metadata, MetadataType } from '@/seedSchema'
import { BaseDb } from '@/db/Db/BaseDb'
import { eq } from 'drizzle-orm'

export const saveMetadata = async (
  metadataRecord: Partial<MetadataType>,
  metadataValues: Partial<MetadataType>,
) => {
  const appDb = BaseDb.getAppDb()

  await appDb
    .update(metadata)
    .set({
      ...metadataValues,
      updatedAt: Date.now(),
    })
    .where(eq(metadata.localId, metadataRecord.localId))
}
