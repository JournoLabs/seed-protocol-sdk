import { getModels } from "@/db/read/getModels"
import { toSnakeCase } from "@/helpers"
import { BaseEasClient } from "@/helpers/EasClient/BaseEasClient"
import { BaseQueryClient } from "@/helpers/QueryClient/BaseQueryClient"
import { GET_PROPERTIES, GET_SCHEMAS, GET_VERSIONS } from "@/Item/queries"
import { Attestation, Schema } from "@/graphql/gql/graphql"

type GetModelSchemasFromEas = () => Promise<Schema[]>


export const getModelSchemasFromEas: GetModelSchemasFromEas = async () => {
  const queryClient = BaseQueryClient.getQueryClient()
  const easClient = BaseEasClient.getEasClient()

  const models = await getModels()

  const OR: Record<string, unknown>[] = []

  for (const [modelName, _] of Object.entries(models)) {
    OR.push({
      schema: {
        equals: `bytes32 ${toSnakeCase(modelName)}`,
      },
    })

    OR.push({
      schema: {
        equals: `bytes32 image`,
      },
    })
  }

  const modelSchemas = await queryClient.fetchQuery({
    queryKey: [`getSchemasAllModels`],
    queryFn: async () =>
      easClient.request(GET_SCHEMAS, {
        where: {
          OR,
        },
      }),
  })

  if (
    !modelSchemas ||
    !modelSchemas.schemas ||
    modelSchemas.schemas.length === 0
  ) {
    throw new Error(`No schemas found for models`)
  }

  return modelSchemas.schemas
}

type GetItemVersionsFromEasProps = {
  seedUids: string[]
}

type GetItemVersionsFromEas = (
  props: GetItemVersionsFromEasProps,
) => Promise<Attestation[]>


export const getItemVersionsFromEas: GetItemVersionsFromEas = async ({ seedUids }) => {
  const queryClient = BaseQueryClient.getQueryClient()
  const easClient = BaseEasClient.getEasClient()

  const { itemVersions } = await queryClient.fetchQuery({
    queryKey: [`getVersionsForAllModels`],
    queryFn: async () =>
      easClient.request(GET_VERSIONS, {
        where: {
          refUID: {
            in: seedUids,
          },
        },
      }),
  })

  return itemVersions
}

type GetItemPropertiesFromEasProps = {
  versionUids: string[]
}

type GetItemPropertiesFromEas = (
  props: GetItemPropertiesFromEasProps,
) => Promise<Attestation[]>

export const getItemPropertiesFromEas: GetItemPropertiesFromEas = async ({ versionUids }) => {
  const queryClient = BaseQueryClient.getQueryClient()
  const easClient = BaseEasClient.getEasClient()
  
  const { itemProperties } = await queryClient.fetchQuery({
    queryKey: [`getPropertiesForAllModels`],
    queryFn: async () =>
      easClient.request(GET_PROPERTIES, {
        where: {
          refUID: {
            in: versionUids,
          },
        },
      }),
  })

  return itemProperties
}

type GetSchemaUidBySchemaNameProps = {
  schemaName: string
}

type GetSchemaUidBySchemaName = (
  props: GetSchemaUidBySchemaNameProps,
) => Promise<string>

export const getSchemaUidBySchemaName: GetSchemaUidBySchemaName = async ({ schemaName }) => {
  const queryClient = BaseQueryClient.getQueryClient()
  const easClient = BaseEasClient.getEasClient()
  
  const { schemas } = await queryClient.fetchQuery({
    queryKey: [`getSchemaUidBySchemaName`],
    queryFn: async () =>
      easClient.request(GET_SCHEMAS, {
        where: {
          schema: {
            endsWith: schemaName,
          },
        },
      }),
  })

  if (!schemas || schemas.length === 0) {
    throw new Error(`No schemas found for schema name ${schemaName}`)
  }

  return schemas[0].id
}
