import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { inArray } from 'drizzle-orm'
import type { MetadataType, SeedType, VersionsType } from '@/seedSchema'
import {
  setupTestEnvironment,
  teardownTestEnvironment,
  SETUP_HOOK_TIMEOUT_MS,
} from '../../test-utils/client-init'

/**
 * Fake EAS: an in-memory attestation store. The sync-facing helpers filter it the way the
 * GraphQL queries do (versions by seed refUID, properties by version refUID).
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
  modelSchema: null as { id: string; schema: string } | null,
  seeds: [] as FakeAttestation[],
  versions: [] as FakeAttestation[],
  properties: [] as FakeAttestation[],
  versionRequests: [] as string[][],
}))

// `@/eas` re-exports `@seedprotocol/eas` plus `getModelSchemasFromEas`, so the mock is built from
// the package. (Mocking these modules with importOriginal made this file hang while loading.)
vi.mock('@/eas', async () => {
  const actual = await import('@seedprotocol/eas')
  return {
    ...actual,
    getModelSchemasFromEas: async () => (fakeEas.modelSchema ? [fakeEas.modelSchema] : []),
    getSeedsFromSchemaUids: async () => [...fakeEas.seeds],
    getItemVersionsFromEas: async ({ seedUids }: { seedUids: string[] }) => {
      fakeEas.versionRequests.push([...seedUids])
      return fakeEas.versions.filter((v) => seedUids.includes(v.refUID))
    },
    getItemPropertiesFromEas: async ({ versionUids }: { versionUids: string[] }) =>
      fakeEas.properties.filter((p) => versionUids.includes(p.refUID)),
  }
})

// Keep the post-sync file download from reaching the network.
vi.mock('@/events/files/download', () => ({
  downloadAllFilesRequestHandler: async () => {},
  downloadAllFilesBinaryRequestHandler: async () => {},
  downloadTransactionIdWithDedupe: async () => false,
  scheduleBulkFilesDownloadFromEasSync: () => {},
}))

const attester = '0x1234567890123456789012345678901234567890'
const uid = (byte: string) => '0x' + byte.repeat(32)
const PROPERTY_SCHEMA_UID = uid('5c')

describe.sequential('runSyncFromEas: existing seeds', () => {
  let modelName = ''

  const attestation = (
    id: string,
    refUID: string,
    schemaId: string,
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
    schema: { schemaNames: [{ name: modelName }] },
  })

  const titleProperty = (id: string, versionUid: string, value: string, timeCreated: number) =>
    attestation(
      id,
      versionUid,
      PROPERTY_SCHEMA_UID,
      timeCreated,
      JSON.stringify([{ value: { name: 'title', value, type: 'string' } }]),
    )

  beforeAll(async () => {
    await setupTestEnvironment({
      testFileUrl: import.meta.url,
      timeout: SETUP_HOOK_TIMEOUT_MS,
    })

    // Sync only follows EAS schemas that map to a local model; use whichever one exists.
    const { getModelSchemas } = await import('@/db/read/getModelSchemas')
    const { schemaStringToModelRecord } = await getModelSchemas()
    const schemaString = [...schemaStringToModelRecord.keys()][0]
    if (!schemaString) throw new Error('No local model schema to sync against')
    modelName = schemaString.replace(/^bytes32 /, '')
    fakeEas.modelSchema = { id: uid('5a'), schema: schemaString }
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it('fetches new versions and properties of an already-stored seed in a run that also inserts a new seed', async () => {
    const { runSyncFromEas } = await import('@/events/item/syncDbWithEas')
    const { BaseDb } = await import('@/db/Db/BaseDb')
    const { seeds, versions, metadata } = await import('@/seedSchema')
    const appDb = BaseDb.getAppDb()

    const seedA = uid('a1')
    const versionA1 = uid('a2')
    const propertyA1 = uid('a3')
    const versionA2 = uid('a4')
    const propertyA2 = uid('a5')
    const seedB = uid('b1')
    const versionB1 = uid('b2')
    const propertyB1 = uid('b3')
    const modelSchemaUid = fakeEas.modelSchema!.id

    // Run 1: seed A with one version and one property.
    fakeEas.seeds = [attestation(seedA, uid('00'), modelSchemaUid, 1_000)]
    fakeEas.versions = [attestation(versionA1, seedA, uid('5b'), 1_001)]
    fakeEas.properties = [titleProperty(propertyA1, versionA1, 'first', 1_002)]
    await runSyncFromEas({ addresses: [attester] })

    const afterRun1 = await appDb.select().from(versions).where(inArray(versions.uid, [versionA1]))
    expect(afterRun1).toHaveLength(1)

    // Run 2: A gains a version on EAS, and a new seed B appears.
    fakeEas.seeds = [...fakeEas.seeds, attestation(seedB, uid('00'), modelSchemaUid, 2_000)]
    fakeEas.versions = [
      ...fakeEas.versions,
      attestation(versionA2, seedA, uid('5b'), 2_001),
      attestation(versionB1, seedB, uid('5b'), 2_002),
    ]
    fakeEas.properties = [
      ...fakeEas.properties,
      titleProperty(propertyA2, versionA2, 'second', 2_003),
      titleProperty(propertyB1, versionB1, 'b', 2_004),
    ]
    fakeEas.versionRequests = []
    await runSyncFromEas({ addresses: [attester] })

    const seedRows: SeedType[] = await appDb.select().from(seeds).where(inArray(seeds.uid, [seedA, seedB]))
    expect(seedRows.map((r) => r.uid).sort()).toEqual([seedA, seedB].sort())

    const versionRows: VersionsType[] = await appDb
      .select()
      .from(versions)
      .where(inArray(versions.uid, [versionA1, versionA2, versionB1]))
    expect(versionRows.map((r) => r.uid).sort()).toEqual([versionA1, versionA2, versionB1].sort())
    const versionA2Row = versionRows.find((r) => r.uid === versionA2)
    expect(versionA2Row?.seedUid).toBe(seedA)
    expect(versionA2Row?.seedLocalId).toBe(seedRows.find((r) => r.uid === seedA)?.localId)

    // Exact lists: re-syncing seed A doesn't duplicate rows stored in run 1.
    const metadataRows: MetadataType[] = await appDb
      .select()
      .from(metadata)
      .where(inArray(metadata.uid, [propertyA1, propertyA2, propertyB1]))
    expect(metadataRows.map((r) => r.uid).sort()).toEqual([propertyA1, propertyA2, propertyB1].sort())
    const propertyA2Row = metadataRows.find((r) => r.uid === propertyA2)
    expect(propertyA2Row?.versionUid).toBe(versionA2)
    expect(propertyA2Row?.seedUid).toBe(seedA)
    expect(propertyA2Row?.propertyValue).toBe('second')

    // Versions were requested for every seed the seed query returned, not only the new one.
    expect(fakeEas.versionRequests[0]?.slice().sort()).toEqual([seedA, seedB].sort())
  })

  it("skips a version whose seed can't be resolved to a local id, with its properties", async () => {
    const { runSyncFromEas } = await import('@/events/item/syncDbWithEas')
    const { BaseDb } = await import('@/db/Db/BaseDb')
    const { seeds, versions, metadata } = await import('@/seedSchema')
    const appDb = BaseDb.getAppDb()
    const modelSchemaUid = fakeEas.modelSchema!.id

    // A stored seed row with the attestation's uid but no local id: nothing to attach versions to.
    const orphanSeed = uid('c1')
    const orphanVersion = uid('c2')
    const orphanProperty = uid('c3')
    const seed = uid('d1')
    const version = uid('d2')
    const property = uid('d3')
    await appDb.insert(seeds).values({ uid: orphanSeed, type: modelName, createdAt: Date.now() })

    fakeEas.seeds = [
      attestation(orphanSeed, uid('00'), modelSchemaUid, 3_000),
      attestation(seed, uid('00'), modelSchemaUid, 3_001),
    ]
    fakeEas.versions = [
      attestation(orphanVersion, orphanSeed, uid('5b'), 3_002),
      attestation(version, seed, uid('5b'), 3_003),
    ]
    fakeEas.properties = [
      titleProperty(orphanProperty, orphanVersion, 'orphan', 3_004),
      titleProperty(property, version, "it's fine", 3_005),
    ]
    await runSyncFromEas({ addresses: [attester] })

    const versionRows: VersionsType[] = await appDb
      .select()
      .from(versions)
      .where(inArray(versions.uid, [orphanVersion, version]))
    expect(versionRows.map((r) => r.uid)).toEqual([version])
    const seedRow = (
      await appDb.select().from(seeds).where(inArray(seeds.uid, [seed]))
    )[0] as SeedType
    expect(versionRows[0]?.seedLocalId).toBe(seedRow.localId)
    expect(
      await appDb.select().from(versions).where(inArray(versions.seedLocalId, ['undefined'])),
    ).toEqual([])

    const metadataRows: MetadataType[] = await appDb
      .select()
      .from(metadata)
      .where(inArray(metadata.uid, [orphanProperty, property]))
    expect(metadataRows.map((r) => [r.uid, r.propertyValue])).toEqual([[property, "it's fine"]])
  })
})
