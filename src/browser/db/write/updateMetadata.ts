import { metadata, MetadataType } from '@/shared/seedSchema'
import { getAppDb } from '../sqlWasmClient'
import { eq } from 'drizzle-orm'

type UpdateMetadata = (
  metadataValues: Partial<MetadataType>,
) => Promise<MetadataType>

export const updateMetadata: UpdateMetadata = async (metadataValues) => {
  const appDb = getAppDb()

  const { localId, ...rest } = metadataValues

  if (!localId) {
    throw new Error('No localId provided to updateMetadata')
  }

  await appDb.update(metadata).set(rest).where(eq(metadata.localId, localId))
}
