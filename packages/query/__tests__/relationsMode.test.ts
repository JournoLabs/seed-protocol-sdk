import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/bootstrap.js', () => ({
  initializeQueryPlatform: vi.fn().mockResolvedValue(undefined),
}))

import { getSeed, getSeeds, queryBySchema, queryBySchemaForMonth } from '../src/api'
import { decodePropertyAttestation } from '../src/changelog'
import { assembleSeeds, assembleSeedsWithDependencies } from '../src/assembleSeeds'
import { buildAssembleOptionsKey } from '../src/cache/index'
import { clearLocalQuerySource, registerLocalQuerySource } from '../src/source/index'
import type { QueryDataSource } from '../src/source/types'
import { relationsModeOf, type AttestationLike } from '../src/types'

const POST = '0x' + 'a'.repeat(64)
const POST_V = '0x' + 'b'.repeat(64)
const AUTHOR = '0x' + 'c'.repeat(64)
const AUTHOR_V = '0x' + 'd'.repeat(64)
const BODY = '0x' + 'e'.repeat(64)
const BODY_V = '0x' + 'f'.repeat(64)
const BODY_TX = 'x'.repeat(43)

const prop = (id: string, versionUid: string, name: string, value: unknown, type = 'string') => ({
  id,
  refUID: versionUid,
  schemaId: `0xschema-${name}`,
  timeCreated: 20,
  decodedDataJson: JSON.stringify([{ value: { name, value, type } }]),
})

const seed = (id: string, schemaName: string): AttestationLike => ({
  id,
  refUID: '0x0',
  schemaId: '0xseedschema',
  timeCreated: 10,
  decodedDataJson: '',
  schema: { schemaNames: [{ name: schemaName }] },
})

const version = (id: string, seedUid: string): AttestationLike => ({
  id,
  refUID: seedUid,
  schemaId: '0xversion',
  timeCreated: 11,
  decodedDataJson: '',
})

/** A post relating to an author (nested on expand) and an Html body (a URL on expand). */
function makeSource(calls: string[], extraProps: AttestationLike[] = []): QueryDataSource {
  const seeds = new Map([
    [POST, seed(POST, 'post')],
    [AUTHOR, seed(AUTHOR, 'author')],
    [BODY, seed(BODY, 'html')],
  ])
  const versions = [version(POST_V, POST), version(AUTHOR_V, AUTHOR), version(BODY_V, BODY)]
  const props = [
    prop('0xp1', POST_V, 'title', 'Hello'),
    prop('0xp2', POST_V, 'author_id', AUTHOR, 'bytes32'),
    prop('0xp3', POST_V, 'body_id', BODY, 'bytes32'),
    prop('0xp4', AUTHOR_V, 'name', 'Ada'),
    prop('0xp5', BODY_V, 'storage_transaction_id', BODY_TX),
    ...extraProps,
  ]
  const call = async <T>(name: string, result: T): Promise<T> => {
    calls.push(name)
    return result
  }
  return {
    kind: 'local',
    getSeedByUid: (uid) => call('seed', seeds.get(uid) ?? null),
    listSeedsBySchemaName: () => call('list', [seeds.get(POST)!]),
    listSeedsBySchemaNameForMonth: () => call('list', [seeds.get(POST)!]),
    getVersionsForSeed: (uid) => call('versions', versions.filter((v) => v.refUID === uid)),
    getVersionsForSeeds: (uids) =>
      call('versions', versions.filter((v) => uids.includes(v.refUID))),
    getPropertiesForVersionUids: (uids) =>
      call('properties', props.filter((p) => uids.includes(p.refUID))),
    getSeedsByUids: (uids) =>
      call('seeds', uids.map((u) => seeds.get(u)).filter(Boolean) as AttestationLike[]),
  }
}

