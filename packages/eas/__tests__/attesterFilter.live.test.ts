/**
 * getSeedsBySchemaName's `attesters` against the live Optimism Sepolia indexer, which compares
 * attesters case-sensitively against their checksummed form: the reason the filter checksums.
 * Skipped unless SEED_LIVE_NETWORK_TESTS=1.
 *
 *   SEED_LIVE_NETWORK_TESTS=1 bunx vitest run --config packages/eas/vitest.config.ts packages/eas/__tests__/attesterFilter.live.test.ts
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { getSeedsBySchemaName } from '../src/api.js'
import { BaseEasClient } from '../src/EasClient/BaseEasClient.js'
import { createEasGraphQLClient } from '../src/EasClient/createEasGraphQLClient.js'
import { BaseQueryClient } from '../src/QueryClient/BaseQueryClient.js'
import { GET_SEEDS_LEAN } from '../src/queries.js'

const runLive = process.env.SEED_LIVE_NETWORK_TESTS === '1'

describe.skipIf(!runLive)('attesters filter against the live EAS indexer', () => {
  const client = createEasGraphQLClient('https://optimism-sepolia.easscan.org/graphql')

  beforeAll(() => {
    BaseEasClient.configure({ getEasClient: () => client })
    BaseQueryClient.configure({
      getQueryClient: () => ({
        fetchQuery: ({ queryFn }) => queryFn(),
        getQueryData: () => undefined,
        removeQueries: async () => {},
      }),
    })
  })

  it('finds the seeds of an attester given in lowercase, which the indexer alone would not', async () => {
    const [newest] = await getSeedsBySchemaName('post', 1)
    expect(newest?.attester).toMatch(/^0x[0-9a-fA-F]{40}$/)
    const attester = newest!.attester

    const lower = await getSeedsBySchemaName('post', 5, 0, { attesters: [attester.toLowerCase()] })
    expect(lower.length).toBeGreaterThan(0)
    expect(lower.every((seed) => seed.attester === attester)).toBe(true)

    // Sent unchecksummed, the same condition matches nothing. (An all-digit address has no case.)
    if (attester === attester.toLowerCase()) return
    const { itemSeeds } = await client.request(GET_SEEDS_LEAN, {
      where: { id: { equals: newest!.id }, attester: { in: [attester.toLowerCase()] } },
      take: 1,
      skip: 0,
    })
    expect(itemSeeds).toEqual([])
  }, 60_000)
})
