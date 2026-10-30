import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { AttestationChange, AttestationLike } from '../src/types'

/** What the mocked indexer holds: seeds, versions and properties, each with its attester. */
const chain = {
  seeds: [] as AttestationLike[],
  versions: [] as AttestationLike[],
  properties: [] as AttestationLike[],
  changes: [] as AttestationChange[],
}

const calls = {
  seeds: vi.fn(),
  versions: vi.fn(),
  properties: vi.fn(),
  changes: vi.fn(),
}

vi.mock('@seedprotocol/eas', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@seedprotocol/eas')>()
  return {
    ...actual,
    getSeedsByUidsFromEas: async ({ uids }: { uids: string[] }) => {
      calls.seeds(uids)
      return chain.seeds.filter((s) => uids.includes(s.id))
    },
    getItemVersionsFromEas: async ({
      seedUids,
      excludeRevoked = true,
    }: {
      seedUids: string[]
      excludeRevoked?: boolean
    }) => {
      calls.versions(seedUids)
      return chain.versions.filter(
        (v) => seedUids.includes(v.refUID) && !(excludeRevoked && v.revoked),
      )
    },
    getItemPropertiesFromEas: async ({ versionUids }: { versionUids: string[] }) => {
      calls.properties(versionUids)
      return chain.properties.filter((p) => versionUids.includes(p.refUID))
    },
    getAttestationChangesSince: async (opts: { refUIDs: string[]; ids: string[]; since: number }) => {
      calls.changes(opts)
      return chain.changes.filter(
        (c) =>
          (opts.refUIDs.includes(c.refUID) || opts.ids.includes(c.id)) &&
          (c.timeCreated > opts.since || c.revocationTime > opts.since),
      )
    },
    setSchemaUidForSchemaDefinition: vi.fn(),
  }
})

vi.mock('../src/bootstrap.js', () => ({
  initializeQueryPlatform: vi.fn().mockResolvedValue(undefined),
}))

import {
  getSeed,
  getSeeds,
  clearLocalQuerySource,
  registerLocalQuerySource,
  resetQueryCacheManager,
  type QueryDataSource,
} from '../src/index'

const ATTESTER = '0x' + 'a'.repeat(40)
const uid = (n: number, tag: string) => '0x' + tag + n.toString(16).padStart(63, '0')

const seedAt = (id: string, schemaName: string): AttestationLike => ({
  id,
  refUID: '0x0',
  schemaId: `0xseed-${schemaName}`,
  timeCreated: 10,
  decodedDataJson: '',
  attester: ATTESTER,
  schema: { schemaNames: [{ name: schemaName }] },
})

const versionAt = (id: string, seedUid: string, timeCreated: number): AttestationLike => ({
  id,
  refUID: seedUid,
  schemaId: '0xversion',
  timeCreated,
  decodedDataJson: '',
  attester: ATTESTER,
})

const propAt = (
  versionUid: string,
  name: string,
  value: unknown,
  timeCreated: number,
  type = 'string',
): AttestationLike => ({
  id: '0x' + Math.random().toString(16).slice(2).padEnd(64, '0'),
  refUID: versionUid,
  schemaId: `0xschema-${name}`,
  timeCreated,
  decodedDataJson: JSON.stringify([{ value: { name, value, type } }]),
  attester: ATTESTER,
})

/** A clip seed relating to a post seed, both with one version. Returns their uids. */
function addClip(n: number): { clip: string; post: string; postVersion: string } {
  const clip = uid(n, 'c')
  const clipVersion = uid(n, 'd')
  const post = uid(n, 'e')
  const postVersion = uid(n, 'f')
  chain.seeds.push(seedAt(clip, 'clip'), seedAt(post, 'post'))
  chain.versions.push(versionAt(clipVersion, clip, 11), versionAt(postVersion, post, 11))
  chain.properties.push(
    propAt(clipVersion, 'note', `clip ${n}`, 12),
    propAt(clipVersion, 'post_id', post, 12, 'bytes32'),
    propAt(postVersion, 'title', `post ${n}`, 12),
  )
  return { clip, post, postVersion }
}

const totalCalls = () =>
  calls.seeds.mock.calls.length +
  calls.versions.mock.calls.length +
  calls.properties.mock.calls.length

