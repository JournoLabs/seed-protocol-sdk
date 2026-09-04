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
