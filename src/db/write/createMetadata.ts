import { metadata, MetadataType } from '@/seedSchema'
import { BaseEasClient, BaseQueryClient, generateId } from '@/helpers'
import { PropertyType } from '@/types'
import { BaseDb } from '../Db/BaseDb'
import { GET_SCHEMA_BY_NAME, GET_SCHEMAS } from '@/Item/queries'
import { INTERNAL_DATA_TYPES } from '@/helpers/constants'

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

  const isItemStorage = propertyRecordSchema && propertyRecordSchema.storageType === 'ItemStorage'

  if (
    propertyRecordSchema &&
    propertyRecordSchema.localStorageDir &&
    isItemStorage
  ) {
    metadataValues.refResolvedValue = `${metadataValues.seedUid || metadataValues.seedLocalId}${propertyRecordSchema.filenameSuffix}`
    metadataValues.refValueType = 'file'
  }

  if (!isItemStorage && !metadataValues.schemaUid && propertyRecordSchema) {
    const queryClient = BaseQueryClient.getQueryClient()
    const easClient = BaseEasClient.getEasClient()

    const easDataType = INTERNAL_DATA_TYPES[propertyRecordSchema.dataType].eas
  
    const queryResult = await queryClient.fetchQuery({
      queryKey: [`getSchemaByName${metadataValues.propertyName}`],
      queryFn: async () =>
        easClient.request(GET_SCHEMA_BY_NAME, {
          where: {
            schema: {
              equals: `${easDataType} ${metadataValues.propertyName}`,
            },
          },
        }),
    })

    metadataValues.schemaUid = queryResult.data[0].schema
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