beforeEach(() => {
  chain.seeds = []
  chain.versions = []
  chain.properties = []
  chain.changes = []
  vi.clearAllMocks()
  resetQueryCacheManager()
  process.env.CACHE_ENABLED = 'false'
})

afterEach(() => {
  clearLocalQuerySource()
  resetQueryCacheManager()
  delete process.env.CACHE_ENABLED
  delete process.env.CACHE_DIR
  delete process.env.CACHE_TTL
})

const opts = { hydrateStorage: false }

describe('getSeeds', () => {
  it('returns seeds of different schemas keyed by uid as given, in order, with relations expanded', async () => {
    const a = addClip(1)
    const b = addClip(2)
    const missing = uid(9, 'c')
    const upper = '0x' + b.clip.slice(2).toUpperCase()

    const result = await getSeeds([b.post, a.clip, missing, upper, b.post.toUpperCase()], opts)

    expect([...result.keys()]).toEqual([b.post, a.clip, upper])
    expect(result.get(b.post)!.schemaName).toBe('post')
    expect(result.get(a.clip)!.schemaName).toBe('clip')
    expect((result.get(a.clip)!.data.post as Record<string, unknown>).title).toBe('post 1')
    expect(result.get(upper)!.seedUid).toBe(b.clip)
  })

  it('makes the same six requests for 30 seeds as for 2', async () => {
    const few = [addClip(1), addClip(2)].map((c) => c.clip)
    await getSeeds(few, opts)
    const forFew = totalCalls()

    vi.clearAllMocks()
    const many = Array.from({ length: 30 }, (_, i) => addClip(10 + i).clip)
    const result = await getSeeds(many, opts)
    expect(result.size).toBe(30)
    expect(totalCalls()).toBe(forFew)
    // Seeds, versions, properties; then the same for related seeds.
    expect(forFew).toBe(6)
  })

  it('returns an empty map for no uids, without a request', async () => {
    expect((await getSeeds(['', '  '], opts)).size).toBe(0)
    expect(totalCalls()).toBe(0)
  })

  it('reads pinned seeds at their version and leaves out seeds without it', async () => {
    const a = addClip(1)
    const b = addClip(2)
    const v2 = uid(1, 'b')
    chain.versions.push(versionAt(v2, a.post, 30))
    chain.properties.push(propAt(v2, 'title', 'post 1, v2', 31))

    const result = await getSeeds([a.post, b.post], {
      ...opts,
      pins: new Map([
        [a.post.toUpperCase().replace('0X', '0x'), { versionUid: a.postVersion }],
        [b.post, { versionUid: v2 }],
      ]),
    })
    expect([...result.keys()]).toEqual([a.post])
    expect(result.get(a.post)!.versionUid).toBe(a.postVersion)
    expect(result.get(a.post)!.data.title).toBe('post 1')

    const latest = await getSeeds([a.post], opts)
    expect(latest.get(a.post)!.data.title).toBe('post 1, v2')
  })
})

describe('getSeed with a version', () => {
  it('reads the version, with patches made to it until asOf', async () => {
    const a = addClip(1)
    const v2 = uid(1, 'b')
    chain.versions.push(versionAt(v2, a.post, 30))
    chain.properties.push(
      propAt(v2, 'title', 'v2', 31),
      propAt(a.postVersion, 'title', 'post 1, patched', 20),
    )

    expect((await getSeed(a.post, opts))!.data.title).toBe('v2')
    const pinned = await getSeed(a.post, { ...opts, versionUid: a.postVersion })
    expect(pinned!.versionUid).toBe(a.postVersion)
    expect(pinned!.data.title).toBe('post 1, patched')
    const asOf = await getSeed(a.post, { ...opts, versionUid: a.postVersion, asOf: 15 })
    expect(asOf!.data.title).toBe('post 1')
    const latestAsOf = await getSeed(a.post, { ...opts, asOf: 25 })
    expect(latestAsOf!.versionUid).toBe(a.postVersion)
  })

  it('returns null for a version the seed does not have', async () => {
    const a = addClip(1)
    const b = addClip(2)
    expect(await getSeed(a.post, { ...opts, versionUid: b.postVersion })).toBeNull()
    expect(await getSeed(a.post, { ...opts, asOf: 5 })).toBeNull()
  })

  it('keeps the changelog of every version with pinned data', async () => {
    const a = addClip(1)
    const v2 = uid(1, 'b')
    chain.versions.push(versionAt(v2, a.post, 30))
    chain.properties.push(propAt(v2, 'title', 'v2', 31))
    const record = await getSeed(a.post, {
      ...opts,
      versionUid: a.postVersion,
      include: 'data+changelog',
    })
    expect(record!.data.title).toBe('post 1')
    expect(record!.changelog).toHaveLength(2)
  })
})

