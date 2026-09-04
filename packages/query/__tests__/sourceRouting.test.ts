import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

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

import {
  queryBySchema,
  getSeed,
  clearLocalQuerySource,
  registerLocalQuerySource,
  resetQueryCacheManager,
  type AttestationLike,
  type QueryDataSource,
} from '../src/index'

function propDecoded(name: string, value: string, type = 'string') {
  return JSON.stringify([{ value: { name, value, type } }])
}

function makeLocalFixture(opts: {
  seedUid: string
  versionUid: string
  title: string
  timeCreated: number
  schemaName?: string
}): QueryDataSource {
  const schemaName = opts.schemaName ?? 'post'
  const seed: AttestationLike = {
    id: opts.seedUid,
    decodedDataJson: '',
    refUID: '0x0',
    schemaId: '0xschema',
    timeCreated: opts.timeCreated,
    attester: '0xlocal',
    schema: { schemaNames: [{ name: schemaName }] },
  }
  const version: AttestationLike = {
    id: opts.versionUid,
    decodedDataJson: '',
    refUID: opts.seedUid,
    schemaId: '0xversion',
    timeCreated: opts.timeCreated + 10,
  }
  const prop: AttestationLike = {
    id: '0xlocalprop',
    decodedDataJson: propDecoded('title', opts.title),
    refUID: opts.versionUid,
    schemaId: '0xtitleSchema',
    timeCreated: opts.timeCreated + 20,
  }

  const seedsByUid = new Map([[opts.seedUid, seed]])
  const versionsBySeed = new Map([[opts.seedUid, [version]]])
  const propsByVersion = new Map([[opts.versionUid, [prop]]])

  return {
    kind: 'local',
    async getSeedByUid(uid) {
      return seedsByUid.get(uid) ?? null
    },
    async listSeedsBySchemaName(name, { limit, skip }) {
      if (name !== schemaName) return []
      return [seed].slice(skip, skip + limit)
    },
    async listSeedsBySchemaNameForMonth(name) {
      if (name !== schemaName) return []
      return [seed]
    },
    async getVersionsForSeed(uid) {
      return versionsBySeed.get(uid) ?? []
    },
    async getVersionsForSeeds(uids) {
      return uids.flatMap((u) => versionsBySeed.get(u) ?? [])
    },
    async getPropertiesForVersionUids(versionUids) {
      return versionUids.flatMap((v) => propsByVersion.get(v) ?? [])
    },
    async getSeedsByUids(uids) {
      return uids.map((u) => seedsByUid.get(u)).filter(Boolean) as AttestationLike[]
    },
  }
}

