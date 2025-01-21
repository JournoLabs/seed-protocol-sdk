import { Schema, SchemaWhereInput } from '@/graphql/gql/graphql'
import { toSnakeCase, BaseEasClient, BaseQueryClient } from '@/helpers'
import { GET_SCHEMAS } from '@/Item/queries'
import { TypedData } from '@ethereum-attestation-service/eas-sdk/dist/offchain/typed-data-handler'


type GetSchemaForPropertyProps = {
  schemaUid?: string
  propertyName: string
  easDataType?: TypedData['type']
}
type GetSchemaForProperty = (
  props: GetSchemaForPropertyProps,
) => Promise<Schema | void>
export const getSchemaForItemProperty: GetSchemaForProperty = async ({
  schemaUid,
  propertyName,
  easDataType,
}): Promise<Schema | void> => {
  const propertyNameSnakeCase = toSnakeCase(propertyName)
  const isMissingSchemaUid =
    !schemaUid || schemaUid === 'null' || schemaUid === 'undefined'

  const queryClient = BaseQueryClient.getQueryClient()
  const easClient = BaseEasClient.getEasClient()

  let queryParams: { where: SchemaWhereInput } = {
    where: {
      id: {
        equals: schemaUid,
      },
    },
  }

  if (easDataType) {
    queryParams = {
      where: {
        schema: {
          equals: `${easDataType} ${propertyNameSnakeCase}`,
        },
      },
    }
  }

  if (!easDataType && isMissingSchemaUid) {
    queryParams = {
      where: {
        schemaNames: {
          some: {
            name: {
              equals: propertyNameSnakeCase,
            },
          },
        },
      },
    }
  }

  const foundPropertySchema = await queryClient.fetchQuery({
    queryKey: [`getPropertySchema${propertyName}`],
    queryFn: async () => easClient.request(GET_SCHEMAS, queryParams),
    networkMode: 'offlineFirst',
  })

  if (foundPropertySchema && foundPropertySchema.schemas.length > 0) {
    return foundPropertySchema.schemas[0] as Schema
  }
}
