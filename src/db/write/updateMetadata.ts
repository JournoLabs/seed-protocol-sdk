import { metadata, MetadataType } from '@/seedSchema'
import { BaseDb } from '@/db/Db/BaseDb'
import { eq } from 'drizzle-orm'
import { PropertyType } from '@/types'
import { BaseQueryClient } from '@/helpers/QueryClient/BaseQueryClient'
import { BaseEasClient } from '@/helpers/EasClient/BaseEasClient'
import { INTERNAL_DATA_TYPES } from '@/helpers/constants'
import { toSnakeCase } from 'drizzle-orm/casing'
import { Schema } from '@/graphql/gql/graphql'
import { GET_SCHEMA_BY_NAME } from '@/Item/queries'

type UpdateMetadata = (
  metadataValues: Partial<MetadataType>,
  propertyRecordSchema?: PropertyType | undefined,
) => Promise<MetadataType>

export const updateMetadata: UpdateMetadata = async (metadataValues, propertyRecordSchema) => {
  const appDb = BaseDb.getAppDb()

  const { localId, ...rest } = metadataValues

  if (!localId) {
    throw new Error('No localId provided to updateMetadata')
  }
  
  const isItemStorage = propertyRecordSchema && propertyRecordSchema.storageType === 'ItemStorage'

  if (
    !isItemStorage && 
    propertyRecordSchema &&
    (!metadataValues.schemaUid || metadataValues.schemaUid === 'undefined' )
  ) {
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

  await appDb.update(metadata).set(rest).where(eq(metadata.localId, localId))
}
