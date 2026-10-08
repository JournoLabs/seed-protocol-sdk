import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Unit tests for local attestation mapping helpers via createLocalQueryDataSource
 * with a mocked BaseDb.
 */

const mockSelectChain: Record<string, any> = {}

function resetSelectChain(result: unknown[] = []) {
  const terminal = Promise.resolve(result)
  const self: any = mockSelectChain
  self.from = vi.fn(() => self)
  self.innerJoin = vi.fn(() => self)
  self.orderBy = vi.fn(() => self)
  self.limit = vi.fn(() => terminal)
  self.where = vi.fn(() => ({
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      terminal.then(resolve, reject),
    orderBy: () => ({
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        terminal.then(resolve, reject),
      limit: () => terminal,
    }),
    limit: () => terminal,
    innerJoin: () => self,
  }))
}

vi.mock('@/db/Db/BaseDb', () => ({
  BaseDb: {
    getAppDb: () => ({
      select: () => mockSelectChain,
    }),
    isAppDbReady: () => true,
  },
}))

vi.mock('@/helpers/FileManager/BaseFileManager', () => ({
  BaseFileManager: {
    getFilesPath: (...parts: string[]) => parts.join('/'),
    readFileAsString: vi.fn().mockRejectedValue(new Error('missing')),
  },
}))

vi.mock('@seedprotocol/query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@seedprotocol/query')>()
  return {
    ...actual,
    getSeed: vi.fn(async (uid: string, opts?: { source?: string }) => {
      if (opts?.source === 'local' || opts?.source === 'auto') {
        return {
          seedUid: uid,
          schemaName: 'post',
          timeCreated: 1,
          versionUid: '0xv',
          data: { title: 'from-query' },
        }
      }
      return null
    }),
  }
})

import { createLocalQueryDataSource } from '../../src/query/createLocalQueryDataSource'
import {
  registerSeedQueryLocalSource,
  unregisterSeedQueryLocalSource,
  getPublishedSeedRecord,
} from '../../src/query/registerSeedQueryLocalSource'

