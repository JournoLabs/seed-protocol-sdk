import { checksumAddress } from './utils.js'
import { withExcludeRevokedFilter } from './easRevokedFilter.js'
import { BaseEasClient } from './EasClient/BaseEasClient.js'
import { BaseQueryClient } from './QueryClient/BaseQueryClient.js'
import { GET_SEEDS } from './queries.js'
import {
  PUBLISH_AUTHORIZATION_SCHEMA_NAME,
  decodePublishAuthorizationData,
} from './publishAuthorizationHelpers.js'
import type { Attestation } from './graphql/gql/graphql.js'

export type GetPublishAuthorizationFromEasParams = {
  /**
   * ManagedAccount identity address(es) that attested the grant (EAS `attester`).
   * When omitted, filter by named schema only (then apply identity filters client-side).
   */
  identities?: string[]
  /** Optional session key addresses (EAS `recipient` filter). */
  sessionKeys?: string[]
  /** Optional app addresses (decoded `app`, case-insensitive). */
  apps?: string[]
  /**
   * PublishAuthorization schema UID. When omitted, filters by named schema
   * {@link PUBLISH_AUTHORIZATION_SCHEMA_NAME}.
   */
  schemaUid?: string
  excludeRevoked?: boolean
}

/**
 * Query PublishAuthorization sidecar attestations.
 */
export async function getPublishAuthorizationFromEas(
  params: GetPublishAuthorizationFromEasParams = {},
): Promise<Attestation[]> {
  const {
    identities,
    sessionKeys,
    apps,
    schemaUid,
    excludeRevoked = true,
  } = params

  let where: Record<string, unknown> = {}

  if (schemaUid) {
    where.schemaId = { equals: schemaUid }
  } else {
    where.schema = {
      is: {
        schemaNames: {
          some: {
            name: { equals: PUBLISH_AUTHORIZATION_SCHEMA_NAME },
          },
        },
      },
    }
  }

  if (identities?.length) {
    where.attester = {
      in: identities.map((a) => {
        try {
          return checksumAddress(a)
        } catch {
          return a
        }
      }),
    }
  }

  if (sessionKeys?.length) {
    where.recipient = {
      in: sessionKeys.map((a) => {
        try {
          return checksumAddress(a)
        } catch {
          return a
        }
      }),
    }
  }

  if (excludeRevoked) {
    where = withExcludeRevokedFilter(where)
  }

  const queryClient = BaseQueryClient.getQueryClient()
  const easClient = BaseEasClient.getEasClient()

  const { itemSeeds } = (await queryClient.fetchQuery({
    queryKey: [
      'getPublishAuthorizationFromEas',
      excludeRevoked,
      schemaUid ?? PUBLISH_AUTHORIZATION_SCHEMA_NAME,
      [...(identities ?? [])].map((a) => a.toLowerCase()).sort(),
      [...(sessionKeys ?? [])].map((a) => a.toLowerCase()).sort(),
      [...(apps ?? [])].map((a) => a.toLowerCase()).sort(),
    ],
    queryFn: async () =>
      easClient.request(GET_SEEDS, {
        where,
      }),
  })) as { itemSeeds: Attestation[] }

  if (!apps?.length) return itemSeeds

  const want = new Set(apps.map((a) => a.toLowerCase()))
  return itemSeeds.filter((row) => {
    try {
      const decoded = decodePublishAuthorizationData(row.decodedDataJson ?? '[]')
      return want.has(decoded.app.toLowerCase())
    } catch {
      return false
    }
  })
}

export * from './publishAuthorizationHelpers.js'
