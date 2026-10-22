import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  BaseArweaveClient,
  resetArweaveReadGatewayForTests,
  setResolvedSeedGatewayEndpoints,
} from '@seedprotocol/arweave'

const mockFetchFeedItems = vi.fn()

vi.mock('../src/getFeedItems', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/getFeedItems')>()
  return {
    ...actual,
    fetchFeedItemsBySchemaName: (...args: unknown[]) => mockFetchFeedItems(...args),
  }
})

import { handleFeedRequest, resetCacheManager } from '../src/index'

const FEATURE_TX = 'JYeiPzuglpwr4cMRmCDFFmROnzXwdrDZAzg8vaZZRpY'
const BODY_TX = '05eY_BXxztbTacIqutY1S5FUXgzq4ock3x2pDHMQqmY'
const PNG_1x1 = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
)

describe('handleFeedRequest image metadata', () => {
  let cacheDir: string

  beforeEach(() => {
    // Image metadata is cached on disk even with content caching off.
    cacheDir = mkdtempSync(join(tmpdir(), 'feed-image-metadata-'))
    process.env.CACHE_DIR = cacheDir
    vi.clearAllMocks()
    resetArweaveReadGatewayForTests()
    setResolvedSeedGatewayEndpoints(null)
    BaseArweaveClient.setHost('arweave.net')
    process.env.CACHE_ENABLED = 'false'
    process.env.IMAGE_METADATA_GATEWAYS = 'arweave.net'
    resetCacheManager()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.CACHE_ENABLED
    delete process.env.IMAGE_METADATA_GATEWAYS
    delete process.env.CACHE_DIR
    resetCacheManager()
    rmSync(cacheDir, { recursive: true, force: true })
  })

  it("probes a post's feature image, not its own storage transaction", async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const s = String(url)
      if (s.endsWith('/info')) return new Response(JSON.stringify({ network: 'arweave.mainnet' }))
      if (!s.endsWith(FEATURE_TX)) throw new Error(`unexpected ${s}`)
      if (init?.method === 'HEAD') {
        return new Response(null, { headers: { 'content-type': 'image/png', 'content-length': '68' } })
      }
      return new Response(PNG_1x1, { status: 206, headers: { 'content-type': 'image/png' } })
    })
    vi.stubGlobal('fetch', fetchMock)
    mockFetchFeedItems.mockResolvedValue({ items: [
      {
        id: '0xpost',
        seedUid: '0xpost',
        title: 'Post',
        link: 'https://example.com/posts/1',
        pubDate: 'Tue, 21 Oct 2026 12:00:00 GMT',
        storageTransactionId: BODY_TX,
        featureImage: { seedUid: '0ximage', arweaveUrl: `https://arweave.net/${FEATURE_TX}` },
      },
    ] })

    const rss = await (await handleFeedRequest('posts', 'rss')).text()

    const probed = fetchMock.mock.calls.map((c) => String(c[0])).filter((s) => !s.endsWith('/info'))
    expect(probed.every((s) => s.endsWith(FEATURE_TX))).toBe(true)
    expect(rss).toContain(`url="https://arweave.net/${FEATURE_TX}"`)
    expect(rss).toMatch(/width="1"/)
  })
})