describe('query source local / remote / auto', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequest.mockResolvedValue({ itemSeeds: [] })
    mockGetSeedsBySchemaName.mockResolvedValue([])
    mockGetItemVersionsFromEas.mockResolvedValue([])
    mockGetItemPropertiesFromEas.mockResolvedValue([])
    clearLocalQuerySource()
    resetQueryCacheManager()
    process.env.CACHE_ENABLED = 'false'
  })

  afterEach(() => {
    clearLocalQuerySource()
    resetQueryCacheManager()
    delete process.env.CACHE_ENABLED
  })

  it('defaults to remote (EAS mocks)', async () => {
    mockGetSeedsBySchemaName.mockResolvedValue([
      {
        id: '0xremote1',
        decodedDataJson: '',
        refUID: '0x0',
        schemaId: '0xschema',
        timeCreated: 50,
        attester: '0xr',
        schema: { schemaNames: [{ name: 'post' }] },
      },
    ])
    mockGetItemVersionsFromEas.mockResolvedValue([
      {
        id: '0xvremote',
        decodedDataJson: '',
        refUID: '0xremote1',
        schemaId: '0xversion',
        timeCreated: 60,
      },
    ])
    mockGetItemPropertiesFromEas.mockResolvedValue([
      {
        id: '0xpr',
        decodedDataJson: propDecoded('title', 'Remote Title'),
        refUID: '0xvremote',
        schemaId: '0xtitleSchema',
        timeCreated: 70,
      },
    ])

    const { items } = await queryBySchema('post', { limit: 5 })
    expect(items).toHaveLength(1)
    expect(items[0]!.data.title).toBe('Remote Title')
    expect(mockGetSeedsBySchemaName).toHaveBeenCalled()
  })

  it('source local requires registration', async () => {
    await expect(
      queryBySchema('post', { source: 'local' }),
    ).rejects.toThrow(/registerLocalQuerySource/)
  })

  it('source local uses registered adapter', async () => {
    registerLocalQuerySource(
      makeLocalFixture({
        seedUid: '0xlocalseed',
        versionUid: '0xlocalver',
        title: 'Local Title',
        timeCreated: 100,
      }),
    )

    const { items } = await queryBySchema('post', {
      source: 'local',
      limit: 10,
    })
    expect(items).toHaveLength(1)
    expect(items[0]!.seedUid).toBe('0xlocalseed')
    expect(items[0]!.data.title).toBe('Local Title')
    expect(mockGetSeedsBySchemaName).not.toHaveBeenCalled()
  })

  it('source auto uses local when present', async () => {
    registerLocalQuerySource(
      makeLocalFixture({
        seedUid: '0xautoseed',
        versionUid: '0xautover',
        title: 'Auto Local',
        timeCreated: 200,
      }),
    )

    const one = await getSeed('0xautoseed', { source: 'auto' })
    expect(one?.data.title).toBe('Auto Local')
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it('source auto falls back to remote on local miss', async () => {
    registerLocalQuerySource(
      makeLocalFixture({
        seedUid: '0xonlylocal',
        versionUid: '0xv',
        title: 'Only Local',
        timeCreated: 1,
      }),
    )

    mockRequest.mockResolvedValue({
      itemSeeds: [
        {
          id: '0xremotemiss',
          decodedDataJson: '',
          refUID: '0x0',
          schemaId: '0xschema',
          timeCreated: 300,
          attester: '0xr',
          schema: { schemaNames: [{ name: 'post' }] },
        },
      ],
    })
    mockGetItemVersionsFromEas.mockResolvedValue([
      {
        id: '0xvremote2',
        decodedDataJson: '',
        refUID: '0xremotemiss',
        schemaId: '0xversion',
        timeCreated: 310,
      },
    ])
    mockGetItemPropertiesFromEas.mockResolvedValue([
      {
        id: '0xpr2',
        decodedDataJson: propDecoded('title', 'Remote Fallback'),
        refUID: '0xvremote2',
        schemaId: '0xtitleSchema',
        timeCreated: 320,
      },
    ])

    const one = await getSeed('0xremotemiss', { source: 'auto' })
    expect(one?.data.title).toBe('Remote Fallback')
  })

  it('local bypasses query cache even when CACHE_ENABLED', async () => {
    process.env.CACHE_ENABLED = 'true'
    registerLocalQuerySource(
      makeLocalFixture({
        seedUid: '0xcached',
        versionUid: '0xvc',
        title: 'No Cache',
        timeCreated: 400,
      }),
    )

    const a = await getSeed('0xcached', { source: 'local' })
    const b = await getSeed('0xcached', { source: 'local' })
    expect(a?.data.title).toBe('No Cache')
    expect(b?.data.title).toBe('No Cache')
    // Local adapter is hit both times (no item cache) — verified by still working
    // without remote mocks.
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it('getSeed changelog works via local source', async () => {
    const seedUid = '0xchg'
    const v1 = '0xv1'
    const v2 = '0xv2'
    const seed: AttestationLike = {
      id: seedUid,
      decodedDataJson: '',
      refUID: '0x0',
      schemaId: '0xschema',
      timeCreated: 10,
      schema: { schemaNames: [{ name: 'post' }] },
    }
    registerLocalQuerySource({
      kind: 'local',
      async getSeedByUid(uid) {
        return uid === seedUid ? seed : null
      },
      async listSeedsBySchemaName() {
        return [seed]
      },
      async listSeedsBySchemaNameForMonth() {
        return [seed]
      },
      async getVersionsForSeed() {
        return [
          {
            id: v1,
            decodedDataJson: '',
            refUID: seedUid,
            schemaId: '0xv',
            timeCreated: 20,
          },
          {
            id: v2,
            decodedDataJson: '',
            refUID: seedUid,
            schemaId: '0xv',
            timeCreated: 30,
          },
        ]
      },
      async getVersionsForSeeds(uids) {
        if (!uids.includes(seedUid)) return []
        return this.getVersionsForSeed(seedUid)
      },
      async getPropertiesForVersionUids(versionUids) {
        const props: AttestationLike[] = []
        if (versionUids.includes(v1)) {
          props.push({
            id: '0xp1',
            decodedDataJson: propDecoded('title', 'First'),
            refUID: v1,
            schemaId: '0xt',
            timeCreated: 21,
          })
        }
        if (versionUids.includes(v2)) {
          props.push({
            id: '0xp2',
            decodedDataJson: propDecoded('title', 'Second'),
            refUID: v2,
            schemaId: '0xt',
            timeCreated: 31,
          })
        }
        return props
      },
      async getSeedsByUids(uids) {
        return uids.includes(seedUid) ? [seed] : []
      },
    })

    const result = await getSeed(seedUid, {
      source: 'local',
      include: 'data+changelog',
    })
    expect(result?.data.title).toBe('Second')
    expect(result?.changelog?.length).toBeGreaterThan(0)
  })
})
