import { metadata, MetadataType } from '@/seedSchema'
import { BaseEasClient, BaseQueryClient, generateId } from '@/helpers'
import { PropertyType } from '@/types'
import { BaseDb } from '../Db/BaseDb'
import { GET_SCHEMA_BY_NAME, } from '@/Item/queries'
import { INTERNAL_DATA_TYPES } from '@/helpers/constants'
import { toSnakeCase } from 'drizzle-orm/casing'
import { Schema } from '@/graphql/gql/graphql'
import path from 'path'
import fs from '@zenfs/core'

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
    metadataValues.modelType = toSnakeCase(metadataValues.modelName)
  }

  const isItemStorage = propertyRecordSchema && propertyRecordSchema.storageType === 'ItemStorage'

  // if (
  //   propertyRecordSchema &&
  //   propertyRecordSchema.localStorageDir &&
  //   isItemStorage
  // ) {
  //   const filename = `${metadataValues.seedUid || metadataValues.seedLocalId}${propertyRecordSchema.filenameSuffix}`
  //   const filePath = path.join(propertyRecordSchema.localStorageDir, filename)
  //   await fs.promises.writeFile(filePath, metadataValues.propertyValue)
  //   metadataValues.propertyValue = filename
  //   metadataValues.refValueType = 'file'
  // }

  if (!isItemStorage && !metadataValues.schemaUid && propertyRecordSchema) {
    const queryClient = BaseQueryClient.getQueryClient()
    const easClient = BaseEasClient.getEasClient()

    const easDataType = INTERNAL_DATA_TYPES[propertyRecordSchema.dataType].eas

    const propertyNameSnakeCase = toSnakeCase(metadataValues.propertyName)
  
    const queryResult = await queryClient.fetchQuery({
      queryKey: [`getSchemaByName${metadataValues.propertyName}`],
      queryFn: async (): Promise<{schemas: Schema[]}> =>
        easClient.request(GET_SCHEMA_BY_NAME, {
          where: {
            schema: {
              equals: `${easDataType} ${propertyNameSnakeCase}`,
            },
          },
        }),
    })

    if (queryResult && queryResult.schemas.length > 0) {
      metadataValues.schemaUid = queryResult.schemas[0].id
    }

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
