// Dynamic import to break circular dependency: syncDbWithEas -> stores/eas -> eas -> Model
import { getAddress } from "ethers"
import { toSnakeCase, withExcludeRevokedFilter } from "@/helpers"
import { BaseEasClient } from "@/helpers/EasClient/BaseEasClient"
import { BaseQueryClient } from "@/helpers/QueryClient/BaseQueryClient"
import { GET_PROPERTIES, GET_SCHEMAS, GET_SEEDS, GET_VERSIONS } from "@/Item/queries"
import { Attestation, Schema as EASSchema } from "@/graphql/gql/graphql"

type GetModelSchemasFromEas = () => Promise<EASSchema[]>


export const getModelSchemasFromEas: GetModelSchemasFromEas = async () => {
  const queryClient = BaseQueryClient.getQueryClient()
  const easClient = BaseEasClient.getEasClient()

  // Dynamic import to break circular dependency
  const modelMod = await import('./Model/Model')
  const { Model } = modelMod
  const allModels = await Model.all()
  const modelNames = allModels.map(m => m.modelName).filter((name): name is string => !!name)

  // If there are no models, return empty array instead of querying
  if (modelNames.length === 0) {
    return []
  }

  const OR: Record<string, unknown>[] = []
  const hasImageModel = modelNames.includes('Image')

  // Add schema queries for each model (exact + case-variant for compatibility)
  for (const modelName of modelNames) {
    const snake = toSnakeCase(modelName)
    OR.push({
      schema: {
        equals: `bytes32 ${snake}`,
      },
    })
    // Fallback: schema may have been registered with model name casing (e.g. "bytes32 Resource")
    const altSchema = `bytes32 ${modelName}`
    if (altSchema !== `bytes32 ${snake}`) {
      OR.push({
        schema: {
          equals: altSchema,
        },
      })
    }
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
  excludeRevoked?: boolean
}

type GetItemVersionsFromEas = (
  props: GetItemVersionsFromEasProps,
) => Promise<Attestation[]>

export const getItemVersionsFromEas: GetItemVersionsFromEas = async ({
  seedUids,
  excludeRevoked = true,
}) => {
  const queryClient = BaseQueryClient.getQueryClient()
  const easClient = BaseEasClient.getEasClient()

  const where = excludeRevoked
    ? withExcludeRevokedFilter({ refUID: { in: seedUids } })
    : { refUID: { in: seedUids } }

  const { itemVersions } = await queryClient.fetchQuery({
    queryKey: [`getVersionsForAllModels`, [...seedUids].sort(), excludeRevoked],
    queryFn: async () =>
      easClient.request(GET_VERSIONS, {
        where,
      }),
  })

  return itemVersions
}

type GetItemPropertiesFromEasProps = {
  versionUids: string[]
  excludeRevoked?: boolean
}

type GetItemPropertiesFromEas = (
  props: GetItemPropertiesFromEasProps,
) => Promise<Attestation[]>

export const getItemPropertiesFromEas: GetItemPropertiesFromEas = async ({
  versionUids,
  excludeRevoked = true,
}) => {
  const queryClient = BaseQueryClient.getQueryClient()
  const easClient = BaseEasClient.getEasClient()

  const where = excludeRevoked
    ? withExcludeRevokedFilter({ refUID: { in: versionUids } })
    : { refUID: { in: versionUids } }

  const { itemProperties } = await queryClient.fetchQuery({
    queryKey: [`getPropertiesForAllModels`, [...versionUids].sort(), excludeRevoked],
    queryFn: async () =>
      easClient.request(GET_PROPERTIES, {
        where,
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

export const getEasSchemaUidBySchemaName: GetSchemaUidBySchemaName = async ({ schemaName }) => {
  try {
    const queryClient = BaseQueryClient.getQueryClient()
    const easClient = BaseEasClient.getEasClient()
    
    if (!queryClient || !easClient) {
      return undefined
    }
    
    const { schemas } = await queryClient.fetchQuery({
      queryKey: [`getEasSchemaUidBySchemaName`],
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


export const getSeedsFromSchemaUids = async ({
  schemaUids,
  addresses,
  excludeRevoked = true,
}: {
  schemaUids: string[]
  addresses: string[]
  excludeRevoked?: boolean
}) => {
  const attesterAddresses = addresses.map((a) => {
    try {
      return getAddress(a)
    } catch {
      return a
    }
  })
  let where: Record<string, unknown> = {
    attester: {
      in: attesterAddresses,
    },
    schemaId: {
      in: schemaUids,
    },
  }

  if (excludeRevoked) {
    where = withExcludeRevokedFilter(where)
  }

  const queryClient = BaseQueryClient.getQueryClient()
  const easClient = BaseEasClient.getEasClient()

  const { itemSeeds } = await queryClient.fetchQuery({
    queryKey: [`getSeedsForAllModels`, excludeRevoked, [...schemaUids].sort(), [...addresses].sort()],
    queryFn: async () =>
      easClient.request(GET_SEEDS, {
        where,
      }),
  })

  return itemSeeds
}

export const getSeedsBySchemaName = async (
  schemaName: string,
  limit: number = 10,
  skip?: number
) => {
  const skipVal = skip ?? 0
  const variables = {
    where: withExcludeRevokedFilter({
      schema: {
        is: {
          schemaNames: {
            some: {
              name: {
                equals: schemaName,
              },
            },
          },
        },
      },
    }),
    take: limit,
    skip: skipVal,
  }

  const queryClient = BaseQueryClient.getQueryClient()
  const easClient = BaseEasClient.getEasClient()

  const { itemSeeds } = await queryClient.fetchQuery({
    queryKey: [`getSeedsBySchemaName`, schemaName, limit, skipVal],
    queryFn: async () =>
      easClient.request(GET_SEEDS, variables),
  })

  return itemSeeds
}

export const getSeedUidsBySchemaName = async (schemaName: string, limit: number = 10) => {
  const { itemSeeds } = await getSeedsBySchemaName(schemaName, limit)
  return itemSeeds.map((seed: Attestation) => seed.id)
}