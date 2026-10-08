import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { inArray } from 'drizzle-orm'
import {
  setupTestEnvironment,
  teardownTestEnvironment,
  SETUP_HOOK_TIMEOUT_MS,
} from '../../test-utils/client-init'
import { recordSqlParamCounts } from '../../test-utils/recordSqlParamCounts'

/**
 * A sync with more than 999 seeds, versions and properties must not bind more than 999 parameters
 * in one statement (SQLite's old default SQLITE_MAX_VARIABLE_NUMBER). The NodeJS project's libsql
 * allows 32766, so the sync itself wouldn't fail here: the test records every statement's
 * parameter count instead. NodeJS project only (db/** is excluded from the browser project).
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
}))

// Built from the package, without importOriginal (see runSyncFromEas.revocation.test.ts).
vi.mock('@/eas', async () => {
  const actual = await import('@seedprotocol/eas')
  return {
    ...actual,
    getModelSchemasFromEas: async () => (fakeEas.modelSchema ? [fakeEas.modelSchema] : []),
    getSeedsFromSchemaUids: async ({ schemaUids }: { schemaUids: string[] }) =>
      fakeEas.seeds.filter((s) => schemaUids.includes(s.schemaId)),
    getItemVersionsFromEas: async ({ seedUids }: { seedUids: string[] }) => {
      const wanted = new Set(seedUids)
      return fakeEas.versions.filter((v) => wanted.has(v.refUID))
    },
    getItemPropertiesFromEas: async ({ versionUids }: { versionUids: string[] }) => {
      const wanted = new Set(versionUids)
      return fakeEas.properties.filter((p) => wanted.has(p.refUID))
    },
  }
})

vi.mock('@/events/files/download', () => ({
  downloadAllFilesRequestHandler: async () => {},
  downloadAllFilesBinaryRequestHandler: async () => {},
  downloadTransactionIdWithDedupe: async () => false,
  scheduleBulkFilesDownloadFromEasSync: () => {},
}))

const SQLITE_DEFAULT_MAX_VARIABLE_NUMBER = 999
const attester = '0x1234567890123456789012345678901234567890'
const hex = (n: number) => '0x' + n.toString(16).padStart(64, '0')
const COUNT = 1100
const PROPERTY_SCHEMA_UID = hex(0x5a1e0001)

describe.sequential('EAS sync with more than 999 items', () => {
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
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    // Sync only follows EAS schemas that map to a local model; use whichever one exists.
    const { getModelSchemas } = await import('@/db/read/getModelSchemas')
    const { schemaStringToModelRecord } = await getModelSchemas()
    const schemaString = [...schemaStringToModelRecord.keys()][0]
    if (!schemaString) throw new Error('No local model schema to sync against')
    modelName = schemaString.replace(/^bytes32 /, '')
    fakeEas.modelSchema = { id: hex(0x5a1e0000), schema: schemaString }
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it(
    'never binds more than 999 parameters in one statement, and stores every item',
    async () => {
      const { runSyncFromEas } = await import('@/events/item/syncDbWithEas')
      const seedUid = (i: number) => hex(0x5a100000 + i)
      const versionUid = (i: number) => hex(0x5a200000 + i)
      fakeEas.seeds = Array.from({ length: COUNT }, (_, i) =>
        attestation(seedUid(i), hex(0), fakeEas.modelSchema!.id, 20_000 + i),
      )
      fakeEas.versions = Array.from({ length: COUNT }, (_, i) =>
        attestation(versionUid(i), seedUid(i), hex(0x5a1e0002), 30_000 + i),
      )
      fakeEas.properties = Array.from({ length: COUNT }, (_, i) =>
        titleProperty(hex(0x5a300000 + i), versionUid(i), `first ${i}`, 40_000 + i),
      )

      const firstRun = await recordSqlParamCounts(() => runSyncFromEas({ addresses: [attester] }))

      // A second sync where a newer attestation supersedes every stored property: the stored rows
      // are re-read, and all of them are deleted as stale.
      const newer = Array.from({ length: COUNT }, (_, i) =>
        titleProperty(hex(0x5a400000 + i), versionUid(i), `second ${i}`, 50_000 + i),
      )
      fakeEas.properties = [...fakeEas.properties, ...newer]
      const secondRun = await recordSqlParamCounts(() => runSyncFromEas({ addresses: [attester] }))

      const all = [...firstRun, ...secondRun]
      expect(all.length).toBeGreaterThan(0)
      expect(Math.max(...all)).toBeLessThanOrEqual(SQLITE_DEFAULT_MAX_VARIABLE_NUMBER)

      const { BaseDb } = await import('@/db/Db/BaseDb')
      const { seeds, versions, metadata } = await import('@/seedSchema')
      const { selectInBatches } = await import('@/db/sqlParamBatches')
      const db = BaseDb.getAppDb()
      const storedSeeds = await selectInBatches(fakeEas.seeds.map((s) => s.id), (chunk) =>
        db.select({ uid: seeds.uid }).from(seeds).where(inArray(seeds.uid, chunk)),
      )
      expect(storedSeeds).toHaveLength(COUNT)
      const storedVersions = await selectInBatches(fakeEas.versions.map((v) => v.id), (chunk) =>
        db.select({ uid: versions.uid }).from(versions).where(inArray(versions.uid, chunk)),
      )
      expect(storedVersions).toHaveLength(COUNT)
      const storedProperties = await selectInBatches(
        fakeEas.properties.map((p) => p.id),
        (chunk) =>
          db.select({ uid: metadata.uid }).from(metadata).where(inArray(metadata.uid, chunk)),
      )
      // Only the newer attestation of each property is kept.
      expect(new Set(storedProperties.map((r: { uid: string | null }) => r.uid))).toEqual(
        new Set(newer.map((p) => p.id)),
      )
    },
    240_000,
  )
})
