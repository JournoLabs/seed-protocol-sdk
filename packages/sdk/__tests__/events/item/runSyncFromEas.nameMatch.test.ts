import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { MetadataType } from '@/seedSchema'
import {
  setupTestEnvironment,
  teardownTestEnvironment,
  SETUP_HOOK_TIMEOUT_MS,
} from '../../test-utils/client-init'

/**
 * ADR 0009: a schema's nameMatch sets how loosely EAS names match its models and properties.
 * The schema default here is `normalized`; NmExactPage is `exact`; NmFuzzyPage is `fuzzy`, with
 * an `exact` and a `normalized` property. Each level finds what it should and nothing looser.
 */
type FakeAttestation = {
  id: string
  schemaId: string
  refUID: string
  attester: string
  timeCreated: number
  revoked: boolean
  revocationTime: number
  decodedDataJson: string
  schema: { schemaNames: { name: string }[] }
}

const fakeEas = vi.hoisted(() => ({
  modelSchemas: [] as { id: string; schema: string }[],
  seeds: [] as FakeAttestation[],
  versions: [] as FakeAttestation[],
  properties: [] as FakeAttestation[],
}))

// As in runSyncFromEas.names.test.ts: the mock is built from the package.
vi.mock('@/eas', async () => {
  const actual = await import('@seedprotocol/eas')
  return {
    ...actual,
    getModelSchemasFromEas: async () => fakeEas.modelSchemas,
    getSeedsFromSchemaUids: async ({ schemaUids }: { schemaUids: string[] }) =>
      fakeEas.seeds.filter((s) => schemaUids.includes(s.schemaId)),
    getItemVersionsFromEas: async ({ seedUids }: { seedUids: string[] }) =>
      fakeEas.versions.filter((v) => seedUids.includes(v.refUID)),
    getItemPropertiesFromEas: async ({ versionUids }: { versionUids: string[] }) =>
      fakeEas.properties.filter((p) => versionUids.includes(p.refUID)),
  }
})

vi.mock('@/events/files/download', () => ({
  downloadAllFilesBinaryRequestHandler: async () => {},
  downloadTransactionIdWithDedupe: async () => false,
  scheduleBulkFilesDownloadFromEasSync: () => {},
}))

const attester = '0x1234567890123456789012345678901234567890'
const uid = (byte: string) => '0x' + byte.repeat(32)
// UIDs differ from the other sync test files: files run in one browser worker share its DB.
const schemaUid = {
  exact: uid('5a'),
  exactNormalized: uid('5b'),
  norm: uid('5c'),
  normFuzzy: uid('5d'),
  fuzzyPlural: uid('5e'),
}
const seed = {
  exact: uid('6a'),
  exactNormalized: uid('6b'),
  norm: uid('6c'),
  normFuzzy: uid('6d'),
  fuzzy: uid('6e'),
}
const fuzzyVersion = uid('7a')
const prop = {
  titleExact: uid('8a'),
  titleNormalized: uid('8b'),
  subtitleNormalized: uid('8c'),
  subtitleFuzzy: uid('8d'),
  tagFuzzy: uid('8e'),
}

