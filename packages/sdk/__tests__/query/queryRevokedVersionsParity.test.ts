import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  assembleSeeds,
  createRemoteQueryDataSource,
  type AttestationLike,
  type QueryDataSource,
} from '@seedprotocol/query'
import {
  BaseEasClient,
  BaseQueryClient,
  GET_PROPERTIES,
  GET_SCHEMAS,
  GET_SEEDS,
  GET_SEEDS_LEAN,
  GET_VERSIONS,
  resetSchemaNamesCache,
} from '@seedprotocol/eas'
import { BaseDb } from '@/db/Db/BaseDb'
import { seeds, versions, metadata } from '@/seedSchema'
import { createLocalQueryDataSource } from '@/query/createLocalQueryDataSource'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'

/**
 * The local (SQLite) and remote (EAS GraphQL) query sources agree on which seeds are published:
 * a seed whose versions are all revoked has no published version (as in the SDK's latest
 * published version), so both leave it out. The remote side runs the real remote source against a
 * fake EAS GraphQL client holding the same attestations as the local rows.
 */
const uid = (byte: string) => '0x' + byte.repeat(32)
const ZERO = uid('00')
const SCHEMA = 'rvparity_post'
const SEED_SCHEMA_UID = '0x' + 'f0'.repeat(31) + '01'
const VERSION_SCHEMA_UID = '0x' + 'f0'.repeat(31) + '02'
const TITLE_SCHEMA_UID = '0x' + 'f0'.repeat(31) + '03'
const ATTESTER = '0x1234567890123456789012345678901234567890'
const REVOKED_AT = 1_700_009_999

type Fixture = {
  seed: { uid: string; time: number; revoked?: boolean }
  versions: { uid: string; time: number; revoked?: boolean; title: string; propertyUid: string }[]
}

const live: Fixture = {
  seed: { uid: uid('d5'), time: 1_700_000_100 },
  versions: [{ uid: uid('d6'), time: 1_700_000_110, title: 'live', propertyUid: uid('e8') }],
}
const allRevoked: Fixture = {
  seed: { uid: uid('d7'), time: 1_700_000_200 },
  versions: [
    { uid: uid('d8'), time: 1_700_000_210, revoked: true, title: 'gone 1', propertyUid: uid('e9') },
    { uid: uid('d9'), time: 1_700_000_220, revoked: true, title: 'gone 2', propertyUid: uid('ed') },
  ],
}
const mixed: Fixture = {
  seed: { uid: uid('da'), time: 1_700_000_300 },
  versions: [
    { uid: uid('db'), time: 1_700_000_310, title: 'mixed live', propertyUid: uid('ea') },
    // Newer, but revoked: the live version is the latest published one.
    { uid: uid('dc'), time: 1_700_000_320, revoked: true, title: 'mixed revoked', propertyUid: uid('eb') },
  ],
}
const revokedSeed: Fixture = {
  seed: { uid: uid('dd'), time: 1_700_000_400, revoked: true },
  versions: [{ uid: uid('de'), time: 1_700_000_410, title: 'revoked seed', propertyUid: uid('ec') }],
}
const noVersions: Fixture = { seed: { uid: uid('df'), time: 1_700_000_500 }, versions: [] }
const fixtures = [live, allRevoked, mixed, revokedSeed, noVersions]

const titleJson = (title: string) => JSON.stringify([{ value: { name: 'title', value: title, type: 'string' } }])

/** Every fixture as EAS attestations (revoked ones included, as EAS keeps them). */
const easAttestations = (): (AttestationLike & { revoked: boolean; revocationTime: number })[] =>
  fixtures.flatMap(({ seed, versions: vs }) => [
    {
      id: seed.uid,
      decodedDataJson: '',
      refUID: ZERO,
      schemaId: SEED_SCHEMA_UID,
      timeCreated: seed.time,
      attester: ATTESTER,
      schema: { schemaNames: [{ name: SCHEMA }] },
      revoked: !!seed.revoked,
      revocationTime: seed.revoked ? REVOKED_AT : 0,
    },
    ...vs.flatMap((v) => [
      {
        id: v.uid,
        decodedDataJson: '',
        refUID: seed.uid,
        schemaId: VERSION_SCHEMA_UID,
        timeCreated: v.time,
        attester: ATTESTER,
        schema: { schemaNames: [{ name: 'version' }] },
        revoked: !!v.revoked,
        revocationTime: v.revoked ? REVOKED_AT : 0,
      },
      {
        id: v.propertyUid,
        decodedDataJson: titleJson(v.title),
        refUID: v.uid,
        schemaId: TITLE_SCHEMA_UID,
        timeCreated: v.time + 1,
        attester: ATTESTER,
        schema: { schemaNames: [{ name: 'title' }] },
        revoked: false,
        revocationTime: 0,
      },
    ]),
  ])

