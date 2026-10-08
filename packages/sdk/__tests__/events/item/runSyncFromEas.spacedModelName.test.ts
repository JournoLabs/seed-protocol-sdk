import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import type { MetadataType } from '@/seedSchema'
import {
  setupTestEnvironment,
  teardownTestEnvironment,
  SETUP_HOOK_TIMEOUT_MS,
} from '../../test-utils/client-init'

/**
 * A model whose name has spaces ("Spaced Sync Post") has EAS schema name `spaced_sync_post`. Sync
 * looked up its property ids and stored storage settings as upperFirst(camelCase(type))
 * ("SpacedSyncPost"), which matches no model, so synced rows got no property_id.
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
// Unique per file: browser test files in one worker share a DB.
const MODEL_NAME = 'Spaced Sync Post'
const MODEL_TYPE = 'spaced_sync_post'
const STORAGE_SCHEMA_UID = uid('7c')

describe.sequential('runSyncFromEas: model names with spaces', () => {
  const seed = uid('71')
  const version = uid('72')
  const txId = uid('73')

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
    // EAS schema names are the snake_case model name.
    schema: { schemaNames: [{ name: MODEL_TYPE }] },
  })

  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })

    const { importJsonSchema } = await import('@/imports/json')
    await importJsonSchema({
      contents: JSON.stringify({
        name: 'sync-spaced-model-name-test',
        models: {
          [MODEL_NAME]: {
            properties: {
              title: { type: 'Text' },
              html: {
                type: 'Text',
                storage: { type: 'ItemStorage', path: '/spaced-html', extension: '.html' },
              },
              storageTransactionId: { type: 'Text' },
            },
          },
        },
      }),
    })

    const { getModelSchemas } = await import('@/db/read/getModelSchemas')
    const deadline = Date.now() + 15_000
    let schemaString: string | undefined
    while (!schemaString && Date.now() < deadline) {
      const { schemaStringToModelRecord } = await getModelSchemas()
      schemaString = [...schemaStringToModelRecord.entries()].find(
        ([, record]) => record.name === MODEL_NAME,
      )?.[0]
      if (!schemaString) await new Promise((r) => setTimeout(r, 100))
    }
    if (!schemaString) throw new Error(`Model ${MODEL_NAME} was not imported`)
    fakeEas.modelSchema = { id: uid('7a'), schema: schemaString }
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it("links synced property rows to the model's properties", async () => {
    const { runSyncFromEas } = await import('@/events/item/syncDbWithEas')
    fakeEas.seeds = [attestation(seed, uid('00'), fakeEas.modelSchema!.id, 9_000)]
    fakeEas.versions = [attestation(version, seed, uid('7b'), 9_001)]
    fakeEas.properties = [
      attestation(
        uid('74'),
        version,
        STORAGE_SCHEMA_UID,
        9_002,
        JSON.stringify([{ value: { name: 'storage_transaction_id', value: txId, type: 'string' } }]),
      ),
    ]
    await runSyncFromEas({ addresses: [attester] })

    const { BaseDb } = await import('@/db/Db/BaseDb')
    const { metadata, properties, models } = await import('@/seedSchema')
    const db = BaseDb.getAppDb()
    const propertyIds = new Map<string, number>(
      (
        await db
          .select({ id: properties.id, name: properties.name })
          .from(properties)
          .innerJoin(models, eq(properties.modelId, models.id))
          .where(eq(models.name, MODEL_NAME))
      ).map((r: { id: number; name: string }) => [r.name, r.id]),
    )
    expect(propertyIds.get('storageTransactionId')).toBeDefined()
    expect(propertyIds.get('html')).toBeDefined()

    const rows: MetadataType[] = await db.select().from(metadata).where(eq(metadata.versionUid, version))
    expect(rows.find((r) => r.uid === uid('74'))).toMatchObject({
      propertyName: 'storageTransactionId',
      modelType: MODEL_TYPE,
      propertyId: propertyIds.get('storageTransactionId'),
    })
    // The html row derived from the storage transaction carries the stored property's id.
    expect(
      rows
        .filter((r) => r.propertyName === 'html')
        .map((r) => [r.propertyValue, r.derivedFromUid, r.refResolvedValue, r.propertyId]),
    ).toEqual([[txId, uid('74'), `${txId}.html`, propertyIds.get('html')]])
  })
})
