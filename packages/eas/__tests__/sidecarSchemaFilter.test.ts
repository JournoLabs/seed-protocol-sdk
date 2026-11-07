import { beforeEach, describe, expect, it } from 'vitest'
import type { GraphQLClient } from 'graphql-request'
import { BaseEasClient } from '../src/EasClient/BaseEasClient.js'
import { BaseQueryClient } from '../src/QueryClient/BaseQueryClient.js'
import { getPublishedByFromEas } from '../src/publishedBy.js'
import { getPublishAuthorizationFromEas } from '../src/publishAuthorization.js'
import { getDomainOwnershipFromEas } from '../src/domainOwnership.js'
import { PUBLISHED_BY_SCHEMA_DEF } from '../src/publishedByHelpers.js'
import { PUBLISH_AUTHORIZATION_SCHEMA_DEF } from '../src/publishAuthorizationHelpers.js'
import { DOMAIN_OWNERSHIP_SCHEMA_DEF } from '../src/domainOwnershipHelpers.js'
import { seedSchemaUid } from '../src/seedSchemaUid.js'

const TOOL = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'

let wheres: Record<string, unknown>[] = []

beforeEach(() => {
  wheres = []
  BaseQueryClient.configure({
    getQueryClient: () => ({
      fetchQuery: ({ queryFn }: { queryFn: () => unknown }) => queryFn(),
      getQueryData: () => undefined,
      removeQueries: async () => {},
    }),
  } as never)
  BaseEasClient.configure({
    getEasClient: () =>
      ({
        request: async (_doc: unknown, variables: { where: Record<string, unknown> }) => {
          wheres.push(variables.where)
          return { itemSeeds: [], publishAuthorizations: [], domainOwnerships: [] }
        },
      }) as unknown as GraphQLClient,
  } as never)
})

// ADR 0035: anyone can attach a sidecar's name to another schema, so readers filter by its UID.
describe('sidecar readers without a schemaUid', () => {
  it.each([
    ['PublishedBy', () => getPublishedByFromEas({ toolAddresses: [TOOL] }), PUBLISHED_BY_SCHEMA_DEF],
    ['PublishAuthorization', () => getPublishAuthorizationFromEas({ identities: [TOOL] }), PUBLISH_AUTHORIZATION_SCHEMA_DEF],
    ['DomainOwnership', () => getDomainOwnershipFromEas({ toolAddresses: [TOOL] }), DOMAIN_OWNERSHIP_SCHEMA_DEF],
  ])('%s filters by the UID of its definition, not by name', async (_name, read, definition) => {
    await read()
    const where = JSON.stringify(wheres[0])
    expect(where).toContain(seedSchemaUid(definition))
    expect(where).not.toMatch(/schemaNames/)
  })
})