/** Evaluates the AttestationWhereInput shapes the remote source sends. Unknown keys fail loudly. */
const matches = (att: Record<string, any>, where: Record<string, any>): boolean =>
  Object.entries(where).every(([key, cond]) => {
    if (key === 'AND') return (cond as Record<string, any>[]).every((c) => matches(att, c))
    if (key === 'schema') {
      const name = cond?.is?.schemaNames?.some?.name?.equals
      return att.schema?.schemaNames?.some((n: { name: string }) => n.name === name)
    }
    if (key === 'timeCreated') {
      return (cond.gte == null || att.timeCreated >= cond.gte) && (cond.lt == null || att.timeCreated < cond.lt)
    }
    if (key === 'id' || key === 'refUID' || key === 'revoked') {
      if ('equals' in cond) return att[key] === cond.equals
      if ('in' in cond) return cond.in.includes(att[key])
    }
    throw new Error(`fake EAS: unsupported where ${key}: ${JSON.stringify(cond)}`)
  })

const SCHEMA_NAMES: Record<string, string> = {
  [SEED_SCHEMA_UID]: SCHEMA,
  [VERSION_SCHEMA_UID]: 'version',
  [TITLE_SCHEMA_UID]: 'title',
}

const fakeEasClient = {
  request: async (doc: unknown, vars: { where: Record<string, any>; take?: number; skip?: number }) => {
    if (doc === GET_SCHEMAS) {
      const ids: string[] = vars.where.id.in
      return { schemas: ids.map((id) => ({ id, schemaNames: [{ name: SCHEMA_NAMES[id] }] })) }
    }
    const key =
      doc === GET_SEEDS || doc === GET_SEEDS_LEAN
        ? 'itemSeeds'
        : doc === GET_VERSIONS
          ? 'itemVersions'
          : doc === GET_PROPERTIES
            ? 'itemProperties'
            : null
    if (!key) throw new Error('fake EAS: unexpected query')
    // Only GET_SEEDS selects `schema { schemaNames }`.
    const selectsSchema = doc === GET_SEEDS
    const rows = easAttestations()
      .filter((a) => matches(a, vars.where))
      .sort((a, b) => b.timeCreated - a.timeCreated)
      .map(({ schema, ...rest }) => (selectsSchema ? { ...rest, schema } : rest))
    const skip = vars.skip ?? 0
    return { [key]: vars.take != null ? rows.slice(skip, skip + vars.take) : rows.slice(skip) }
  },
}

const summarize = async (ds: QueryDataSource, seedList: AttestationLike[]) =>
  (await assembleSeeds(SCHEMA, seedList, { hydrateStorage: false, expandRelations: false }, ds))
    .map((r) => ({ seedUid: r.seedUid, versionUid: r.versionUid, title: r.data.title }))
    .sort((a, b) => a.seedUid.localeCompare(b.seedUid))

const list = async (ds: QueryDataSource) =>
  summarize(ds, await ds.listSeedsBySchemaName(SCHEMA, { limit: 100, skip: 0 }))

const getOne = async (ds: QueryDataSource, seedUid: string) => {
  const seed = await ds.getSeedByUid(seedUid)
  return seed ? summarize(ds, [seed]) : []
}

