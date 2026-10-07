import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import type { SeedType } from '@/seedSchema'
import {
  setupTestEnvironment,
  teardownTestEnvironment,
  SETUP_HOOK_TIMEOUT_MS,
} from '../../test-utils/client-init'

/**
 * Fake EAS: an in-memory attestation store. The sync-facing helpers filter it the way the
 * GraphQL queries do (seeds by schema or id, versions by seed refUID, properties by version refUID).
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

// `@/eas` re-exports `@seedprotocol/eas` plus `getModelSchemasFromEas`, so the mock is built from
// the package. (Mocking these modules with importOriginal made this file hang while loading.)
vi.mock('@/eas', async () => {
  const actual = await import('@seedprotocol/eas')
  return {
    ...actual,
    getModelSchemasFromEas: async () => (fakeEas.modelSchema ? [fakeEas.modelSchema] : []),
    getSeedsFromSchemaUids: async () => [...fakeEas.seeds],
    getItemVersionsFromEas: async ({ seedUids }: { seedUids: string[] }) =>
      fakeEas.versions.filter((v) => seedUids.includes(v.refUID)),
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

describe.sequential('runSyncFromEas: revocations', () => {
  let modelName = ''

  const attestation = (
    id: string,
    refUID: string,
    schemaId: string,
    timeCreated: number,
    revocationTime = 0,
  ): FakeAttestation => ({
    id,
    schemaId,
    refUID,
    attester,
    timeCreated,
    revoked: revocationTime > 0,
    revocationTime,
    decodedDataJson: '',
    schema: { schemaNames: [{ name: modelName }] },
  })

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

  const seedRow = async (seedUid: string): Promise<SeedType | undefined> => {
    const { BaseDb } = await import('@/db/Db/BaseDb')
    const { seeds } = await import('@/seedSchema')
    const rows: SeedType[] = await BaseDb.getAppDb().select().from(seeds).where(eq(seeds.uid, seedUid))
    return rows[0]
  }

  it("records a seed's EAS revocationTime (seconds) as revokedAt, for new and already-stored seeds", async () => {
    const { runSyncFromEas } = await import('@/events/item/syncDbWithEas')
    const modelSchemaUid = fakeEas.modelSchema!.id
    const newRevoked = uid('c1')
    const storedLive = uid('c2')

    // Run 1: one seed arrives already revoked, another arrives live.
    fakeEas.seeds = [
      attestation(newRevoked, uid('00'), modelSchemaUid, 1_000, 1_700_000_000),
      attestation(storedLive, uid('00'), modelSchemaUid, 1_001),
    ]
    fakeEas.versions = []
    fakeEas.properties = []
    await runSyncFromEas({ addresses: [attester] })

    expect((await seedRow(newRevoked))?.revokedAt).toBe(1_700_000_000)
    expect((await seedRow(storedLive))?.revokedAt ?? null).toBeNull()

    // Run 2: the stored seed was revoked on EAS since.
    fakeEas.seeds = [
      fakeEas.seeds[0]!,
      attestation(storedLive, uid('00'), modelSchemaUid, 1_001, 1_700_000_500),
    ]
    await runSyncFromEas({ addresses: [attester] })

    expect((await seedRow(storedLive))?.revokedAt).toBe(1_700_000_500)
  })
})
