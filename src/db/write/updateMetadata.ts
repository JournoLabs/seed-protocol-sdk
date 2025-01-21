import { metadata, MetadataType } from '@/seedSchema'
import { BaseDb } from '@/db/Db/BaseDb'
import { eq } from 'drizzle-orm'

type UpdateMetadata = (
  metadataValues: Partial<MetadataType>,
) => Promise<MetadataType>

export const updateMetadata: UpdateMetadata = async (metadataValues) => {
  const appDb = BaseDb.getAppDb()

  const { localId, ...rest } = metadataValues

  if (!localId) {
    throw new Error('No localId provided to updateMetadata')
  }

  await appDb.update(metadata).set(rest).where(eq(metadata.localId, localId))
}
