import { metadata, MetadataType } from '@/shared/seedSchema'
import { getAppDb } from '../sqlWasmClient'
import { generateId } from '@/shared/helpers'
import { PropertyType } from '@/types'

type CreateMetadata = (
  metadataValues: Partial<MetadataType>,
  propertyRecordSchema?: PropertyType | undefined,
) => Promise<MetadataType>

export const createMetadata: CreateMetadata = async (
  metadataValues,
  propertyRecordSchema?,
) => {
  const appDb = getAppDb()

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
