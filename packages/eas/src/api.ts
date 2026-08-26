import { checksumAddress, toSnakeCase } from './utils.js'
import { pickLatestPropertyAttestationsByRefAndSchema } from './easPropertyCanonical.js'
import { withExcludeRevokedFilter } from './easRevokedFilter.js'
import { BaseEasClient } from './EasClient/BaseEasClient.js'
import { BaseQueryClient } from './QueryClient/BaseQueryClient.js'
import { GET_PROPERTIES, GET_SCHEMAS, GET_SEEDS, GET_VERSIONS } from './queries.js'
import type { Attestation, Schema as EASSchema } from './graphql/gql/graphql.js'

export type { Attestation, Schema as EASSchema } from './graphql/gql/graphql.js'

export const getItemVersionsFromEas = async ({
  seedUids,
  excludeRevoked = true,
}: {
  seedUids: string[]
  excludeRevoked?: boolean
}): Promise<Attestation[]> => {
  const queryClient = BaseQueryClient.getQueryClient()
  const easClient = BaseEasClient.getEasClient()

  const where = excludeRevoked
    ? withExcludeRevokedFilter({ refUID: { in: seedUids } })
    : { refUID: { in: seedUids } }

  const { itemVersions } = (await queryClient.fetchQuery({
    queryKey: [`getVersionsForAllModels`, [...seedUids].sort(), excludeRevoked],
    queryFn: async () =>
      easClient.request(GET_VERSIONS, {
        where,
      }),
  })) as { itemVersions: Attestation[] }

  return itemVersions
}

export const getItemPropertiesFromEas = async ({
  versionUids,
  excludeRevoked = true,
}: {
  versionUids: string[]
  excludeRevoked?: boolean
}): Promise<Attestation[]> => {
  const queryClient = BaseQueryClient.getQueryClient()
  const easClient = BaseEasClient.getEasClient()

  const where = excludeRevoked
    ? withExcludeRevokedFilter({ refUID: { in: versionUids } })
    : { refUID: { in: versionUids } }

  const { itemProperties } = (await queryClient.fetchQuery({
    queryKey: [`getPropertiesForAllModels`, [...versionUids].sort(), excludeRevoked],
    queryFn: async () =>
      easClient.request(GET_PROPERTIES, {
        where,
      }),
  })) as { itemProperties: Attestation[] }

  return itemProperties
}

export const getCanonicalItemPropertiesFromEas = async (props: {
  versionUids: string[]
  excludeRevoked?: boolean
}): Promise<Attestation[]> => {
  const itemProperties = await getItemPropertiesFromEas(props)
  return pickLatestPropertyAttestationsByRefAndSchema(itemProperties)
}

export const getEasSchemaUidBySchemaName = async ({
  schemaName,
}: {
  schemaName: string
}): Promise<string | undefined> => {
  try {
    const queryClient = BaseQueryClient.getQueryClient()
    const easClient = BaseEasClient.getEasClient()

    if (!queryClient || !easClient) {
      return undefined
    }

    const { schemas } = (await queryClient.fetchQuery({
      queryKey: [`getEasSchemaUidBySchemaName`],
      queryFn: async () =>
        easClient.request(GET_SCHEMAS, {
          where: {
            schema: {
              endsWith: schemaName,
            },
          },
        }),
    })) as { schemas: Array<{ id: string }> }

    if (!schemas || schemas.length === 0) {
      return undefined
    }

    return schemas[0]!.id
  } catch (error) {
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
      return checksumAddress(a)
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

  const { itemSeeds } = (await queryClient.fetchQuery({
    queryKey: [
      `getSeedsForAllModels`,
      excludeRevoked,
      [...schemaUids].sort(),
      [...addresses].sort(),
    ],
    queryFn: async () =>
      easClient.request(GET_SEEDS, {
        where,
      }),
  })) as { itemSeeds: Attestation[] }

  return itemSeeds
}

export const getSeedsBySchemaName = async (
  schemaName: string,
  limit: number = 10,
  skip?: number,
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

  const { itemSeeds } = (await queryClient.fetchQuery({
    queryKey: [`getSeedsBySchemaName`, schemaName, limit, skipVal],
    queryFn: async () => easClient.request(GET_SEEDS, variables),
  })) as { itemSeeds: Attestation[] }

  return itemSeeds
}

export const getSeedUidsBySchemaName = async (schemaName: string, limit: number = 10) => {
  const itemSeeds = await getSeedsBySchemaName(schemaName, limit)
  return itemSeeds.map((seed: Attestation) => seed.id)
}
