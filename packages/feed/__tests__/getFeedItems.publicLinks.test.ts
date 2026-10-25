import { afterEach, describe, expect, it, vi } from 'vitest'
import { setResolvedSeedGatewayEndpoints } from '@seedprotocol/arweave'

const mockQueryBySchema = vi.fn()

vi.mock('@seedprotocol/query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@seedprotocol/query')>()
  return { ...actual, queryBySchema: (...args: unknown[]) => mockQueryBySchema(...args) }
})

vi.mock('../src/bootstrap', () => ({
  initializeFeedPlatform: vi.fn().mockResolvedValue(undefined),
}))

import { getFeedItemsBySchemaName } from '../src/getFeedItems'

/**
 * ADR 0025: on a feed server reading through a Hyper sidecar, query hands back this reader's URLs
 * (the sidecar); the feed emits public ones.
 */
const TX = 'feedTx'.padEnd(43, 'f')
const IMAGE = 'feedImg'.padEnd(43, 'g')
const SIDECAR = 'http://127.0.0.1:1984'

describe('feed items', () => {
  afterEach(() => setResolvedSeedGatewayEndpoints(null))

  it('put Arweave links in Html fields and link fields on the public gateway', async () => {
    setResolvedSeedGatewayEndpoints({
      mode: 'hyper',
      arweaveHost: '127.0.0.1:1984',
      arweaveProtocol: 'http',
      arweaveBaseUrl: SIDECAR,
      arweaveGraphqlUrl: `${SIDECAR}/graphql`,
      uploadApiBaseUrl: SIDECAR,
      activePath: 'hyper-sidecar',
      publicArweaveBaseUrl: 'https://arweave.net',
    })
    const record = {
      seedUid: '0xpost',
      data: {
        seedUid: '0xpost',
        title: 'Post',
        html: `<p><img src="${SIDECAR}/raw/${TX}"></p>`,
        image: { arweaveUrl: `${SIDECAR}/raw/${IMAGE}` },
      },
    }
    mockQueryBySchema.mockResolvedValue({ items: [Object.freeze(record)] })

    const [item] = await getFeedItemsBySchemaName('post')
    expect(item!.html).toBe(`<p><img src="https://arweave.net/raw/${TX}"></p>`)
    expect((item!.image as { arweaveUrl: string }).arweaveUrl).toBe(`https://arweave.net/raw/${IMAGE}`)
  })
})
