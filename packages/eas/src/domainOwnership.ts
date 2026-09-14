import { checksumAddress } from './utils.js'
import { withExcludeRevokedFilter } from './easRevokedFilter.js'
import { BaseEasClient } from './EasClient/BaseEasClient.js'
import { BaseQueryClient } from './QueryClient/BaseQueryClient.js'
import { GET_SEEDS } from './queries.js'
import {
  DOMAIN_OWNERSHIP_SCHEMA_NAME,
  decodeDomainOwnershipData,
} from './domainOwnershipHelpers.js'
import type { Attestation } from './graphql/gql/graphql.js'

export type GetDomainOwnershipFromEasParams = {
  /** Tool canonical wallet(s) that may have attested. */
  toolAddresses: string[]
  /** Optional domains to keep (matched against decoded `domain`, case-insensitive). */
  domains?: string[]
  /** Optional claimer addresses (EAS `recipient` filter). */
  claimers?: string[]
  /**
   * DomainOwnership schema UID. When omitted, filters by named schema
   * {@link DOMAIN_OWNERSHIP_SCHEMA_NAME}.
   */
  schemaUid?: string
  excludeRevoked?: boolean
}

function normalizeDomainFilter(domain: string): string {
  return domain.trim().toLowerCase().replace(/\.$/, '')
}

/**
 * Query DomainOwnership sidecar attestations by tool attester (and optional filters).
 * Domain filters are applied client-side from `decodedDataJson`.
 */
export async function getDomainOwnershipFromEas(
  params: GetDomainOwnershipFromEasParams,
): Promise<Attestation[]> {
  const {
    toolAddresses,
    domains,
    claimers,
    schemaUid,
    excludeRevoked = true,
  } = params
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
            name: { equals: DOMAIN_OWNERSHIP_SCHEMA_NAME },
          },
        },
      },
    }
  }

  if (claimers?.length) {
    where.recipient = {
      in: claimers.map((a) => {
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
      'getDomainOwnershipFromEas',
      excludeRevoked,
      schemaUid ?? DOMAIN_OWNERSHIP_SCHEMA_NAME,
      [...attesterAddresses].sort(),
      [...(domains ?? []).map(normalizeDomainFilter)].sort(),
      [...(claimers ?? [])].map((c) => c.toLowerCase()).sort(),
    ],
    queryFn: async () =>
      easClient.request(GET_SEEDS, {
        where,
      }),
  })) as { itemSeeds: Attestation[] }

  if (!domains?.length) return itemSeeds

  const want = new Set(domains.map(normalizeDomainFilter))
  return itemSeeds.filter((row) => {
    try {
      const decoded = decodeDomainOwnershipData(row.decodedDataJson ?? '[]')
      return want.has(decoded.domain)
    } catch {
      return false
    }
  })
}

export * from './domainOwnershipHelpers.js'
