import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const mockGetSeedsBySchemaName = vi.fn()
const mockGetItemVersionsFromEas = vi.fn()
const mockGetItemPropertiesFromEas = vi.fn()
const mockRequest = vi.fn()

vi.mock('@seedprotocol/eas', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@seedprotocol/eas')>()
  return {
    ...actual,
    getSeedsBySchemaName: (...args: unknown[]) => mockGetSeedsBySchemaName(...args),
    getItemVersionsFromEas: (...args: unknown[]) => mockGetItemVersionsFromEas(...args),
    getItemPropertiesFromEas: (...args: unknown[]) => mockGetItemPropertiesFromEas(...args),
    EasClient: {
      getEasClient: () => ({ request: mockRequest }),
    },
    setSchemaUidForSchemaDefinition: vi.fn(),
  }
})

vi.mock('../src/bootstrap.js', () => ({
  initializeQueryPlatform: vi.fn().mockResolvedValue(undefined),
}))

import { queryBySchema, getSeed } from '../src/api'
import { assembleSeeds } from '../src/assembleSeeds'
import {
  getQueryCacheManager,
  resetQueryCacheManager,
  buildAssembleOptionsKey,
} from '../src/cache/index'
import type { AttestationLike } from '../src/types'

function propDecoded(name: string, value: string, type = 'string') {
  return JSON.stringify([{ value: { name, value, type } }])
}

function mockAssembledPost(
  seedUid: string,
  versionUid: string,
  title: string,
  timeCreated: number,
) {
  mockGetSeedsBySchemaName.mockResolvedValue([
    {
      id: seedUid,
      decodedDataJson: '',
      refUID: '0x0',
      schemaId: '0xschema',
      timeCreated,
      attester: '0xattester',
      schema: { schemaNames: [{ name: 'post' }] },
    } satisfies AttestationLike,
  ])
  mockGetItemVersionsFromEas.mockResolvedValue([
    {
      id: versionUid,
      decodedDataJson: '',
      refUID: seedUid,
      schemaId: '0xversion',
      timeCreated: timeCreated + 10,
    },
  ])
  mockGetItemPropertiesFromEas.mockResolvedValue([
    {
      id: '0xprop1',
      decodedDataJson: propDecoded('title', title),
      refUID: versionUid,
      schemaId: '0xtitleSchema',
      timeCreated: timeCreated + 20,
    },
  ])
}

describe('queryBySchema / getSeed / assembleSeeds', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequest.mockResolvedValue({ itemSeeds: [] })
    resetQueryCacheManager()
    process.env.CACHE_ENABLED = 'false'
  })

  afterEach(() => {
    resetQueryCacheManager()
    delete process.env.CACHE_ENABLED
    delete process.env.CACHE_DIR
    delete process.env.CACHE_TTL
  })

  it('queryBySchema returns SeedRecord envelope with data.title', async () => {
    const seedUid = '0xseed1'
    const versionUid = '0xver1'
    mockAssembledPost(seedUid, versionUid, 'Hello Post', 100)

    const result = await queryBySchema('post', {
      limit: 10,
      skip: 0,
      expandRelations: false,
      hydrateStorage: false,
      cache: false,
    })

    expect(result.limit).toBe(10)
    expect(result.skip).toBe(0)
    expect(result.items).toHaveLength(1)
    const record = result.items[0]!
    expect(record.seedUid).toBe(seedUid)
    expect(record.schemaName).toBe('post')
    expect(record.versionUid).toBe(versionUid)
    expect(record.data.title).toBe('Hello Post')
    expect(record.data.seedUid).toBe(seedUid)
  })

  it('getSeed returns null when attestation missing', async () => {
    mockRequest.mockResolvedValue({ itemSeeds: [] })
    const result = await getSeed('0xmissing', {
      hydrateStorage: false,
      cache: false,
    })
    expect(result).toBeNull()
  })

  it('assembleSeeds picks latest property attestation on the latest version', async () => {
    const seedUid = '0xseed2'
    const versionUid = '0xver2'
    const seeds: AttestationLike[] = [
      {
        id: seedUid,
        decodedDataJson: '',
        refUID: '0x0',
        schemaId: '0xschema',
        timeCreated: 1,
        schema: { schemaNames: [{ name: 'post' }] },
      },
    ]
    mockGetItemVersionsFromEas.mockResolvedValue([
      {
        id: versionUid,
        decodedDataJson: '',
        refUID: seedUid,
        schemaId: '0xversion',
        timeCreated: 50,
      },
    ])
    mockGetItemPropertiesFromEas.mockResolvedValue([
      {
        id: '0xold',
        decodedDataJson: propDecoded('title', 'Old'),
        refUID: versionUid,
        schemaId: '0xtitleSchema',
        timeCreated: 10,
      },
      {
        id: '0xnew',
        decodedDataJson: propDecoded('title', 'New'),
        refUID: versionUid,
        schemaId: '0xtitleSchema',
        timeCreated: 99,
      },
    ])

    const records = await assembleSeeds('post', seeds, {
      expandRelations: false,
      hydrateStorage: false,
    })
    expect(records[0]!.data.title).toBe('New')
  })
})

