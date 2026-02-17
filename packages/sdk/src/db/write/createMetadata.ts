import { metadata, MetadataType } from '@/seedSchema'
import { BaseEasClient, BaseQueryClient, generateId } from '@/helpers'
import { PropertyType } from '@/types'
import { BaseDb } from '../Db/BaseDb'
import { GET_SCHEMA_BY_NAME, } from '@/Item/queries'
import { INTERNAL_DATA_TYPES } from '@/helpers/constants'
import { toSnakeCase } from 'drizzle-orm/casing'
import { Schema as EASSchema } from '@/graphql/gql/graphql'


type CreateMetadata = (
  metadataValues: Partial<MetadataType> & { modelName?: string },
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

  // Convert propertyValue to string if it's not already (metadata table expects text)
  if (metadataValues.propertyValue !== undefined && metadataValues.propertyValue !== null) {
    if (typeof metadataValues.propertyValue !== 'string') {
      metadataValues.propertyValue = String(metadataValues.propertyValue)
    }
  }

  if (!isItemStorage && !metadataValues.schemaUid && propertyRecordSchema && metadataValues.propertyName) {
    try {
      const queryClient = BaseQueryClient.getQueryClient()
      const easClient = BaseEasClient.getEasClient()

      if (queryClient && easClient && propertyRecordSchema.dataType) {
        // Type-safe lookup of EAS data type
        const dataTypeKey = propertyRecordSchema.dataType as keyof typeof INTERNAL_DATA_TYPES
        const easDataType = INTERNAL_DATA_TYPES[dataTypeKey]?.eas

        if (easDataType) {
          const propertyNameSnakeCase = toSnakeCase(metadataValues.propertyName)
        
          const queryResult = await queryClient.fetchQuery({
            queryKey: [`getSchemaByName${metadataValues.propertyName}`],
            queryFn: async (): Promise<{schemas: EASSchema[]}> =>
              easClient.request(GET_SCHEMA_BY_NAME, {
                where: {
                  schema: {
                    equals: `${easDataType} ${propertyNameSnakeCase}`,
                  },
                },
              }),
          })

          // Handle both { schemas: [...] } and { data: { schemas: [...] } } formats
          const schemas = queryResult?.schemas || (queryResult as any)?.data?.schemas
          if (schemas && Array.isArray(schemas) && schemas.length > 0) {
            metadataValues.schemaUid = schemas[0].id
          }
        }
      }
    } catch (error) {
      // If EAS query fails, continue without schemaUid - it's not required for metadata insertion
      // Log error in development but don't throw
      if (process.env.NODE_ENV === 'development') {
        console.warn(`Failed to fetch schemaUid for property ${metadataValues.propertyName}:`, error)
      }
    }
  }

  const inserted = await appDb
    .insert(metadata)
    .values({
      ...metadataValues,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .returning()

  if (!inserted || inserted.length === 0) {
    throw new Error(`Failed to insert metadata record for property ${metadataValues.propertyName}`)
  }

  return inserted[0]
}
