import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { eq, getTableColumns } from 'drizzle-orm'
import {
  setupTestEnvironment,
  teardownTestEnvironment,
  SETUP_HOOK_TIMEOUT_MS,
} from '../../test-utils/client-init'

/**
 * Sync inserts new versions in batches of bound-parameter INSERTs. Each statement must stay under
 * SQLite's host-parameter limit (999 before SQLite 3.32; sqlite-wasm and libsql allow more).
 * NodeJS project only (db/** is excluded from the browser project).
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
}))

// Built from the package, without importOriginal (see runSyncFromEas.revocation.test.ts).
vi.mock('@/eas', async () => {
  const actual = await import('@seedprotocol/eas')
  return {
    ...actual,
    getModelSchemasFromEas: async () => (fakeEas.modelSchema ? [fakeEas.modelSchema] : []),
    getSeedsFromSchemaUids: async ({ schemaUids }: { schemaUids: string[] }) =>
      fakeEas.seeds.filter((s) => schemaUids.includes(s.schemaId)),
    getItemVersionsFromEas: async ({ seedUids }: { seedUids: string[] }) =>
      fakeEas.versions.filter((v) => seedUids.includes(v.refUID)),
    getItemPropertiesFromEas: async () => [],
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

describe.sequential('saveEasVersionsToDb batching', () => {
  let modelName = ''

  const attestation = (id: string, refUID: string, schemaId: string, timeCreated: number): FakeAttestation => ({
    id,
    schemaId,
    refUID,
    attester,
    timeCreated,
    revoked: false,
    revocationTime: 0,
    decodedDataJson: '',
    schema: { schemaNames: [{ name: modelName }] },
  })

  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    // Sync only follows EAS schemas that map to a local model; use whichever one exists.
    const { getModelSchemas } = await import('@/db/read/getModelSchemas')
    const { schemaStringToModelRecord } = await getModelSchemas()
    const schemaString = [...schemaStringToModelRecord.keys()][0]
    if (!schemaString) throw new Error('No local model schema to sync against')
    modelName = schemaString.replace(/^bytes32 /, '')
    fakeEas.modelSchema = { id: hex(0xb0a7c0), schema: schemaString }
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it('keeps every batch under the default SQLite variable limit, even with every column bound', async () => {
    const { VERSION_INSERT_BATCH } = await import('@/events/item/syncDbWithEas')
    const { BaseDb } = await import('@/db/Db/BaseDb')
    const { versions } = await import('@/seedSchema')
    const fullRow = Object.fromEntries(
      Object.keys(getTableColumns(versions)).map((key) => [key, key === 'localId' ? 'x' : 1]),
    ) as typeof versions.$inferInsert
    const { params } = BaseDb.getAppDb()
      .insert(versions)
      .values(Array.from({ length: VERSION_INSERT_BATCH }, () => fullRow))
      .toSQL()
    expect(params.length).toBe(VERSION_INSERT_BATCH * Object.keys(getTableColumns(versions)).length)
    expect(params.length).toBeLessThanOrEqual(SQLITE_DEFAULT_MAX_VARIABLE_NUMBER)
  })

  it('stores all versions when a sync brings more than one batch', async () => {
    const { runSyncFromEas, VERSION_INSERT_BATCH } = await import('@/events/item/syncDbWithEas')
    const count = 120
    expect(count).toBeGreaterThan(2 * VERSION_INSERT_BATCH)
    const seed = hex(0xb0a7c1)
    fakeEas.seeds = [attestation(seed, hex(0), fakeEas.modelSchema!.id, 10_000)]
    fakeEas.versions = Array.from({ length: count }, (_, i) =>
      attestation(hex(0xb0a70000 + i), seed, hex(0xb0a7c2), 10_001 + i),
    )
    await runSyncFromEas({ addresses: [attester] })

    const { BaseDb } = await import('@/db/Db/BaseDb')
    const { versions } = await import('@/seedSchema')
    const rows = await BaseDb.getAppDb()
      .select({ uid: versions.uid })
      .from(versions)
      .where(eq(versions.seedUid, seed))
    expect(new Set(rows.map((r: { uid: string | null }) => r.uid))).toEqual(new Set(fakeEas.versions.map((v) => v.id)))
    expect(rows).toHaveLength(count)
  })
})
