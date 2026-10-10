import { checksumAddress, toSnakeCase } from './utils.js'
import { pickLatestPropertyAttestationsByRefAndSchema } from './easPropertyCanonical.js'
import { withExcludeRevokedFilter } from './easRevokedFilter.js'
import { BaseEasClient } from './EasClient/BaseEasClient.js'
import { BaseQueryClient } from './QueryClient/BaseQueryClient.js'
import { getEasEndpoint } from './easEndpoint.js'
import {
  GET_PROPERTIES,
  GET_SCHEMAS,
  GET_SEEDS,
  GET_ATTESTATION_CHANGES,
  GET_SEEDS_LEAN,
  GET_VERSIONS,
} from './queries.js'
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

/**
 * UID of the first EAS schema whose definition ends with `schemaName`, or undefined when there is
 * none or the EAS clients aren't configured. Throws when the request fails.
 */
export const fetchEasSchemaUidBySchemaName = async ({
  schemaName,
}: {
  schemaName: string
}): Promise<string | undefined> => {
  const queryClient = BaseQueryClient.getQueryClient()
  const easClient = BaseEasClient.getEasClient()

  if (!queryClient || !easClient) {
    return undefined
  }

  const { schemas } = (await queryClient.fetchQuery({
    queryKey: [`getEasSchemaUidBySchemaName`, schemaName],
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
}

export const getEasSchemaUidBySchemaName = async ({
  schemaName,
}: {
  schemaName: string
}): Promise<string | undefined> => {
  try {
    return await fetchEasSchemaUidBySchemaName({ schemaName })
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
    queryFn: async () => easClient.request(GET_SEEDS_LEAN, variables),
  })) as { itemSeeds: Attestation[] }

  // Every seed matched `schemaName`, so it is attached here instead of selected (see GET_SEEDS_LEAN).
  return itemSeeds.map((seed) => withSchemaNames(seed, [schemaName]))
}

const withSchemaNames = (seed: Attestation, names: string[]): Attestation =>
  ({ ...seed, schema: { schemaNames: names.map((name) => ({ name })) } }) as Attestation

/** Found schema names by endpoint and schema UID. A schema's names don't change once found. */
const schemaNamesBySchemaUid = new Map<string, string[]>()

const schemaNamesCacheKey = (schemaUid: string): string => {
  let endpoint = ''
  try {
    endpoint = getEasEndpoint()
  } catch {
    // Misconfigured chain: the request itself will fail.
  }
  return `${endpoint}\n${schemaUid.toLowerCase()}`
}

/** Clears the schema-name cache of getSchemaNamesBySchemaUids. For tests. */
export const resetSchemaNamesCache = (): void => {
  schemaNamesBySchemaUid.clear()
}

/**
 * Names of each EAS schema in `schemaUids`, in EAS order, keyed by the UID as given. Schemas with
 * no name are left out. Found names are cached for the process; schemas without one are asked
 * again next time.
 */
export const getSchemaNamesBySchemaUids = async (
  schemaUids: string[],
): Promise<Map<string, string[]>> => {
  const result = new Map<string, string[]>()
  const missing: string[] = []
  for (const uid of new Set(schemaUids)) {
    const cached = schemaNamesBySchemaUid.get(schemaNamesCacheKey(uid))
    if (cached) result.set(uid, cached)
    else missing.push(uid)
  }
  if (missing.length === 0) return result

  const queryClient = BaseQueryClient.getQueryClient()
  const easClient = BaseEasClient.getEasClient()
  const { schemas } = (await queryClient.fetchQuery({
    queryKey: [`getSchemaNamesBySchemaUids`, [...missing].sort()],
    queryFn: async () =>
      easClient.request(GET_SCHEMAS, {
        where: { id: { in: missing } },
      }),
  })) as { schemas: Array<{ id: string; schemaNames?: Array<{ name: string }> }> }

  const byLowerUid = new Map(missing.map((uid) => [uid.toLowerCase(), uid]))
  for (const schema of schemas ?? []) {
    const names = (schema.schemaNames ?? []).map((n) => n.name)
    const uid = byLowerUid.get(schema.id.toLowerCase())
    if (!uid || names.length === 0) continue
    schemaNamesBySchemaUid.set(schemaNamesCacheKey(uid), names)
    result.set(uid, names)
  }
  return result
}

/**
 * Seed attestations whose UID is in `uids`, newest first, with `schema.schemaNames` attached from
 * their `schemaId` (the seeds themselves are fetched without that join, which is slow on easscan).
 */
export const getSeedsByUidsFromEas = async ({
  uids,
  excludeRevoked = true,
}: {
  uids: string[]
  excludeRevoked?: boolean
}): Promise<Attestation[]> => {
  if (uids.length === 0) return []
  const where = excludeRevoked ? withExcludeRevokedFilter({ id: { in: uids } }) : { id: { in: uids } }

  const queryClient = BaseQueryClient.getQueryClient()
  const easClient = BaseEasClient.getEasClient()
  const { itemSeeds } = (await queryClient.fetchQuery({
    queryKey: [`getSeedsByUidsFromEas`, [...uids].sort(), excludeRevoked],
    queryFn: async () => easClient.request(GET_SEEDS_LEAN, { where, take: uids.length, skip: 0 }),
  })) as { itemSeeds: Attestation[] }

  const seeds = itemSeeds ?? []
  const namesBySchemaUid = await getSchemaNamesBySchemaUids(seeds.map((seed) => seed.schemaId))
  return seeds.map((seed) => withSchemaNames(seed, namesBySchemaUid.get(seed.schemaId) ?? []))
}

export type AttestationChange = {
  id: string
  refUID: string
  timeCreated: number
  /** Unix seconds; 0 when not revoked. */
  revocationTime: number
}

/** UIDs per `in` filter, so a request body stays a few dozen KB. */
const CHANGES_UIDS_PER_REQUEST = 400

/**
 * Attestations created or revoked after `since` (unix seconds) that either reference one of
 * `refUIDs` (new or revoked Versions of a Seed, properties of a Version) or are one of `ids`
 * (a revoked Seed). Revoked ones are included: a revocation is a change. Large lists are split
 * over several requests, run concurrently.
 */
export const getAttestationChangesSince = async ({
  refUIDs,
  ids,
  since,
}: {
  refUIDs: string[]
  ids: string[]
  since: number
}): Promise<AttestationChange[]> => {
  const changedSince = { OR: [{ timeCreated: { gt: since } }, { revocationTime: { gt: since } }] }
  const filters: Record<string, unknown>[] = []
  const pushChunks = (field: 'refUID' | 'id', uids: string[]) => {
    const unique = [...new Set(uids)].sort()
    for (let i = 0; i < unique.length; i += CHANGES_UIDS_PER_REQUEST) {
      filters.push({ [field]: { in: unique.slice(i, i + CHANGES_UIDS_PER_REQUEST) } })
    }
  }
  pushChunks('refUID', refUIDs)
  pushChunks('id', ids)
  if (filters.length === 0) return []

  const queryClient = BaseQueryClient.getQueryClient()
  const easClient = BaseEasClient.getEasClient()
  const responses = await Promise.all(
    filters.map((filter) =>
      queryClient.fetchQuery({
        queryKey: [`getAttestationChangesSince`, filter, since],
        queryFn: async () =>
          easClient.request(GET_ATTESTATION_CHANGES, { where: { AND: [filter, changedSince] } }),
      }) as Promise<{ changes: AttestationChange[] }>,
    ),
  )

  const byId = new Map<string, AttestationChange>()
  for (const { changes } of responses) {
    for (const change of changes ?? []) byId.set(change.id, change)
  }
  return [...byId.values()]
}

export const getSeedUidsBySchemaName = async (schemaName: string, limit: number = 10) => {
  const itemSeeds = await getSeedsBySchemaName(schemaName, limit)
  return itemSeeds.map((seed: Attestation) => seed.id)
}
