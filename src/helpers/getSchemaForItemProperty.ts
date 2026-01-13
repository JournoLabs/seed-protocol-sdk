import { Schema as EASSchema, SchemaWhereInput } from '@/graphql/gql/graphql'
import { toSnakeCase, BaseEasClient, BaseQueryClient } from '@/helpers'
import { GET_SCHEMAS } from '@/Item/queries'
import type { EIP712MessageTypes } from '@ethereum-attestation-service/eas-sdk'

// Extract TypedData type from EIP712MessageTypes
// EIP712MessageTypes is defined as { [key: string]: TypedData[] }
type ExtractTypedData<T> = T extends { [key: string]: infer U }
  ? U extends Array<infer V>
    ? V
    : never
  : never
type TypedData = ExtractTypedData<EIP712MessageTypes>

type GetSchemaForPropertyProps = {
  schemaUid?: string
  propertyName: string
  easDataType?: TypedData['type']
}
type GetSchemaForProperty = (
  props: GetSchemaForPropertyProps,
) => Promise<EASSchema | void>
export const getSchemaForItemProperty: GetSchemaForProperty = async ({
  schemaUid,
  propertyName,
  easDataType,
}): Promise<EASSchema | void> => {
  try {
    const propertyNameSnakeCase = toSnakeCase(propertyName)
    const isMissingSchemaUid =
      !schemaUid || schemaUid === 'null' || schemaUid === 'undefined'

    const queryClient = BaseQueryClient.getQueryClient()
    const easClient = BaseEasClient.getEasClient()

    // If clients are not available, return undefined (schema not found)
    if (!queryClient || !easClient) {
      return
    }

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
      return foundPropertySchema.schemas[0] as EASSchema
    }
  } catch (error) {
    // If schema fetch fails, return undefined (schema not found)
    // This is expected when metadata exists without a published EASSchema
    if (process.env.NODE_ENV === 'development') {
      console.warn(`Failed to fetch schema for property ${propertyName}:`, error)
    }
    return
  }
}
