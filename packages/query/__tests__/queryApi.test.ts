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

  it('getSeed with data+changelog returns version diffs', async () => {
    const seedUid = '0xseedCl'
    const v1 = '0xv1'
    const v2 = '0xv2'
    mockRequest.mockResolvedValue({
      itemSeeds: [
        {
          id: seedUid,
          decodedDataJson: '',
          refUID: '0x0',
          schemaId: '0xschema',
          timeCreated: 100,
          attester: '0xattester',
          schema: { schemaNames: [{ name: 'post' }] },
        },
      ],
    })
    mockGetItemVersionsFromEas.mockResolvedValue([
      {
        id: v1,
        decodedDataJson: '',
        refUID: seedUid,
        schemaId: '0xversion',
        timeCreated: 110,
      },
      {
        id: v2,
        decodedDataJson: '',
        refUID: seedUid,
        schemaId: '0xversion',
        timeCreated: 210,
      },
    ])
    mockGetItemPropertiesFromEas.mockImplementation(
      async ({ versionUids }: { versionUids: string[] }) => {
        const props: AttestationLike[] = []
        if (versionUids.includes(v1)) {
          props.push({
            id: '0xp1',
            decodedDataJson: propDecoded('title', 'First'),
            refUID: v1,
            schemaId: '0xtitleSchema',
            timeCreated: 120,
          })
        }
        if (versionUids.includes(v2)) {
          props.push({
            id: '0xp2',
            decodedDataJson: propDecoded('title', 'Second'),
            refUID: v2,
            schemaId: '0xtitleSchema',
            timeCreated: 220,
          })
        }
        return props
      },
    )

    const result = await getSeed(seedUid, {
      include: 'data+changelog',
      expandRelations: false,
      hydrateStorage: false,
      cache: false,
    })

    expect(result?.data.title).toBe('Second')
    expect(result?.changelog).toHaveLength(2)
    expect(result?.changelog?.[0]).toMatchObject({
      type: 'version',
      versionUid: v1,
      before: {},
      after: { title: 'First' },
    })
    expect(result?.changelog?.[1]).toMatchObject({
      type: 'version',
      versionUid: v2,
      before: { title: 'First' },
      after: { title: 'Second' },
      changedKeys: ['title'],
    })
  })

  it('getSeed include changelog sets empty data', async () => {
    const seedUid = '0xseedClOnly'
    const v1 = '0xv1only'
    mockRequest.mockResolvedValue({
      itemSeeds: [
        {
          id: seedUid,
          decodedDataJson: '',
          refUID: '0x0',
          schemaId: '0xschema',
          timeCreated: 50,
          schema: { schemaNames: [{ name: 'post' }] },
        },
      ],
    })
    mockGetItemVersionsFromEas.mockResolvedValue([
      {
        id: v1,
        decodedDataJson: '',
        refUID: seedUid,
        schemaId: '0xversion',
        timeCreated: 60,
      },
    ])
    mockGetItemPropertiesFromEas.mockResolvedValue([
      {
        id: '0xp',
        decodedDataJson: propDecoded('title', 'Only'),
        refUID: v1,
        schemaId: '0xtitleSchema',
        timeCreated: 70,
      },
    ])

    const result = await getSeed(seedUid, {
      include: 'changelog',
      cache: false,
    })
    expect(result?.data).toEqual({})
    expect(result?.versionUid).toBe(v1)
    expect(result?.changelog).toHaveLength(1)
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

  it('data+changelog does not share cache with data-only', async () => {
    const seedUid = '0xseedSep'
    const v1 = '0xvsep1'
    const v2 = '0xvsep2'
    mockRequest.mockResolvedValue({
      itemSeeds: [
        {
          id: seedUid,
          decodedDataJson: '',
          refUID: '0x0',
          schemaId: '0xschema',
          timeCreated: 100,
          schema: { schemaNames: [{ name: 'post' }] },
        },
      ],
    })
    mockGetItemVersionsFromEas.mockResolvedValue([
      {
        id: v1,
        decodedDataJson: '',
        refUID: seedUid,
        schemaId: '0xversion',
        timeCreated: 110,
      },
      {
        id: v2,
        decodedDataJson: '',
        refUID: seedUid,
        schemaId: '0xversion',
        timeCreated: 210,
      },
    ])
    mockGetItemPropertiesFromEas.mockResolvedValue([
      {
        id: '0xp1',
        decodedDataJson: propDecoded('title', 'First'),
        refUID: v1,
        schemaId: '0xtitleSchema',
        timeCreated: 120,
      },
      {
        id: '0xp2',
        decodedDataJson: propDecoded('title', 'Second'),
        refUID: v2,
        schemaId: '0xtitleSchema',
        timeCreated: 220,
      },
    ])

    const withCl = await getSeed(seedUid, {
      include: 'data+changelog',
      expandRelations: false,
      hydrateStorage: false,
    })
    expect(withCl?.changelog?.length).toBeGreaterThan(0)

    const dataKey = buildAssembleOptionsKey({
      expandRelations: false,
      hydrateStorage: false,
    })
    const clKey = buildAssembleOptionsKey({
      include: 'data+changelog',
      expandRelations: false,
      hydrateStorage: false,
    })
    expect(dataKey).not.toBe(clKey)
    expect(await getQueryCacheManager().getItem(seedUid, dataKey)).toBeNull()
    expect(
      (await getQueryCacheManager().getItem(seedUid, clKey))?.record.changelog,
    ).toHaveLength(2)
  })
})