describe('queryBySchema / getSeed caching', () => {
  let cacheDir: string

  beforeEach(() => {
    vi.clearAllMocks()
    mockRequest.mockResolvedValue({ itemSeeds: [] })
    cacheDir = mkdtempSync(join(tmpdir(), 'query-api-cache-'))
    resetQueryCacheManager()
    process.env.CACHE_ENABLED = 'true'
    process.env.CACHE_DIR = cacheDir
    process.env.CACHE_TTL = '3600'
  })

  afterEach(() => {
    resetQueryCacheManager()
    delete process.env.CACHE_ENABLED
    delete process.env.CACHE_DIR
    delete process.env.CACHE_TTL
    rmSync(cacheDir, { recursive: true, force: true })
  })

  it('caches collection on skip=0 and returns etag', async () => {
    mockAssembledPost('0xseed1', '0xver1', 'Cached', 100)
    const first = await queryBySchema('post', {
      limit: 10,
      skip: 0,
      expandRelations: false,
      hydrateStorage: false,
    })
    expect(first.etag).toMatch(/^"[a-f0-9]{16}"$/)
    expect(mockGetSeedsBySchemaName).toHaveBeenCalledTimes(1)

    mockAssembledPost('0xseed1', '0xver1', 'Cached', 100)
    const second = await queryBySchema('post', {
      limit: 10,
      skip: 0,
      expandRelations: false,
      hydrateStorage: false,
    })
    expect(second.items[0]!.data.title).toBe('Cached')
    expect(second.etag).toBe(first.etag)
    expect(mockGetSeedsBySchemaName).toHaveBeenCalledTimes(2)
  })

  it('cache:false bypasses collection cache', async () => {
    mockAssembledPost('0xseed1', '0xver1', 'A', 100)
    await queryBySchema('post', {
      limit: 10,
      skip: 0,
      expandRelations: false,
      hydrateStorage: false,
      cache: false,
    })
    expect(await getQueryCacheManager().getCollection('post')).toBeNull()
  })

  it('skip > 0 bypasses collection cache', async () => {
    mockAssembledPost('0xseed1', '0xver1', 'Page2', 100)
    const result = await queryBySchema('post', {
      limit: 10,
      skip: 10,
      expandRelations: false,
      hydrateStorage: false,
    })
    expect(result.etag).toBeUndefined()
    expect(await getQueryCacheManager().getCollection('post')).toBeNull()
    const optionsKey = buildAssembleOptionsKey({
      expandRelations: false,
      hydrateStorage: false,
    })
    expect(
      (await getQueryCacheManager().getItem('0xseed1', optionsKey))?.record.data
        .title,
    ).toBe('Page2')
  })

  it('getSeed hits item cache after collection populate', async () => {
    mockAssembledPost('0xseed1', '0xver1', 'FromCollection', 100)
    await queryBySchema('post', {
      limit: 10,
      skip: 0,
      expandRelations: false,
      hydrateStorage: false,
    })

    mockRequest.mockClear()
    const hit = await getSeed('0xseed1', {
      expandRelations: false,
      hydrateStorage: false,
    })
    expect(hit?.data.title).toBe('FromCollection')
    expect(mockRequest).not.toHaveBeenCalled()
  })
})
