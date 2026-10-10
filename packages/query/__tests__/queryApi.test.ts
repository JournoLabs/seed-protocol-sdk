import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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
    // Seeds by uid answer from the same mocked request as before (fixtures carry their schema names).
    getAttestationChangesSince: (...args: unknown[]) => mockGetAttestationChangesSince(...args),
    getSeedsByUidsFromEas: async (...args: unknown[]) =>
      ((await mockRequest(...args)) as { itemSeeds?: unknown[] } | undefined)?.itemSeeds ?? [],
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
    mockGetAttestationChangesSince.mockResolvedValue([])
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
    mockGetAttestationChangesSince.mockResolvedValue([])
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

  const uncachedOpts = { limit: 10, skip: 0, expandRelations: false, hydrateStorage: false }
  const optionsKey = buildAssembleOptionsKey(uncachedOpts)

  it('caches collection on skip=0 and returns etag', async () => {
    mockAssembledPost('0xseed1', '0xver1', 'Cached', 100)
    const first = await queryBySchema('post', uncachedOpts)
    expect(first.etag).toMatch(/^"[a-f0-9]{16}"$/)
    expect(mockGetSeedsBySchemaName).toHaveBeenCalledTimes(1)
    expect(mockGetItemPropertiesFromEas).toHaveBeenCalledTimes(1)

    const second = await queryBySchema('post', uncachedOpts)
    expect(second.items[0]!.data.title).toBe('Cached')
    expect(second.etag).toBe(first.etag)
    // The seed list is fetched every time; unchanged seeds are not assembled again.
    expect(mockGetSeedsBySchemaName).toHaveBeenCalledTimes(2)
    expect(mockGetAttestationChangesSince).toHaveBeenCalledTimes(1)
    expect(mockGetAttestationChangesSince.mock.calls[0]![0]).toMatchObject({
      refUIDs: expect.arrayContaining(['0xseed1', '0xver1']),
      ids: ['0xseed1'],
    })
    expect(mockGetItemPropertiesFromEas).toHaveBeenCalledTimes(1)
  })

  it('a patch edit on the same version reaches the cached collection and item', async () => {
    mockAssembledPost('0xseed1', '0xver1', 'Before', 100)
    const first = await queryBySchema('post', uncachedOpts)

    // New property attestation on the existing version (default 'patch' publish).
    mockAssembledPost('0xseed1', '0xver1', 'After', 100)
    mockGetAttestationChangesSince.mockResolvedValue([
      { id: '0xprop2', refUID: '0xver1', timeCreated: 9_999_999_999, revocationTime: 0 },
    ])
    const second = await queryBySchema('post', uncachedOpts)
    expect(second.items[0]!.data.title).toBe('After')
    expect(second.etag).not.toBe(first.etag)
    expect(
      (await getQueryCacheManager().getItem('0xseed1', optionsKey))?.record.data.title,
    ).toBe('After')
  })

  it('assembles only seeds new to the list, and drops seeds no longer listed', async () => {
    mockAssembledPost('0xseed1', '0xver1', 'One', 100)
    await queryBySchema('post', uncachedOpts)

    mockAssembledPost('0xseed2', '0xver2', 'Two', 200)
    const second = await queryBySchema('post', uncachedOpts)
    expect(second.items.map((r) => r.seedUid)).toEqual(['0xseed2'])
    expect(mockGetItemVersionsFromEas).toHaveBeenLastCalledWith(
      expect.objectContaining({ seedUids: ['0xseed2'] }),
    )
  })

  it('a failed change check fails the read instead of serving unchecked data', async () => {
    mockAssembledPost('0xseed1', '0xver1', 'One', 100)
    await queryBySchema('post', uncachedOpts)
    expect(mockGetItemPropertiesFromEas).toHaveBeenCalledTimes(1)

    mockGetAttestationChangesSince.mockRejectedValueOnce(new Error('indexer down'))
    await expect(queryBySchema('post', uncachedOpts)).rejects.toThrow('indexer down')
  })

  it('keeps collections for different assemble options apart', async () => {
    mockAssembledPost('0xseed1', '0xver1', 'One', 100)
    await queryBySchema('post', uncachedOpts)
    await queryBySchema('post', { ...uncachedOpts, expandRelations: true })
    expect(mockGetItemPropertiesFromEas).toHaveBeenCalledTimes(2)
    expect(
      await getQueryCacheManager().getCollection(
        'post',
        buildAssembleOptionsKey({ expandRelations: true, hydrateStorage: false }),
      ),
    ).not.toBeNull()
  })

  it('cache:false bypasses collection cache', async () => {
    mockAssembledPost('0xseed1', '0xver1', 'A', 100)
    await queryBySchema('post', { ...uncachedOpts, cache: false })
    expect(await getQueryCacheManager().getCollection('post', optionsKey)).toBeNull()
  })

  it('skip > 0 bypasses collection cache', async () => {
    mockAssembledPost('0xseed1', '0xver1', 'Page2', 100)
    const result = await queryBySchema('post', { ...uncachedOpts, skip: 10 })
    expect(result.etag).toBeUndefined()
    expect(await getQueryCacheManager().getCollection('post', optionsKey)).toBeNull()
    expect(
      (await getQueryCacheManager().getItem('0xseed1', optionsKey))?.record.data
        .title,
    ).toBe('Page2')
  })

  it('getSeed hits item cache after collection populate, after checking for changes', async () => {
    mockAssembledPost('0xseed1', '0xver1', 'FromCollection', 100)
    await queryBySchema('post', uncachedOpts)

    mockRequest.mockClear()
    const hit = await getSeed('0xseed1', {
      expandRelations: false,
      hydrateStorage: false,
    })
    expect(hit?.data.title).toBe('FromCollection')
    expect(mockRequest).not.toHaveBeenCalled()
    expect(mockGetAttestationChangesSince).toHaveBeenCalledTimes(1)
  })

  it('getSeed re-assembles a cached seed that changed', async () => {
    mockAssembledPost('0xseed1', '0xver1', 'Before', 100)
    mockRequest.mockResolvedValue({
      itemSeeds: [
        {
          id: '0xseed1',
          decodedDataJson: '',
          refUID: '0x0',
          schemaId: '0xschema',
          timeCreated: 100,
          schema: { schemaNames: [{ name: 'post' }] },
        },
      ],
    })
    const opts = { expandRelations: false, hydrateStorage: false }
    expect((await getSeed('0xseed1', opts))?.data.title).toBe('Before')

    mockAssembledPost('0xseed1', '0xver2', 'New version', 100)
    mockGetAttestationChangesSince.mockResolvedValue([
      { id: '0xver2', refUID: '0xseed1', timeCreated: 9_999_999_999, revocationTime: 0 },
    ])
    const after = await getSeed('0xseed1', opts)
    expect(after?.data.title).toBe('New version')
    expect(after?.versionUid).toBe('0xver2')
  })

  it('getSeed returns null and drops the cached item when the seed was revoked', async () => {
    mockAssembledPost('0xseed1', '0xver1', 'Live', 100)
    await queryBySchema('post', uncachedOpts)

    mockGetAttestationChangesSince.mockResolvedValue([
      { id: '0xseed1', refUID: '0x0', timeCreated: 100, revocationTime: 9_999_999_999 },
    ])
    mockRequest.mockResolvedValue({ itemSeeds: [] })
    expect(await getSeed('0xseed1', { expandRelations: false, hydrateStorage: false })).toBeNull()
    expect(await getQueryCacheManager().getItem('0xseed1', optionsKey)).toBeNull()
  })

  describe('uidPrefix', () => {
    const SEED = '0xfd8c50ca' + '0'.repeat(56)

    it('lists by normalized prefix, skips the collection cache, writes items through', async () => {
      mockAssembledPost(SEED, '0xver1', 'Found', 100)
      const result = await queryBySchema('post', { ...uncachedOpts, uidPrefix: 'FD8C50CA', limit: 16 })

      expect(result.items.map((r) => r.data.title)).toEqual(['Found'])
      expect(result.etag).toBeUndefined()
      expect(mockGetSeedsBySchemaName).toHaveBeenCalledWith('post', 16, 0, { uidPrefix: '0xfd8c50ca' })
      expect(await getQueryCacheManager().getCollection('post', optionsKey)).toBeNull()
      expect((await getQueryCacheManager().getItem(SEED, optionsKey))?.record.data.title).toBe('Found')
    })

    it('does not touch an existing collection', async () => {
      mockAssembledPost(SEED, '0xver1', 'Listed', 100)
      const listed = await queryBySchema('post', uncachedOpts)
      await queryBySchema('post', { ...uncachedOpts, uidPrefix: '0xfd8c' })
      expect((await getQueryCacheManager().getCollection('post', optionsKey))?.etag).toBe(listed.etag)
    })

    it('returns no items, without a request, for an invalid prefix', async () => {
      for (const uidPrefix of ['', '0x', 'fd8', 'xyz12345', '0x' + 'a'.repeat(65)]) {
        expect((await queryBySchema('post', { ...uncachedOpts, uidPrefix })).items).toEqual([])
      }
      expect(mockGetSeedsBySchemaName).not.toHaveBeenCalled()
    })

    it('drops a matching seed whose versions were all revoked', async () => {
      mockAssembledPost(SEED, '0xver1', 'Gone', 100)
      mockGetItemVersionsFromEas.mockResolvedValue([
        { id: '0xver1', decodedDataJson: '', refUID: SEED, schemaId: '0xversion', timeCreated: 110, revoked: true },
      ])
      expect((await queryBySchema('post', { ...uncachedOpts, uidPrefix: '0xfd8c50ca' })).items).toEqual([])
    })
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
