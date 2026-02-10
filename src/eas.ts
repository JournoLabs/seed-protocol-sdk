// Dynamic import to break circular dependency: syncDbWithEas -> stores/eas -> eas -> Model
import { toSnakeCase } from "@/helpers"
import { BaseEasClient } from "@/helpers/EasClient/BaseEasClient"
import { BaseQueryClient } from "@/helpers/QueryClient/BaseQueryClient"
import { GET_PROPERTIES, GET_SCHEMAS, GET_SEEDS, GET_VERSIONS } from "@/Item/queries"
import { Attestation, Schema as EASSchema } from "@/graphql/gql/graphql"

type GetModelSchemasFromEas = () => Promise<EASSchema[]>


export const getModelSchemasFromEas: GetModelSchemasFromEas = async () => {
  const queryClient = BaseQueryClient.getQueryClient()
  const easClient = BaseEasClient.getEasClient()

  // Dynamic import to break circular dependency
  const { Model } = await import('./Model/Model')
  const allModels = await Model.all()
  const modelNames = allModels.map(m => m.modelName).filter((name): name is string => !!name)

  // If there are no models, return empty array instead of querying
  if (modelNames.length === 0) {
    return []
  }

  const OR: Record<string, unknown>[] = []
  const hasImageModel = modelNames.includes('Image')

  // Add schema queries for each model
  for (const modelName of modelNames) {
    OR.push({
      schema: {
        equals: `bytes32 ${toSnakeCase(modelName)}`,
      },
    })
  }

  // Add bytes32 image schema query only once, and only if Image model exists
  // Image model should now be loaded from SEEDPROTOCOL_Seed_Protocol_v1.json schema
  if (hasImageModel) {
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

  // Return empty array if no schemas found instead of throwing
  // This can happen legitimately when:
  // - Models exist but don't have schemas registered in EAS yet (first-time setup)
  // - Models are loaded but schemas haven't been created/registered yet
  if (
    !modelSchemas ||
    !modelSchemas.schemas ||
    modelSchemas.schemas.length === 0
  ) {
    return []
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
) => Promise<string | undefined>

export const getSchemaUidBySchemaName: GetSchemaUidBySchemaName = async ({ schemaName }) => {
  try {
    const queryClient = BaseQueryClient.getQueryClient()
    const easClient = BaseEasClient.getEasClient()
    
    if (!queryClient || !easClient) {
      return undefined
    }
    
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
      // Return undefined instead of throwing - schema may not be published yet
      return undefined
    }

    return schemas[0].id
  } catch (error) {
    // If query fails, return undefined - schema may not exist or be accessible
    if (process.env.NODE_ENV === 'development') {
      console.warn(`Failed to fetch schema for schema name ${schemaName}:`, error)
    }
    return undefined
  }
}


export const getSeedsFromSchemaUids = async ({ schemaUids, addresses }: { schemaUids: string[], addresses: string[] }) => {
  const AND = [
    {
      OR: [] as Record<string, unknown>[],
    },
  ]

  for (const schemaUid of schemaUids) {
    AND[0].OR.push({
      decodedDataJson: {
        contains: schemaUid,
      },
    })
  }

  const queryClient = BaseQueryClient.getQueryClient()
  const easClient = BaseEasClient.getEasClient()

  const { itemSeeds } = await queryClient.fetchQuery({
    queryKey: [`getSeedsForAllModels`],
    queryFn: async () =>
      easClient.request(GET_SEEDS, {
        where: {
          attester: {
            in: addresses,
          },
          schemaId: {
            in: schemaUids,
          },
          AND,
        },
      }),
  })

  return itemSeeds
}

export const getSeedsBySchemaName = async (schemaName: string, limit: number = 10) => {

  const variables = {
    where: {
      schema: {
        is: {
          schemaNames: {
            some: {
              name: {
                equals: schemaName,
              }
            }
          }
        }
      }
    },
    take: limit
  }

  const queryClient = BaseQueryClient.getQueryClient()
  const easClient = BaseEasClient.getEasClient()

  const { itemSeeds } = await queryClient.fetchQuery({
    queryKey: [`getSeedsBySchemaName`, schemaName, limit],
    queryFn: async () =>
      easClient.request(GET_SEEDS, variables),
  })

  return itemSeeds

}

export const getSeedUidsBySchemaName = async (schemaName: string, limit: number = 10) => {
  const { itemSeeds } = await getSeedsBySchemaName(schemaName, limit)
  return itemSeeds.map((seed: Attestation) => seed.id)
}