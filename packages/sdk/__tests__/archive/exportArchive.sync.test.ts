import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { digestHex } from '@seedprotocol/archive'
import { Item } from '@/Item/Item'
import { importJsonSchema } from '@/imports/json'
import { BaseDb } from '@/db/Db/BaseDb'
import { Model } from '@/Model/Model'
import { metadata, seeds, versions } from '@/seedSchema'
import { exportArchive } from '@/archive/exportArchive'
import { runSyncFromEas } from '@/events/item/syncDbWithEas'
import { waitForPendingOutboxOps } from '@/outbox'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'
import { waitForIdle } from '../test-utils/waitForIdle'

/**
 * The same Version from both ends: exported by the device that published it, then with its rows
 * deleted and rebuilt by EAS sync, as a second client would hold them.
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

const easMock = vi.hoisted(() => async (importActual: <T>(path: string) => Promise<T>) => {
  const actual = await importActual<Record<string, unknown>>('@seedprotocol/eas')
  return {
    ...actual,
    getModelSchemasFromEas: async () => fakeEas.modelSchemas,
    getSeedsFromSchemaUids: async ({ schemaUids }: { schemaUids: string[] }) =>
      fakeEas.seeds.filter((s) => schemaUids.includes(s.schemaId)),
    getSeedsByUids: async ({ seedUids }: { seedUids: string[] }) => fakeEas.seeds.filter((s) => seedUids.includes(s.id)),
    getSeedsByUidsFromEas: async ({ uids }: { uids: string[] }) => fakeEas.seeds.filter((s) => uids.includes(s.id)),
    getItemVersionsFromEas: async ({ seedUids }: { seedUids: string[] }) =>
      fakeEas.versions.filter((v) => seedUids.includes(v.refUID)),
    getItemPropertiesFromEas: async ({ versionUids }: { versionUids: string[] }) =>
      fakeEas.properties.filter((p) => versionUids.includes(p.refUID)),
    getCanonicalItemPropertiesFromEas: async ({ versionUids }: { versionUids: string[] }) =>
      fakeEas.properties.filter((p) => versionUids.includes(p.refUID)),
  }
})
vi.mock('@/eas', () => easMock(vi.importActual))
vi.mock('@seedprotocol/eas', () => easMock(vi.importActual))

vi.mock('@/events/files/download', () => ({
  downloadAllFilesBinaryRequestHandler: async () => {},
  downloadTransactionIdWithDedupe: async () => false,
  scheduleBulkFilesDownloadFromEasSync: () => {},
}))

const SCHEMA_NAME = 'export-archive-sync-test'
const attester = '0x1234567890123456789012345678901234567890'
const uid = (byte: string) => '0x' + byte.repeat(32)
const ZERO = uid('00')
// UIDs differ from the other sync test files: files run in one browser worker share its DB.
const POST_SCHEMA = uid('e1')
const WRITER_SCHEMA = uid('e2')
const VERSION_SCHEMA = uid('e3')
const postUid = uid('e4')
const postVersion = uid('e5')
const writerUids = [uid('e6'), uid('e7'), uid('e8')]
const writerVersions = [uid('e9'), uid('ea'), uid('eb')]
const T0 = 1791500000

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe.skip

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

const propertySchemaUid = (def: string) =>
  '0x' + [...def].map((c) => c.charCodeAt(0).toString(16)).join('').padEnd(64, 'e').slice(0, 64)

/** A property attestation, with decodedDataJson as the EAS indexer writes it. */
const property = (id: string, version: string, name: string, type: string, value: unknown) =>
  attestation(
    id,
    version,
    propertySchemaUid(`${type} ${name}`),
    name,
    T0 + 1,
    JSON.stringify([{ name, type, signature: `${type} ${name}`, value: { name, type, value } }]),
  )

const postProperties = () => [
  property(uid('c1'), postVersion, 'title', 'string', 'A post from both ends'),
  property(uid('c2'), postVersion, 'wordCount', 'string', '1200'),
  property(uid('c3'), postVersion, 'featured', 'bool', true),
  property(uid('c4'), postVersion, 'author', 'bytes32', writerUids[0]),
  property(uid('c5'), postVersion, 'reviewer_id_synced_writer_ids', 'bytes32[]', [writerUids[1], writerUids[2]]),
]

/** The publishing device's row names for what the chain calls `author` and `reviewer_id_synced_writer_ids`. */
const CHAIN_NAMES: Record<string, string> = { authorId: 'author', reviewerIdSyncedWriterIds: 'reviewer_id_synced_writer_ids' }

