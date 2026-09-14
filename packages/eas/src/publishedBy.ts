import { checksumAddress } from './utils.js'
import { withExcludeRevokedFilter } from './easRevokedFilter.js'
import { BaseEasClient } from './EasClient/BaseEasClient.js'
import { BaseQueryClient } from './QueryClient/BaseQueryClient.js'
import { GET_SEEDS } from './queries.js'
import { PUBLISHED_BY_SCHEMA_NAME } from './publishedByHelpers.js'
import type { Attestation } from './graphql/gql/graphql.js'

export type GetPublishedByFromEasParams = {
  /** Tool canonical wallet(s) that may have attested. */
  toolAddresses: string[]
  /** Optional seed UIDs used as refUID on the sidecar. */
  refUIDs?: string[]
  /**
   * PublishedBy schema UID. When omitted, filters by named schema
   * {@link PUBLISHED_BY_SCHEMA_NAME}.
   */
  schemaUid?: string
  excludeRevoked?: boolean
}

/**
 * Query PublishedBy sidecar attestations by tool attester (and optional refUID / schema).
 */
export async function getPublishedByFromEas(
  params: GetPublishedByFromEasParams,
): Promise<Attestation[]> {
  const { toolAddresses, refUIDs, schemaUid, excludeRevoked = true } = params
  if (!toolAddresses.length) return []

  const attesterAddresses = toolAddresses.map((a) => {
    try {
      return checksumAddress(a)
    } catch {
      return a
    }
  })

  let where: Record<string, unknown> = {
    attester: { in: attesterAddresses },
  }

  if (schemaUid) {
    where.schemaId = { equals: schemaUid }
  } else {
    where.schema = {
      is: {
        schemaNames: {
          some: {
            name: { equals: PUBLISHED_BY_SCHEMA_NAME },
          },
        },
      },
    }
  }

  if (refUIDs?.length) {
    where.refUID = { in: refUIDs }
  }

  if (excludeRevoked) {
    where = withExcludeRevokedFilter(where)
  }

  const queryClient = BaseQueryClient.getQueryClient()
  const easClient = BaseEasClient.getEasClient()

  const { itemSeeds } = (await queryClient.fetchQuery({
    queryKey: [
      'getPublishedByFromEas',
      excludeRevoked,
      schemaUid ?? PUBLISHED_BY_SCHEMA_NAME,
      [...attesterAddresses].sort(),
      [...(refUIDs ?? [])].sort(),
    ],
    queryFn: async () =>
      easClient.request(GET_SEEDS, {
        where,
      }),
  })) as { itemSeeds: Attestation[] }

  return itemSeeds
}

export * from './publishedByHelpers.js'