describe("relations: 'uids'", () => {
  let calls: string[]

  beforeEach(() => {
    calls = []
    process.env.CACHE_ENABLED = 'false'
  })

  afterEach(() => {
    clearLocalQuerySource()
    delete process.env.CACHE_ENABLED
  })

  it('queryBySchema makes list, versions and properties requests only', async () => {
    registerLocalQuerySource(makeSource(calls))
    const opts = { source: 'local', hydrateStorage: false } as const

    await queryBySchema('post', { ...opts, relations: 'expand' })
    expect(calls).toEqual(['list', 'versions', 'properties', 'seeds', 'versions', 'properties'])

    calls.length = 0
    const { items } = await queryBySchema('post', { ...opts, relations: 'uids' })
    expect(calls).toEqual(['list', 'versions', 'properties'])
    expect(items[0]!.data.title).toBe('Hello')
  })

  it('keeps relation values as seed uids under their schema keys', async () => {
    const [record] = await assembleSeeds(
      'post',
      [seed(POST, 'post')],
      { relations: 'uids', hydrateStorage: false },
      makeSource(calls, [prop('0xp6', POST_V, 'editor_identity_ids', [AUTHOR], 'bytes32[]')]),
    )
    expect(record!.data).toMatchObject({ author: AUTHOR, body: BODY, editors: [AUTHOR] })
    for (const storageKey of ['author_id', 'authorId', 'body_id', 'bodyId', 'editor_identity_ids', 'editorIdentityIds']) {
      expect(record!.data).not.toHaveProperty(storageKey)
    }
  })

  it('names only the seed and its head version as dependencies', async () => {
    const source = makeSource(calls)
    const { dependencies } = await assembleSeedsWithDependencies(
      'post',
      [seed(POST, 'post')],
      { relations: 'uids', hydrateStorage: false },
      source,
    )
    expect(dependencies.get(POST)).toEqual({ refUIDs: [POST, POST_V], ids: [POST] })

    const expanded = await assembleSeedsWithDependencies(
      'post',
      [seed(POST, 'post')],
      { relations: 'expand', hydrateStorage: false },
      source,
    )
    expect(expanded.dependencies.get(POST)!.ids).toEqual([POST, AUTHOR, BODY])
  })

  it('applies to getSeed, getSeeds and queryBySchemaForMonth', async () => {
    registerLocalQuerySource(makeSource(calls))
    const opts = { source: 'local', hydrateStorage: false, relations: 'uids' } as const

    expect((await getSeed(POST, opts))?.data.author).toBe(AUTHOR)
    expect(calls.splice(0)).toEqual(['seed', 'versions', 'properties'])
    // getSeeds reads the requested seeds themselves with getSeedsByUids.
    expect((await getSeeds([POST], opts)).get(POST)?.data.author).toBe(AUTHOR)
    expect(calls.splice(0)).toEqual(['seeds', 'versions', 'properties'])
    expect((await queryBySchemaForMonth('post', 2026, 10, opts))[0]?.data.author).toBe(AUTHOR)
    expect(calls.splice(0)).toEqual(['list', 'versions', 'properties'])
  })
})

