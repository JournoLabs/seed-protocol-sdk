import { metadata, MetadataType } from '@/shared/seedSchema'
import { getAppDb } from '../sqlWasmClient'
import { eq } from 'drizzle-orm'

export const saveMetadata = async (
  metadataRecord: Partial<MetadataType>,
  metadataValues: Partial<MetadataType>,
) => {
  const appDb = getAppDb()

  await appDb
    .update(metadata)
    .set({
      ...metadataValues,
      updatedAt: Date.now(),
    })
    .where(eq(metadata.localId, metadataRecord.localId))
}