describe('getSeeds with the item cache', () => {
  let cacheDir: string

  beforeEach(() => {
    cacheDir = mkdtempSync(join(tmpdir(), 'query-get-seeds-'))
    process.env.CACHE_ENABLED = 'true'
    process.env.CACHE_DIR = cacheDir
    process.env.CACHE_TTL = '3600'
    resetQueryCacheManager()
  })

  afterEach(() => {
    rmSync(cacheDir, { recursive: true, force: true })
  })

  it('checks cached seeds in one request and assembles only changed ones', async () => {
    const clips = [addClip(1), addClip(2), addClip(3)]
    const uids = clips.map((c) => c.clip)
    const first = await getSeeds(uids, opts)
    expect(first.size).toBe(3)

    vi.clearAllMocks()
    const again = await getSeeds(uids, opts)
    expect(totalCalls()).toBe(0)
    expect(calls.changes).toHaveBeenCalledTimes(1)
    expect([...again.values()]).toEqual([...first.values()])
    // Shared with getSeed under the same options.
    expect(await getSeed(uids[0]!, opts)).toBe(again.get(uids[0]!))

    // A patch to clip 2's related post changes clip 2 only.
    const patched = propAt(clips[1]!.postVersion, 'title', 'post 2, patched', 50)
    chain.properties.push(patched)
    chain.changes.push({
      id: patched.id,
      refUID: patched.refUID,
      timeCreated: Math.floor(Date.now() / 1000) + 5,
      revocationTime: 0,
    })
    vi.clearAllMocks()
    const changed = await getSeeds(uids, opts)
    expect(calls.seeds.mock.calls[0]![0]).toEqual([clips[1]!.clip])
    expect((changed.get(clips[1]!.clip)!.data.post as Record<string, unknown>).title).toBe(
      'post 2, patched',
    )
    expect(changed.get(clips[0]!.clip)).toBe(first.get(clips[0]!.clip))
  })

  it('keeps pinned and latest reads apart', async () => {
    const a = addClip(1)
    const v2 = uid(1, 'b')
    chain.versions.push(versionAt(v2, a.post, 30))
    chain.properties.push(propAt(v2, 'title', 'v2', 31))

    const latest = await getSeeds([a.post], opts)
    const pinned = await getSeeds([a.post], {
      ...opts,
      pins: new Map([[a.post, { versionUid: a.postVersion }]]),
    })
    expect(latest.get(a.post)!.data.title).toBe('v2')
    expect(pinned.get(a.post)!.data.title).toBe('post 1')
  })
})

describe('getSeeds with source auto', () => {
  it('reads seeds the local source does not have from remote', async () => {
    const a = addClip(1)
    const b = addClip(2)
    const localSeeds = new Map([[a.clip, seedAt(a.clip, 'clip')]])
    const local: QueryDataSource = {
      kind: 'local',
      getSeedByUid: async (u) => localSeeds.get(u) ?? null,
      listSeedsBySchemaName: async () => [],
      listSeedsBySchemaNameForMonth: async () => [],
      getVersionsForSeed: async () => [],
      getVersionsForSeeds: async (uids) =>
        chain.versions.filter((v) => uids.includes(v.refUID) && v.refUID === a.clip),
      getPropertiesForVersionUids: async (uids) =>
        chain.properties
          .filter((p) => uids.includes(p.refUID) && p.decodedDataJson.includes('note'))
          .map((p) => ({ ...p, decodedDataJson: p.decodedDataJson.replace('clip 1', 'local clip 1') })),
      getSeedsByUids: async (uids) =>
        uids.map((u) => localSeeds.get(u)).filter(Boolean) as AttestationLike[],
    }
    registerLocalQuerySource(local)

    const result = await getSeeds([a.clip, b.clip], { ...opts, source: 'auto' })
    expect(result.get(a.clip)!.data.note).toBe('local clip 1')
    expect(result.get(b.clip)!.data.note).toBe('clip 2')
    expect(calls.seeds.mock.calls.map((c) => c[0])).toEqual([[b.clip], [b.post]])
  })
})
