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

  it('give a stored transaction an ar:// guid that stays put when the public gateway changes', async () => {
    const record = { seedUid: '0xstored', data: { seedUid: '0xstored', title: 'Stored', storageTransactionId: TX } }
    mockQueryBySchema.mockResolvedValue({ items: [Object.freeze(record)] })
    const items = []
    for (const publicArweaveBaseUrl of ['https://arweave.net', 'https://gateway.example']) {
      setResolvedSeedGatewayEndpoints({
        mode: 'http-gateway',
        arweaveHost: 'arweave.net',
        arweaveProtocol: 'https',
        arweaveBaseUrl: 'https://arweave.net',
        arweaveGraphqlUrl: 'https://arweave.net/graphql',
        uploadApiBaseUrl: '',
        activePath: 'http-gateway',
        publicArweaveBaseUrl,
      } as any)
      items.push((await getFeedItemsBySchemaName('post'))[0]!)
    }
    expect(items.map((item) => item.guid)).toEqual([`ar://${TX}`, `ar://${TX}`])
    expect(items.map((item) => item.link)).toEqual([
      `https://arweave.net/raw/${TX}`,
      `https://gateway.example/raw/${TX}`,
    ])
  })

  it('keep an item\'s own link as its guid', async () => {
    const record = {
      seedUid: '0xlinked',
      data: { seedUid: '0xlinked', title: 'Linked', storageTransactionId: TX, link: 'https://example.com/p/1' },
    }
    mockQueryBySchema.mockResolvedValue({ items: [Object.freeze(record)] })
    const [item] = await getFeedItemsBySchemaName('post')
    expect(item!.guid).toBe('https://example.com/p/1')
  })
})

