import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
import type { MetadataType } from '@/seedSchema'
import {
  setupTestEnvironment,
  teardownTestEnvironment,
  SETUP_HOOK_TIMEOUT_MS,
} from '../../test-utils/client-init'

/**
 * Sync resolves a seed's model from its EAS schema name, the snake_case model name
 * (`sync_storage_post` for model `SyncStoragePost`). It used to look models up by
 * `startCase(modelType)` ("Sync Storage Post"), which never matches a multi-word model.
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
    getModelSchemasFromEas: async () =>
      fakeEas.modelSchema ? [fakeEas.modelSchema] : [],
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
  downloadAllFilesRequestHandler: async () => {},
  downloadAllFilesBinaryRequestHandler: async () => {},
  downloadTransactionIdWithDedupe: async () => false,
  scheduleBulkFilesDownloadFromEasSync: () => {},
}))

const attester = '0x1234567890123456789012345678901234567890'
const uid = (byte: string) => '0x' + byte.repeat(32)
const MODEL_NAME = 'SyncStoragePost'
const MODEL_TYPE = 'sync_storage_post'
const STORAGE_SCHEMA_UID = uid('5c')

describe.sequential('runSyncFromEas: multi-word model names', () => {
  const seed = uid('51')
  const version = uid('52')
  const txId = uid('53')

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
    await setupTestEnvironment({
      testFileUrl: import.meta.url,
      timeout: SETUP_HOOK_TIMEOUT_MS,
    })

    const { importJsonSchema } = await import('@/imports/json')
    await importJsonSchema({
      contents: JSON.stringify({
        name: 'sync-multi-word-model-test',
        models: {
          [MODEL_NAME]: {
            properties: {
              title: { type: 'Text' },
              html: {
                type: 'Text',
                storage: { type: 'ItemStorage', path: '/html', extension: '.html' },
              },
              storageTransactionId: { type: 'Text' },
            },
          },
        },
      }),
    })

    const { getModelSchemas } = await import('@/db/read/getModelSchemas')
    const { Model } = await import('@/Model/Model')
    const deadline = Date.now() + 15_000
    let schemaString: string | undefined
    let storageLoaded = false
    while ((!schemaString || !storageLoaded) && Date.now() < deadline) {
      const { schemaStringToModelRecord } = await getModelSchemas()
      schemaString = [...schemaStringToModelRecord.entries()].find(
        ([, record]) => record.name === MODEL_NAME,
      )?.[0]
      // The model's property instances carry the storage settings once loaded.
      const html = Model.findByModelType(MODEL_TYPE)?.properties?.find(
        (p) => p.name === 'html',
      )
      storageLoaded = html?._getSnapshotContext().storageType === 'ItemStorage'
      if (!schemaString || !storageLoaded) await new Promise((r) => setTimeout(r, 100))
    }
    if (!schemaString) throw new Error(`Model ${MODEL_NAME} was not imported`)
    if (!storageLoaded) throw new Error(`Model ${MODEL_NAME} properties did not load`)
    fakeEas.modelSchema = { id: uid('5a'), schema: schemaString }

    // A `properties` row without storage settings (as before they were stored there): sync falls
    // back to the model's property instances, which it can only reach by resolving the model.
    const { BaseDb } = await import('@/db/Db/BaseDb')
    const { properties, models } = await import('@/seedSchema')
    const [modelRow] = await BaseDb.getAppDb()
      .select({ id: models.id })
      .from(models)
      .where(eq(models.name, MODEL_NAME))
    await BaseDb.getAppDb()
      .update(properties)
      .set({ storageType: null, localStorageDir: null, filenameSuffix: null })
      .where(and(eq(properties.modelId, modelRow.id), eq(properties.name, 'html')))
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it('finds the model for a snake_case EAS schema name', async () => {
    const { runSyncFromEas } = await import('@/events/item/syncDbWithEas')
    fakeEas.seeds = [attestation(seed, uid('00'), fakeEas.modelSchema!.id, 9_000)]
    fakeEas.versions = [attestation(version, seed, uid('5b'), 9_001)]
    fakeEas.properties = [
      attestation(
        uid('54'),
        version,
        STORAGE_SCHEMA_UID,
        9_002,
        JSON.stringify([
          { value: { name: 'storage_transaction_id', value: txId, type: 'string' } },
        ]),
      ),
    ]
    await runSyncFromEas({ addresses: [attester] })

    const { BaseDb } = await import('@/db/Db/BaseDb')
    const { metadata } = await import('@/seedSchema')
    const rows: MetadataType[] = await BaseDb.getAppDb()
      .select()
      .from(metadata)
      .where(eq(metadata.versionUid, version))
    expect(rows.find((r) => r.uid === uid('54'))).toMatchObject({
      propertyName: 'storageTransactionId',
      modelType: MODEL_TYPE,
    })
    // The html row derived from the storage transaction, with the model's storage settings.
    expect(
      rows
        .filter((r) => r.propertyName === 'html')
        .map((r) => [r.propertyValue, r.derivedFromUid, r.refResolvedValue]),
    ).toEqual([[txId, uid('54'), `${txId}.html`]])
  })

  it('skips the seed and emits MODEL_AMBIGUOUS_EVENT once two schemas define the model', async () => {
    const { importJsonSchema } = await import('@/imports/json')
    const { Model } = await import('@/Model/Model')
    const { AmbiguousModelError } = await import('@/Model/errors')
    const { MODEL_AMBIGUOUS_EVENT } = await import('@/db/read/resolveModelForSyncedSeed')
    const { eventEmitter } = await import('@/eventBus')
    await importJsonSchema({
      contents: JSON.stringify({
        name: 'sync-multi-word-model-test-2',
        models: { [MODEL_NAME]: { properties: { title: { type: 'Text' } } } },
      }),
    })
    await vi.waitFor(
      () => expect(() => Model.findByModelType(MODEL_TYPE)).toThrow(AmbiguousModelError),
      { timeout: 15_000 },
    )

    const events: { seedUid?: string; context: string }[] = []
    const onAmbiguous = (payload: { seedUid?: string; context: string }) => events.push(payload)
    eventEmitter.on(MODEL_AMBIGUOUS_EVENT, onAmbiguous)
    try {
      const { runSyncFromEas } = await import('@/events/item/syncDbWithEas')
      const seed2 = uid('61')
      const version2 = uid('62')
      fakeEas.seeds = [attestation(seed2, uid('00'), fakeEas.modelSchema!.id, 9_100)]
      fakeEas.versions = [attestation(version2, seed2, uid('5b'), 9_101)]
      fakeEas.properties = [
        attestation(
          uid('64'),
          version2,
          STORAGE_SCHEMA_UID,
          9_102,
          JSON.stringify([
            { value: { name: 'storage_transaction_id', value: uid('63'), type: 'string' } },
          ]),
        ),
      ]
      await runSyncFromEas({ addresses: [attester] })
      expect(events).toContainEqual(
        expect.objectContaining({ seedUid: seed2, context: 'easSync.metadata' }),
      )
    } finally {
      eventEmitter.off(MODEL_AMBIGUOUS_EVENT, onAmbiguous)
    }
  })
})