describe.sequential('local and remote query sources: seeds with revoked versions', () => {
  const local = createLocalQueryDataSource()
  const remote = createRemoteQueryDataSource()
  let previousEasImpl: unknown
  let previousQueryImpl: unknown

  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })

    previousEasImpl = (BaseEasClient as any)._impl
    previousQueryImpl = (BaseQueryClient as any)._impl
    BaseEasClient.configure({ getEasClient: () => fakeEasClient as any })
    resetSchemaNamesCache()
    BaseQueryClient.configure({
      getQueryClient: () => ({ fetchQuery: async ({ queryFn }: { queryFn: () => unknown }) => queryFn() }) as any,
    })

    const db = BaseDb.getAppDb()
    for (const { seed, versions: vs } of fixtures) {
      await db.insert(seeds).values({
        localId: `rvparity-${seed.uid.slice(2, 4)}`,
        uid: seed.uid,
        schemaUid: SEED_SCHEMA_UID,
        type: SCHEMA,
        publisher: ATTESTER,
        attestationCreatedAt: seed.time * 1000,
        createdAt: seed.time * 1000,
        revokedAt: seed.revoked ? REVOKED_AT : null,
      })
      for (const v of vs) {
        const versionLocalId = `rvparity-${v.uid.slice(2, 4)}`
        await db.insert(versions).values({
          localId: versionLocalId,
          uid: v.uid,
          seedLocalId: `rvparity-${seed.uid.slice(2, 4)}`,
          seedUid: seed.uid,
          seedType: SCHEMA,
          publisher: ATTESTER,
          attestationCreatedAt: v.time * 1000,
          createdAt: v.time * 1000,
          revokedAt: v.revoked ? REVOKED_AT : null,
        })
        await db.insert(metadata).values({
          localId: `rvparity-${v.propertyUid.slice(2, 4)}`,
          uid: v.propertyUid,
          schemaUid: TITLE_SCHEMA_UID,
          propertyName: 'title',
          propertyValue: v.title,
          easDataType: 'string',
          modelType: SCHEMA,
          seedLocalId: `rvparity-${seed.uid.slice(2, 4)}`,
          seedUid: seed.uid,
          versionLocalId,
          versionUid: v.uid,
          publisher: ATTESTER,
          attestationCreatedAt: (v.time + 1) * 1000,
          createdAt: (v.time + 1) * 1000,
        })
      }
    }
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    if (previousEasImpl) BaseEasClient.configure(previousEasImpl as any)
    if (previousQueryImpl) BaseQueryClient.configure(previousQueryImpl as any)
    await teardownTestEnvironment()
  })

  const expectedPublished = [
    { seedUid: live.seed.uid, versionUid: live.versions[0]!.uid, title: 'live' },
    { seedUid: mixed.seed.uid, versionUid: mixed.versions[0]!.uid, title: 'mixed live' },
  ]

  it('lists the same published seeds from both sources; all-revoked and revoked seeds are left out', async () => {
    const fromLocal = await list(local)
    const fromRemote = await list(remote)

    expect(fromLocal).toEqual(expectedPublished)
    // Unchanged existing difference: the remote source lists a seed with no version at all (no
    // versionUid, no data); the local source requires a published version.
    expect(fromRemote).toEqual([
      ...expectedPublished,
      { seedUid: noVersions.seed.uid, versionUid: '', title: undefined },
    ])
  })

  it('getSeed-style assembly leaves out a seed whose versions are all revoked, in both sources', async () => {
    for (const ds of [local, remote]) {
      expect(await getOne(ds, allRevoked.seed.uid)).toEqual([])
      expect(await getOne(ds, revokedSeed.seed.uid)).toEqual([])
      expect(await getOne(ds, mixed.seed.uid)).toEqual([expectedPublished[1]])
    }
  })

  it('without includeRevoked, getVersionsForSeeds still returns live versions only', async () => {
    const seedUids = [allRevoked.seed.uid, mixed.seed.uid]
    for (const ds of [local, remote]) {
      expect((await ds.getVersionsForSeeds(seedUids)).map((v) => v.id)).toEqual([mixed.versions[0]!.uid])
      const all = await ds.getVersionsForSeeds(seedUids, { includeRevoked: true })
      expect(all.map((v) => [v.id, !!v.revoked]).sort()).toEqual(
        [
          [allRevoked.versions[0]!.uid, true],
          [allRevoked.versions[1]!.uid, true],
          [mixed.versions[0]!.uid, false],
          [mixed.versions[1]!.uid, true],
        ].sort(),
      )
    }
  })
})