describe.sequential('runSyncFromEas: nameMatch levels (ADR 0009)', () => {
  const attestation = (
    id: string,
    refUID: string,
    schemaId: string,
    schemaName: string,
    timeCreated: number,
    decodedDataJson = '',
  ): FakeAttestation => ({
    id,
    schemaId,
    refUID,
    attester,
    timeCreated,
    revoked: false,
    revocationTime: 0,
    decodedDataJson,
    schema: { schemaNames: [{ name: schemaName }] },
  })
  const propertySchemaUid = (name: string) =>
    '0x' + [...name].map((c) => c.charCodeAt(0).toString(16)).join('').padEnd(64, 'f').slice(0, 64)
  const property = (id: string, versionUid: string, name: string, value: unknown, timeCreated: number) =>
    attestation(
      id,
      versionUid,
      propertySchemaUid(name),
      name,
      timeCreated,
      JSON.stringify([{ value: { name, value, type: 'string' } }]),
    )

  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })

    const { importJsonSchema } = await import('@/imports/json')
    await importJsonSchema({
      contents: JSON.stringify({
        name: 'sync-name-match-test',
        nameMatch: 'normalized',
        models: {
          NmExactPage: { nameMatch: 'exact', properties: { body: { type: 'Text' } } },
          NmNormPage: { properties: { body: { type: 'Text' } } },
          NmFuzzyPage: {
            nameMatch: 'fuzzy',
            properties: {
              title: { type: 'Text', nameMatch: 'exact' },
              subtitle: { type: 'Text', nameMatch: 'normalized' },
              tag: { type: 'Text' },
            },
          },
        },
      }),
    })

    const { Model } = await import('@/Model/Model')
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
      const names = Model.findByModelType('nm_fuzzy_page')?.properties?.map((p) => p.name) ?? []
      if (['title', 'subtitle', 'tag'].every((n) => names.includes(n))) break
      await new Promise((r) => setTimeout(r, 100))
    }

    fakeEas.modelSchemas = [
      { id: schemaUid.exact, schema: 'bytes32 nm_exact_page' },
      { id: schemaUid.exactNormalized, schema: 'bytes32 nm_exactpage' },
      { id: schemaUid.norm, schema: 'bytes32 nm_normpage' },
      { id: schemaUid.normFuzzy, schema: 'bytes32 nm_norm_pages' },
      { id: schemaUid.fuzzyPlural, schema: 'bytes32 nm_fuzzy_pages' },
    ]
    fakeEas.seeds = [
      attestation(seed.exact, uid('00'), schemaUid.exact, 'nm_exact_page', 9_000),
      attestation(seed.exactNormalized, uid('00'), schemaUid.exactNormalized, 'nm_exactpage', 9_001),
      attestation(seed.norm, uid('00'), schemaUid.norm, 'nm_normpage', 9_002),
      attestation(seed.normFuzzy, uid('00'), schemaUid.normFuzzy, 'nm_norm_pages', 9_003),
      attestation(seed.fuzzy, uid('00'), schemaUid.fuzzyPlural, 'nm_fuzzy_pages', 9_004),
    ]
    fakeEas.versions = [attestation(fuzzyVersion, seed.fuzzy, uid('cf'), 'version', 9_005)]
    fakeEas.properties = [
      property(prop.titleExact, fuzzyVersion, 'title', 'Exact title', 9_006),
      property(prop.titleNormalized, fuzzyVersion, 'Title', 'Normalized title', 9_007),
      property(prop.subtitleNormalized, fuzzyVersion, 'SubTitle', 'Normalized subtitle', 9_008),
      property(prop.subtitleFuzzy, fuzzyVersion, 'subtitles', 'Fuzzy subtitle', 9_009),
      property(prop.tagFuzzy, fuzzyVersion, 'tags', 'Fuzzy tag', 9_010),
    ]
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it('stores nameMatch in the schema file at every level', async () => {
    const { BaseDb } = await import('@/db/Db/BaseDb')
    const { schemas } = await import('@/seedSchema')
    const { eq } = await import('drizzle-orm')
    const rows = await BaseDb.getAppDb()
      .select({ schemaData: schemas.schemaData })
      .from(schemas)
      .where(eq(schemas.name, 'sync-name-match-test'))
    const file = JSON.parse(rows[0]!.schemaData!)
    expect(file.nameMatch).toBe('normalized')
    expect(file.models.NmExactPage.nameMatch).toBe('exact')
    expect(file.models.NmNormPage.nameMatch).toBeUndefined()
    expect(file.models.NmFuzzyPage.properties.title.nameMatch).toBe('exact')
  })

  it('syncs seeds whose model name matches at its level, and no others', async () => {
    const { runSyncFromEas } = await import('@/events/item/syncDbWithEas')
    const { BaseDb } = await import('@/db/Db/BaseDb')
    const { seeds, modelUids } = await import('@/seedSchema')
    const { inArray } = await import('drizzle-orm')
    const appDb = BaseDb.getAppDb()

    await runSyncFromEas({ addresses: [attester] })

    const seedRows = await appDb.select().from(seeds).where(inArray(seeds.uid, Object.values(seed)))
    expect(Object.fromEntries(seedRows.map((r: { uid: string; type: string }) => [r.uid, r.type]))).toEqual({
      [seed.exact]: 'nm_exact_page',
      [seed.norm]: 'nm_norm_page',
      [seed.fuzzy]: 'nm_fuzzy_page',
    })
    // model_uids holds only a model's exact schema (bytes32 <easName>, what publish writes seeds
    // under), as init records it: seeds found under older names don't make their schema the model's.
    const uidRows = await appDb.select().from(modelUids).where(inArray(modelUids.uid, Object.values(schemaUid)))
    expect(uidRows.map((r: { uid: string }) => r.uid).sort()).toEqual([schemaUid.exact])
  })

  it("stores properties whose name matches at the property's level, and drops the rest", async () => {
    const { BaseDb } = await import('@/db/Db/BaseDb')
    const { metadata } = await import('@/seedSchema')
    const { inArray } = await import('drizzle-orm')
    const rows: MetadataType[] = await BaseDb.getAppDb()
      .select()
      .from(metadata)
      .where(inArray(metadata.uid, Object.values(prop)))
    expect(Object.fromEntries(rows.map((r) => [r.uid, r.propertyName]))).toEqual({
      [prop.titleExact]: 'title',
      [prop.subtitleNormalized]: 'subtitle',
      [prop.tagFuzzy]: 'tag',
    })
  })

  it('resolves model types from EAS at each model level', async () => {
    const { Model } = await import('@/Model/Model')
    const { resolveModelRecordByNameOrType } = await import('@/db/read/resolveModelRecord')
    expect(Model.findByModelType('nm_exactpage')).toBeUndefined()
    expect(Model.findByModelType('nm_normpage')?.modelName).toBe('NmNormPage')
    expect(Model.findByModelType('nm_norm_pages')).toBeUndefined()
    expect(Model.findByModelType('nm_fuzzy_pages')?.modelName).toBe('NmFuzzyPage')
    expect(await resolveModelRecordByNameOrType('nm_exactpage')).toBeUndefined()
    expect((await resolveModelRecordByNameOrType('nm_normpage'))?.name).toBe('NmNormPage')
    expect((await resolveModelRecordByNameOrType('NmExactPage'))?.name).toBe('NmExactPage')
  })
})