describe('createLocalQueryDataSource', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    unregisterSeedQueryLocalSource()
    resetSelectChain([])
  })

  afterEach(() => {
    unregisterSeedQueryLocalSource()
  })

  it('kind is local', () => {
    const ds = createLocalQueryDataSource()
    expect(ds.kind).toBe('local')
  })

  it('getSeedByUid returns null when no row', async () => {
    resetSelectChain([])
    const ds = createLocalQueryDataSource()
    expect(await ds.getSeedByUid('0xmissing')).toBeNull()
  })

  it('getSeedByUid maps a published seed row', async () => {
    const uid =
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    resetSelectChain([
      {
        uid,
        schemaUid: '0xschema',
        type: 'post',
        publisher: '0xpub',
        attestationRaw: null,
        attestationCreatedAt: 1_700_000_000_000,
        revokedAt: null,
      },
    ])
    const ds = createLocalQueryDataSource()
    const seed = await ds.getSeedByUid(uid)
    expect(seed?.id).toBe(uid)
    expect(seed?.timeCreated).toBe(1_700_000_000)
    expect(seed?.attester).toBe('0xpub')
  })

  it('getSeedByUid skips draft / invalid uid', async () => {
    resetSelectChain([
      {
        uid: 'NULL',
        schemaUid: '0xschema',
        type: 'post',
        publisher: '0xpub',
        attestationRaw: null,
        attestationCreatedAt: 1000,
        revokedAt: null,
      },
    ])
    const ds = createLocalQueryDataSource()
    expect(await ds.getSeedByUid('NULL')).toBeNull()
  })

  describe('revocation follows the local revoked_at columns', () => {
    const seedUid = '0x' + 'c1'.repeat(32)
    const versionLive = '0x' + 'c2'.repeat(32)
    const versionRevoked = '0x' + 'c3'.repeat(32)
    const propertyLive = '0x' + 'c4'.repeat(32)
    const propertyRevoked = '0x' + 'c5'.repeat(32)
    const titleSchema = '0x' + 'c6'.repeat(32)

    // attestation_raw as stored at fetch time: still live, though the row was revoked since.
    const staleRaw = (id: string, refUID: string, schemaId: string, timeCreated: number) =>
      JSON.stringify({
        id,
        refUID,
        schemaId,
        timeCreated,
        decodedDataJson: '',
        revoked: false,
        revocationTime: 0,
      })

    it('leaves out versions whose revoked_at is set, like the remote source (excludeRevoked)', async () => {
      resetSelectChain([
        {
          uid: versionLive,
          seedUid,
          publisher: '0xpub',
          attestationRaw: staleRaw(versionLive, seedUid, '0xv', 100),
          attestationCreatedAt: 100_000,
          revokedAt: null,
        },
        {
          uid: versionRevoked,
          seedUid,
          publisher: '0xpub',
          attestationRaw: staleRaw(versionRevoked, seedUid, '0xv', 200),
          attestationCreatedAt: 200_000,
          revokedAt: 1_700_000_500,
        },
      ])
      const ds = createLocalQueryDataSource()
      const out = await ds.getVersionsForSeeds([seedUid])
      expect(out.map((v) => v.id)).toEqual([versionLive])
      expect(out[0]).toMatchObject({ revoked: false, revocationTime: 0 })
    })

    it('leaves out revoked property rows, so the newest live one is canonical', async () => {
      const { pickLatestPropertyAttestationsByRefAndSchema } = await import('@seedprotocol/eas')
      resetSelectChain([
        {
          uid: propertyLive,
          schemaUid: titleSchema,
          propertyName: 'title',
          propertyValue: 'live',
          easDataType: 'string',
          versionUid: versionLive,
          publisher: '0xpub',
          attestationRaw: staleRaw(propertyLive, versionLive, titleSchema, 100),
          attestationCreatedAt: 100_000,
          revokedAt: null,
        },
        {
          uid: propertyRevoked,
          schemaUid: titleSchema,
          propertyName: 'title',
          propertyValue: 'revoked',
          easDataType: 'string',
          versionUid: versionLive,
          publisher: '0xpub',
          attestationRaw: staleRaw(propertyRevoked, versionLive, titleSchema, 200),
          attestationCreatedAt: 200_000,
          revokedAt: 1_700_000_600,
        },
      ])
      const ds = createLocalQueryDataSource()
      const out = await ds.getPropertiesForVersionUids([versionLive])
      expect(out.map((p) => p.id)).toEqual([propertyLive])
      expect(out[0]).toMatchObject({ revoked: false, revocationTime: 0 })
      expect(pickLatestPropertyAttestationsByRefAndSchema(out).map((p) => p.id)).toEqual([
        propertyLive,
      ])
    })

    it('reports a live seed as not revoked even when its stored attestation says otherwise', async () => {
      resetSelectChain([
        {
          uid: seedUid,
          schemaUid: '0xschema',
          type: 'post',
          publisher: '0xpub',
          attestationRaw: JSON.stringify({
            id: seedUid,
            refUID: '0x' + '00'.repeat(32),
            schemaId: '0xschema',
            timeCreated: 50,
            decodedDataJson: '',
            revoked: true,
            revocationTime: 60,
          }),
          attestationCreatedAt: 50_000,
          revokedAt: null,
        },
      ])
      const ds = createLocalQueryDataSource()
      expect(await ds.getSeedByUid(seedUid)).toMatchObject({
        id: seedUid,
        revoked: false,
        revocationTime: 0,
      })
    })
  })

  it('registerSeedQueryLocalSource + getPublishedSeedRecord', async () => {
    const { getSeed } = await import('@seedprotocol/query')
    registerSeedQueryLocalSource({ force: true })
    const record = await getPublishedSeedRecord(
      '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      { source: 'local' },
    )
    expect(record?.data.title).toBe('from-query')
    expect(getSeed).toHaveBeenCalled()
  })
})
