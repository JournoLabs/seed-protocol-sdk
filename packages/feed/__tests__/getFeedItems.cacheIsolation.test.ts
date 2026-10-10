import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const mockGetSeedsBySchemaName = vi.fn()
const mockGetItemVersionsFromEas = vi.fn()
const mockGetItemPropertiesFromEas = vi.fn()
const mockRequest = vi.fn()
const mockGetAttestationChangesSince = vi.fn()

vi.mock('@seedprotocol/eas', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@seedprotocol/eas')>()
  return {
    ...actual,
    getSeedsBySchemaName: (...args: unknown[]) => mockGetSeedsBySchemaName(...args),
    getItemVersionsFromEas: (...args: unknown[]) => mockGetItemVersionsFromEas(...args),
    getItemPropertiesFromEas: (...args: unknown[]) => mockGetItemPropertiesFromEas(...args),
    getAttestationChangesSince: (...args: unknown[]) => mockGetAttestationChangesSince(...args),
    EasClient: {
      getEasClient: () => ({ request: mockRequest }),
    },
    setSchemaUidForSchemaDefinition: vi.fn(),
  }
})

vi.mock('../../query/src/bootstrap.js', () => ({
  initializeQueryPlatform: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../src/bootstrap', () => ({
  initializeFeedPlatform: vi.fn().mockResolvedValue(undefined),
}))

import {
  buildAssembleOptionsKey,
  getQueryCacheManager,
  queryBySchema,
  resetQueryCacheManager,
  type SeedRecord,
} from '@seedprotocol/query'
import { getFeedItemsBySchemaName } from '../src/getFeedItems'

const SEED_UID = '0xpost1'
const VERSION_UID = '0xpostver1'
const TIME_CREATED = 100

function cachedPost(): SeedRecord {
  return {
    seedUid: SEED_UID,
    schemaName: 'post',
    timeCreated: TIME_CREATED,
    versionUid: VERSION_UID,
    data: {
      seedUid: SEED_UID,
      timeCreated: TIME_CREATED,
      title: 'Cached post',
      html: '<p>hydrated body</p>',
      author: {
        seedUid: '0xauthor1',
        schemaName: 'identity',
        timeCreated: 50,
        name: 'Ada',
      },
      images: [
        {
          seedUid: '0ximage1',
          schemaName: 'image',
          timeCreated: 60,
          link: 'https://easscan.example/attestation/view/0ximage1',
        },
      ],
    },
  }
}

describe('getFeedItemsBySchemaName and the query collection cache', () => {
  let cacheDir: string

  beforeEach(() => {
    vi.clearAllMocks()
    cacheDir = mkdtempSync(join(tmpdir(), 'feed-cache-isolation-'))
    resetQueryCacheManager()
    process.env.CACHE_ENABLED = 'true'
    process.env.CACHE_DIR = cacheDir
    process.env.CACHE_TTL = '3600'

    // Every refresh lists the same seed and finds no attestation changes since the last check,
    // so queryBySchema returns the cached SeedRecord objects.
    mockRequest.mockResolvedValue({ itemSeeds: [] })
    mockGetSeedsBySchemaName.mockResolvedValue([
      {
        id: SEED_UID,
        decodedDataJson: '',
        refUID: '0x0',
        schemaId: '0xschema',
        timeCreated: TIME_CREATED,
        schema: { schemaNames: [{ name: 'post' }] },
      },
    ])
    mockGetItemVersionsFromEas.mockResolvedValue([])
    mockGetItemPropertiesFromEas.mockResolvedValue([])
    mockGetAttestationChangesSince.mockResolvedValue([])
  })

  afterEach(() => {
    resetQueryCacheManager()
    delete process.env.CACHE_ENABLED
    delete process.env.CACHE_DIR
    delete process.env.CACHE_TTL
    rmSync(cacheDir, { recursive: true, force: true })
  })

  it('feed defaults do not leak into cached SeedRecords', async () => {
    const options = { expandRelations: true, hydrateStorage: true }
    const now = Math.floor(Date.now() / 1000)
    await getQueryCacheManager().setCollection('post', buildAssembleOptionsKey(options), {
      items: [cachedPost()],
      meta: {
        [SEED_UID]: { dependencies: { refUIDs: [SEED_UID], ids: [SEED_UID] }, builtAt: now },
      },
      lastUpdated: now,
      checkedAt: now,
      seenChangeKeys: [],
    })

    const feedItems = await getFeedItemsBySchemaName('post')
    expect(feedItems).toHaveLength(1)
    const feedItem = feedItems[0]!
    expect(feedItem.link).toBeTruthy()
    expect(feedItem.Title).toBe('Cached post')
    expect((feedItem.author as Record<string, unknown>).Title).toBe('0xauthor1')
    expect((feedItem.images as Record<string, unknown>[])[0]!.link).toBeUndefined()
    // Unmutated values are shared, not cloned.
    expect(feedItem.html).toBe('<p>hydrated body</p>')

    // Second feed pass hits the cache again and must see pristine data.
    await getFeedItemsBySchemaName('post')

    const first = await queryBySchema('post', options)
    const second = await queryBySchema('post', options)
    expect(first.items).toEqual([cachedPost()])
    expect(second.items).toEqual([cachedPost()])
    expect(second.etag).toBe(first.etag)
  })
})
