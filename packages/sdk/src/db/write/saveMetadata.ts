import { metadata, MetadataType } from '@/seedSchema'
import { BaseDb } from '@/db/Db/BaseDb'
import { eq } from 'drizzle-orm'

export const saveMetadata = async (
  metadataRecord: Partial<MetadataType>,
  metadataValues: Partial<MetadataType>,
) => {
  if (!metadataRecord.localId) {
    return
  }

  const appDb = BaseDb.getAppDb()

  await appDb
    .update(metadata)
    .set({
      ...metadataValues,
      // Stamped here: a value carried in metadataValues would otherwise win over $onUpdate.
      updatedAt: Date.now(),
    })
    .where(eq(metadata.localId, metadataRecord.localId))
}
