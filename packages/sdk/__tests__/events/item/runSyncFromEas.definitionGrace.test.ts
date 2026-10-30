import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import {
  setupTestEnvironment,
  teardownTestEnvironment,
  SETUP_HOOK_TIMEOUT_MS,
} from '../../test-utils/client-init'

/**
 * Sync stores a seed's type from the local model its EAS name matches (Model.findByModelType, a
 * synchronous cache read). A model loaded more than the grace period before the seeds are saved
 * must still be cached then: definitions don't unload for having no holds.
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

const GRACE_MS = 100

const fakeEas = vi.hoisted(() => ({
  modelSchemas: [] as { id: string; schema: string }[],
  seeds: [] as FakeAttestation[],
  /** How long the seeds request takes, so the grace period passes during the sync. */
  seedsDelayMs: 0,
}))

// As in runSyncFromEas.nameMatch.test.ts: the mock is built from the package.
vi.mock('@/eas', async () => {
  const actual = await import('@seedprotocol/eas')
  return {
    ...actual,
    getModelSchemasFromEas: async () => fakeEas.modelSchemas,
    getSeedsFromSchemaUids: async ({ schemaUids }: { schemaUids: string[] }) => {
      await new Promise((resolve) => setTimeout(resolve, fakeEas.seedsDelayMs))
      return fakeEas.seeds.filter((s) => schemaUids.includes(s.schemaId))
    },
    getItemVersionsFromEas: async () => [],
    getItemPropertiesFromEas: async () => [],
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
const schemaUid = uid('0b')
const seedUid = uid('0c')

describe.sequential('runSyncFromEas: model types after the grace period', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    const { importJsonSchema } = await import('@/imports/json')
    // `normalized`: the older SDK name `dggracepage` matches DgGracePage, whose type is dg_grace_page
    await importJsonSchema({
      contents: JSON.stringify({
        name: 'sync-definition-grace-test',
        nameMatch: 'normalized',
        models: { DgGracePage: { properties: { body: { type: 'Text' } } } },
      }),
    })
    fakeEas.modelSchemas = [{ id: schemaUid, schema: 'bytes32 dggracepage' }]
    fakeEas.seeds = [
      {
        id: seedUid,
        schemaId: schemaUid,
        refUID: uid('00'),
        attester,
        timeCreated: 9_100,
        revoked: false,
        revocationTime: 0,
        decodedDataJson: '',
        schema: { schemaNames: [{ name: 'dggracepage' }] },
      },
    ]
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    const { setEntityUnloadGraceMs } = await import('@/helpers/entity/entityCache')
    setEntityUnloadGraceMs(undefined)
    await teardownTestEnvironment()
  })

  it("stores the local model's type when the grace period passes during the sync", async () => {
    const { setEntityUnloadGraceMs } = await import('@/helpers/entity/entityCache')
    const { evictEntities } = await import('@/helpers/entity/entityLifecycle')
    const { Model } = await import('@/Model/Model')
    const { ModelProperty } = await import('@/ModelProperty/ModelProperty')
    const { Schema } = await import('@/Schema/Schema')
    const { runSyncFromEas } = await import('@/events/item/syncDbWithEas')
    const { BaseDb } = await import('@/db/Db/BaseDb')
    const { seeds } = await import('@/seedSchema')
    const { eq } = await import('drizzle-orm')

    // Cached afresh under a grace period, as an app's models are
    setEntityUnloadGraceMs(GRACE_MS)
    for (const cache of [ModelProperty.cache, Model.cache, Schema.cache]) evictEntities(cache as any, () => true)
    await Model.all(undefined, { waitForReady: true })
    fakeEas.seedsDelayMs = GRACE_MS * 3

    await runSyncFromEas({ addresses: [attester] })

    const [row] = await BaseDb.getAppDb().select().from(seeds).where(eq(seeds.uid, seedUid))
    expect(row?.type).toBe('dg_grace_page')
  }, 30000)
})
