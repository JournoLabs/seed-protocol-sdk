import { metadata, MetadataType } from '@/seedSchema'
import { generateId } from '@/helpers'
import { PropertyType } from '@/types'
import { BaseDb } from '../Db/BaseDb'

type CreateMetadata = (
  metadataValues: Partial<MetadataType>,
  propertyRecordSchema?: PropertyType | undefined,
) => Promise<MetadataType>

export const createMetadata: CreateMetadata = async (
  metadataValues,
  propertyRecordSchema?,
) => {
  const appDb = BaseDb.getAppDb()

  metadataValues.localId = generateId()

  if (!metadataValues.modelType && metadataValues.modelName) {
    metadataValues.modelType = metadataValues.modelName.toLowerCase()
  }

  if (
    propertyRecordSchema &&
    propertyRecordSchema.localStorageDir &&
    propertyRecordSchema.storageType === 'ItemStorage'
  ) {
    metadataValues.refResolvedValue = `${metadataValues.seedLocalId}${propertyRecordSchema.filenameSuffix}`
    metadataValues.refValueType = 'file'
  }

  return appDb
    .insert(metadata)
    .values({
      ...metadataValues,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .returning()
}
