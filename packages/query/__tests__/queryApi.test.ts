import { describe, it, expect, vi, beforeEach } from 'vitest'

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
import type { AttestationLike } from '../src/types'

function propDecoded(name: string, value: string, type = 'string') {
  return JSON.stringify([{ value: { name, value, type } }])
}

describe('queryBySchema / getSeed / assembleSeeds', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequest.mockResolvedValue({ itemSeeds: [] })
  })

  it('queryBySchema returns SeedRecord envelope with data.title', async () => {
    const seedUid = '0xseed1'
    const versionUid = '0xver1'
    mockGetSeedsBySchemaName.mockResolvedValue([
      {
        id: seedUid,
        decodedDataJson: '',
        refUID: '0x0',
        schemaId: '0xschema',
        timeCreated: 100,
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
        timeCreated: 110,
      },
    ])
    mockGetItemPropertiesFromEas.mockResolvedValue([
      {
        id: '0xprop1',
        decodedDataJson: propDecoded('title', 'Hello Post'),
        refUID: versionUid,
        schemaId: '0xtitleSchema',
        timeCreated: 120,
      },
    ])

    const result = await queryBySchema('post', {
      limit: 10,
      skip: 0,
      expandRelations: false,
      hydrateStorage: false,
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
    const result = await getSeed('0xmissing', { hydrateStorage: false })
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