/** Gives a local item the uids the fake chain has, as a publish would. */
async function markAttested(item: Item<any>, seedUid: string, versionUid: string, schemaByName: Map<string, FakeAttestation>) {
  const db = BaseDb.getAppDb()
  await db.update(seeds).set({ uid: seedUid, publisher: attester }).where(eq(seeds.localId, item.seedLocalId))
  await db.update(versions).set({ uid: versionUid, seedUid }).where(eq(versions.seedLocalId, item.seedLocalId))
  const rows = await db.select().from(metadata).where(eq(metadata.seedLocalId, item.seedLocalId))
  for (const row of rows) {
    const att = schemaByName.get(CHAIN_NAMES[row.propertyName] ?? row.propertyName)
    await db
      .update(metadata)
      .set({ uid: att?.id, schemaUid: att?.schemaId, seedUid, versionUid, attestationCreatedAt: Date.now() })
      .where(eq(metadata.localId, row.localId!))
  }
}

const bagHashes = async (item: Item<any>) => {
  const { bag } = await exportArchive(item, { fetch: false, reproducible: true })
  return {
    files: bag.files.map((f) => [f.path, digestHex('sha256', f.bytes)]),
    itemJson: new TextDecoder().decode(bag.files.find((f) => f.path === 'data/item.json')!.bytes),
  }
}

testDescribe('exportArchive from a publisher and a syncing client', () => {
  beforeAll(async () => {
    await setupTestEnvironment({
      testFileUrl: import.meta.url,
      timeout: SETUP_HOOK_TIMEOUT_MS,
      configOverrides: { addresses: [attester] },
    })
    const schema = {
      name: SCHEMA_NAME,
      models: {
        SyncedPost: {
          properties: {
            title: { type: 'Text' },
            wordCount: { type: 'Number' },
            featured: { type: 'Boolean' },
            author: { type: 'Relation', model: 'SyncedWriter' },
            reviewerIds: { type: 'List', refValueType: 'Relation', ref: 'SyncedWriter' },
          },
        },
        SyncedWriter: { properties: { name: { type: 'Text' } } },
      },
    }
    await importJsonSchema({ contents: JSON.stringify(schema) })
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline && !Model.findByModelType('synced_post')?.properties?.length) {
      await new Promise((r) => setTimeout(r, 100))
    }

    fakeEas.modelSchemas = [
      { id: POST_SCHEMA, schema: 'bytes32 synced_post' },
      { id: WRITER_SCHEMA, schema: 'bytes32 synced_writer' },
    ]
    fakeEas.seeds = [
      attestation(postUid, ZERO, POST_SCHEMA, 'synced_post', T0),
      ...writerUids.map((id) => attestation(id, ZERO, WRITER_SCHEMA, 'synced_writer', T0)),
    ]
    fakeEas.versions = [
      attestation(postVersion, postUid, VERSION_SCHEMA, 'version', T0),
      ...writerVersions.map((id, i) => attestation(id, writerUids[i]!, VERSION_SCHEMA, 'version', T0)),
    ]
    fakeEas.properties = [
      ...postProperties(),
      ...writerVersions.map((id, i) => property(uid(`d${i}`), id, 'name', 'string', `Writer ${i}`)),
    ]
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it('gives the same bag', async () => {
    const writers = await Promise.all(
      [0, 1, 2].map((i) =>
        Item.create({ schemaName: SCHEMA_NAME, modelName: 'SyncedWriter', name: `Writer ${i}` } as any),
      ),
    )
    const post = await Item.create({
      schemaName: SCHEMA_NAME,
      modelName: 'SyncedPost',
      title: 'A post from both ends',
      wordCount: 1200,
      featured: true,
      author: writers[0]!.seedLocalId,
      reviewerIds: [writers[1]!.seedLocalId, writers[2]!.seedLocalId],
    } as any)
    await waitForIdle(post, 'Item', 15000)
    await waitForPendingOutboxOps()

    const byName = new Map(postProperties().map((p) => [p.schema.schemaNames[0]!.name, p]))
    for (const [i, writer] of writers.entries()) {
      await markAttested(writer, writerUids[i]!, writerVersions[i]!, new Map())
    }
    await markAttested(post, postUid, postVersion, byName)
    const publisher = await bagHashes(post)

    const db = BaseDb.getAppDb()
    const localIds = [post, ...writers].map((i) => i.seedLocalId)
    await db.delete(metadata).where(inArray(metadata.seedLocalId, localIds))
    await db.delete(versions).where(inArray(versions.seedLocalId, localIds))
    await db.delete(seeds).where(inArray(seeds.localId, localIds))

    await runSyncFromEas({ addresses: [attester] })
    const [synced] = await db.select().from(seeds).where(eq(seeds.uid, postUid))
    expect(synced?.localId).toBeTruthy()
    const syncedPost = await Item.find({ seedLocalId: synced!.localId, modelName: 'SyncedPost' } as any)
    const syncing = await bagHashes(syncedPost!)

    const { properties } = JSON.parse(publisher.itemJson)
    expect(properties.author.value).toBe(writerUids[0])
    expect(properties.reviewerIds.value).toEqual(writerUids.slice(1))
    expect(properties.wordCount.value).toBe('1200')
    expect(syncing.itemJson).toBe(publisher.itemJson)
    expect(syncing.files).toEqual(publisher.files)
  }, 120000)
})