describe('relations modes', () => {
  const assemble = async (options: Parameters<typeof assembleSeeds>[2]) => {
    const [record] = await assembleSeeds(
      'post',
      [seed(POST, 'post')],
      { hydrateStorage: false, ...options },
      makeSource([]),
    )
    return record!.data
  }

  it("'expand' also nests the author", async () => {
    const data = await assemble({ relations: 'expand' })
    expect(data.body).toEqual(expect.stringContaining(BODY_TX))
    expect(data.author).toMatchObject({ seedUid: AUTHOR, name: 'Ada' })
  })

  it("'expand' keeps a relation whose seed is missing under its schema key", async () => {
    const MISSING = '0x' + '9'.repeat(64)
    const [record] = await assembleSeeds(
      'post',
      [seed(POST, 'post')],
      { relations: 'expand', hydrateStorage: false },
      makeSource([], [
        prop('0xp6', POST_V, 'editor_id', MISSING, 'bytes32'),
        prop('0xp7', POST_V, 'reviewer_identity_ids', [MISSING], 'bytes32[]'),
      ]),
    )
    expect(record!.data).toMatchObject({ editor: MISSING, reviewers: [MISSING] })
    expect(record!.data).not.toHaveProperty('editor_id')
    expect(record!.data).not.toHaveProperty('reviewer_identity_ids')
  })

  it("defaults to 'expand'", async () => {
    expect(relationsModeOf(undefined)).toBe('expand')
    expect(await assemble({})).toEqual(await assemble({ relations: 'expand' }))
  })

  it('gives each mode its own cache key', () => {
    expect(buildAssembleOptionsKey()).toBe('e6-h1')
    expect(buildAssembleOptionsKey({ relations: 'expand' })).toBe('e6-h1')
    expect(buildAssembleOptionsKey({ relations: 'uids' })).toBe('e7-h1')
    expect(buildAssembleOptionsKey({ relations: 'uids', hydrateStorage: false })).toBe('e7-h0')
  })
})

describe('which properties are relations', () => {
  // A string property whose name ends in `_id`, holding a seed UID the source can return.
  const externalId = prop('0xp8', POST_V, 'external_id', AUTHOR)

  it.each(['expand', 'uids'] as const)(
    "'%s' keeps a non-bytes32 `_id` property under its own name",
    async (relations) => {
      const calls: string[] = []
      const [record] = await assembleSeeds(
        'post',
        [seed(POST, 'post')],
        { relations, hydrateStorage: false },
        makeSource(calls, [externalId]),
      )
      expect(record!.data).toMatchObject({ external_id: AUTHOR, externalId: AUTHOR })
      expect(record!.data).not.toHaveProperty('external')
    },
  )

  it('leaves a non-bytes32 `_id` value out of the related seeds', async () => {
    const calls: string[] = []
    const props = [
      prop('0xp1', POST_V, 'title', 'Hello'),
      externalId,
    ]
    const source = makeSource(calls)
    const { dependencies } = await assembleSeedsWithDependencies(
      'post',
      [seed(POST, 'post')],
      { relations: 'expand', hydrateStorage: false },
      { ...source, getPropertiesForVersionUids: async (uids) => props.filter((p) => uids.includes(p.refUID)) },
    )
    expect(dependencies.get(POST)!.ids).toEqual([POST])
    expect(calls).not.toContain('seeds')
  })

  it('decodes a non-bytes32 `_id` property under its own name in changelogs', () => {
    expect(decodePropertyAttestation(externalId)).toMatchObject({
      propertyName: 'external_id',
      camelName: 'externalId',
      value: AUTHOR,
    })
    expect(decodePropertyAttestation(prop('0xp9', POST_V, 'author_id', AUTHOR, 'bytes32'))).toMatchObject({
      propertyName: 'author',
    })
  })

  it('falls back to the `_id` name rule when the attestation has no type', () => {
    const untyped = {
      ...externalId,
      decodedDataJson: JSON.stringify([{ value: { name: 'author_id', value: AUTHOR } }]),
    }
    expect(decodePropertyAttestation(untyped)).toMatchObject({ propertyName: 'author' })
  })
})

describe('unknown relations modes', () => {
  afterEach(() => clearLocalQuerySource())

  it("throws a TypeError for the removed 'urls' before any request", async () => {
    const calls: string[] = []
    registerLocalQuerySource(makeSource(calls))
    const urls = { source: 'local', relations: 'urls' } as unknown as Parameters<typeof queryBySchema>[1]
    await expect(queryBySchema('post', urls)).rejects.toThrow(TypeError)
    await expect(getSeed(POST, urls)).rejects.toThrow("relations must be 'expand' or 'uids'")
    expect(calls).toEqual([])
  })
})
