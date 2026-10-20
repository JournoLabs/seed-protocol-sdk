import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { MetadataType } from '@/seedSchema'
import {
  setupTestEnvironment,
  teardownTestEnvironment,
  SETUP_HOOK_TIMEOUT_MS,
} from '../../test-utils/client-init'

/**
 * ADR 0008: sync matches EAS names to local models and properties instead of reversing them.
 * Seeds published under an older SDK's model name (`names_htmlpage`) are found and typed as the
 * local model (`names_html_page`); property names that don't survive camelCase (`published_at`,
 * `coverURL`) come back as themselves; a single relation published under its key (`author`) is a
 * relation, and so is one an older SDK published as `author_id`.
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

// `@/eas` re-exports `@seedprotocol/eas` plus `getModelSchemasFromEas`, so the mock is built from
// the package. (Mocking these modules with importOriginal made this file hang while loading.)
vi.mock('@/eas', async () => {
  const actual = await import('@seedprotocol/eas')
  return {
    ...actual,
    getModelSchemasFromEas: async () => fakeEas.modelSchemas,
    getSeedsFromSchemaUids: async ({ schemaUids }: { schemaUids: string[] }) =>
      fakeEas.seeds.filter((s) => schemaUids.includes(s.schemaId)),
    getItemVersionsFromEas: async ({ seedUids }: { seedUids: string[] }) =>
      fakeEas.versions.filter((v) => seedUids.includes(v.refUID)),
    getItemPropertiesFromEas: async ({
      versionUids,
    }: {
      versionUids: string[]
    }) => fakeEas.properties.filter((p) => versionUids.includes(p.refUID)),
  }
})

// Keep the post-sync file download from reaching the network.
vi.mock('@/events/files/download', () => ({
  downloadAllFilesBinaryRequestHandler: async () => {},
  downloadTransactionIdWithDedupe: async () => false,
  scheduleBulkFilesDownloadFromEasSync: () => {},
}))

const attester = '0x1234567890123456789012345678901234567890'
const uid = (byte: string) => '0x' + byte.repeat(32)
// UIDs differ from the other sync test files: files run in one browser worker share its DB.
const PAGE_SCHEMA = uid('1d')
const WRITER_SCHEMA = uid('1e')
const page = uid('1f')
const writer = uid('2a')
const pageVersion = uid('2b')
const writerVersion = uid('2c')
const publishedAt = uid('2d')
const coverUrl = uid('2e')
const author = uid('2f')
const writerName = uid('4b')
const oldPage = uid('4d')
const oldPageVersion = uid('4e')
const oldAuthor = uid('4f')

describe.sequential('runSyncFromEas: names (ADR 0008)', () => {
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
  // One property schema per name, as on EAS (the canonical pick keeps one attestation per schema).
  const propertySchemaUid = (name: string) =>
    '0x' + [...name].map((c) => c.charCodeAt(0).toString(16)).join('').padEnd(64, 'e').slice(0, 64)
  const property = (id: string, versionUid: string, name: string, value: unknown, type: string, timeCreated: number) =>
    attestation(id, versionUid, propertySchemaUid(name), name, timeCreated, JSON.stringify([{ value: { name, value, type } }]))

  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })

    const { importJsonSchema } = await import('@/imports/json')
    await importJsonSchema({
      contents: JSON.stringify({
        name: 'sync-names-test',
        models: {
          NamesHTMLPage: {
            properties: {
              published_at: { type: 'Text' },
              coverURL: { type: 'Text' },
              author: { type: 'Relation', ref: 'NamesWriter' },
            },
          },
          NamesWriter: { properties: { name: { type: 'Text' } } },
        },
      }),
    })

    const { Model } = await import('@/Model/Model')
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
      const names = Model.findByModelType('names_html_page')?.properties?.map((p) => p.name) ?? []
      if (['published_at', 'coverURL', 'author'].every((n) => names.includes(n))) break
      await new Promise((r) => setTimeout(r, 100))
    }

    // As an older SDK published them: the model as names_htmlpage.
    fakeEas.modelSchemas = [
      { id: PAGE_SCHEMA, schema: 'bytes32 names_htmlpage' },
      { id: WRITER_SCHEMA, schema: 'bytes32 names_writer' },
    ]
    fakeEas.seeds = [
      attestation(page, uid('00'), PAGE_SCHEMA, 'names_htmlpage', 6_000),
      attestation(oldPage, uid('00'), PAGE_SCHEMA, 'names_htmlpage', 6_001),
      attestation(writer, uid('00'), WRITER_SCHEMA, 'names_writer', 6_002),
    ]
    fakeEas.versions = [
      attestation(pageVersion, page, uid('cf'), 'version', 6_003),
      attestation(oldPageVersion, oldPage, uid('cf'), 'version', 6_004),
      attestation(writerVersion, writer, uid('cf'), 'version', 6_005),
    ]
    fakeEas.properties = [
      property(publishedAt, pageVersion, 'published_at', '2026-10-15', 'string', 6_006),
      property(coverUrl, pageVersion, 'cover_url', 'https://example.com/c.png', 'string', 6_007),
      property(author, pageVersion, 'author', writer, 'bytes32', 6_008),
      property(oldAuthor, oldPageVersion, 'author_id', writer, 'bytes32', 6_009),
      property(writerName, writerVersion, 'name', 'Ada', 'string', 6_010),
    ]
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it('finds old-name seeds and stores names and relations as the local model has them', async () => {
    const { runSyncFromEas } = await import('@/events/item/syncDbWithEas')
    const { BaseDb } = await import('@/db/Db/BaseDb')
    const { seeds, metadata } = await import('@/seedSchema')
    const { inArray } = await import('drizzle-orm')
    const appDb = BaseDb.getAppDb()

    await runSyncFromEas({ addresses: [attester] })

    const seedRows = await appDb.select().from(seeds).where(inArray(seeds.uid, [page, oldPage, writer]))
    expect(Object.fromEntries(seedRows.map((r: { uid: string; type: string }) => [r.uid, r.type]))).toEqual({
      [page]: 'names_html_page',
      [oldPage]: 'names_html_page',
      [writer]: 'names_writer',
    })

    const rows: MetadataType[] = await appDb
      .select()
      .from(metadata)
      .where(inArray(metadata.uid, [publishedAt, coverUrl, author, oldAuthor]))
    const byUid = new Map(rows.map((r) => [r.uid, r]))
    expect(byUid.get(publishedAt)?.propertyName).toBe('published_at')
    expect(byUid.get(coverUrl)?.propertyName).toBe('coverURL')
    expect(byUid.get(author)?.propertyName).toBe('authorId')
    expect(byUid.get(author)?.refSeedType).toBe('names_writer')
    expect(byUid.get(oldAuthor)?.propertyName).toBe('authorId')
    expect(byUid.get(oldAuthor)?.refSeedType).toBe('names_writer')
    expect(byUid.get(author)?.modelType).toBe('names_html_page')
  })
})
