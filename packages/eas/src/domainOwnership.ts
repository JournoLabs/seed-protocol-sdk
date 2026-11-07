import { checksumAddresses } from './utils.js'
import { withExcludeRevokedFilter } from './easRevokedFilter.js'
import { BaseEasClient } from './EasClient/BaseEasClient.js'
import { BaseQueryClient } from './QueryClient/BaseQueryClient.js'
import { GET_DOMAIN_OWNERSHIPS } from './queries.js'
import {
  DOMAIN_OWNERSHIP_SCHEMA_DEF,
  DOMAIN_OWNERSHIP_SCHEMA_NAME,
  decodeDomainOwnershipData,
} from './domainOwnershipHelpers.js'
import type { Attestation } from './graphql/gql/graphql.js'
import { seedSchemaUid } from './seedSchemaUid.js'

export type GetDomainOwnershipFromEasParams = {
  /** Tool canonical wallet(s) that may have attested. */
  toolAddresses: string[]
  /** Optional domains to keep (matched against decoded `domain`, case-insensitive). */
  domains?: string[]
  /** Optional claimer addresses (EAS `recipient` filter). */
  claimers?: string[]
  /**
   * DomainOwnership schema UID. When omitted, {@link seedSchemaUid} of
   * {@link DOMAIN_OWNERSHIP_SCHEMA_DEF}.
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

  const attesterAddresses = checksumAddresses(toolAddresses)

  let where: Record<string, unknown> = {
    attester: { in: attesterAddresses },
  }

  // Its UID, not its name: anyone can attach a name to another schema (ADR 0035).
  where.schemaId = { equals: schemaUid ?? seedSchemaUid(DOMAIN_OWNERSHIP_SCHEMA_DEF) }

  if (claimers?.length) {
    where.recipient = {
      in: checksumAddresses(claimers),
    }
  }

  if (excludeRevoked) {
    where = withExcludeRevokedFilter(where)
  }

  const queryClient = BaseQueryClient.getQueryClient()
  const easClient = BaseEasClient.getEasClient()

  const { domainOwnerships } = (await queryClient.fetchQuery({
    queryKey: [
      'getDomainOwnershipFromEas',
      excludeRevoked,
      schemaUid ?? DOMAIN_OWNERSHIP_SCHEMA_NAME,
      [...attesterAddresses].sort(),
      [...(domains ?? []).map(normalizeDomainFilter)].sort(),
      [...(claimers ?? [])].map((c) => c.toLowerCase()).sort(),
    ],
    queryFn: async () =>
      easClient.request(GET_DOMAIN_OWNERSHIPS, {
        where,
      }),
  })) as { domainOwnerships: Attestation[] }

  if (!domains?.length) return domainOwnerships

  const want = new Set(domains.map(normalizeDomainFilter))
  return domainOwnerships.filter((row) => {
    try {
      const decoded = decodeDomainOwnershipData(row.decodedDataJson ?? '[]')
      return want.has(decoded.domain)
    } catch {
      return false
    }
  })
}

export * from './domainOwnershipHelpers.js'
