import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import type { MetadataType } from '@/seedSchema'
import {
  setupTestEnvironment,
  teardownTestEnvironment,
  SETUP_HOOK_TIMEOUT_MS,
} from '../../test-utils/client-init'

/**
 * Rows sync derives for ItemStorage properties from a `storage_transaction_id` attestation (uid
 * null, value = the transaction id) must follow that attestation like synced rows do.
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
/** One word, so sync's `startCase(modelType)` lookup finds it. */
const MODEL_NAME = 'Zinepage'
const STORAGE_SCHEMA_UID = uid('4c')

describe.sequential('runSyncFromEas: rows derived from storage_transaction_id', () => {
  const seed = uid('41')
  const version = uid('42')
  const olderTx = uid('43')
  const newerTx = uid('44')

  const attestation = (
    id: string,
    refUID: string,
    schemaId: string,
    timeCreated: number,
    revocationTime = 0,
    decodedDataJson = '',
  ): FakeAttestation => ({
    id,
    schemaId,
    refUID,
    attester,
    timeCreated,
    revoked: revocationTime > 0,
    revocationTime,
    decodedDataJson,
    schema: { schemaNames: [{ name: MODEL_NAME }] },
  })

  const storageTx = (id: string, txId: string, timeCreated: number, revocationTime = 0) =>
    attestation(
      id,
      version,
      STORAGE_SCHEMA_UID,
      timeCreated,
      revocationTime,
      JSON.stringify([
        { value: { name: 'storage_transaction_id', value: txId, type: 'string' } },
      ]),
    )

  beforeAll(async () => {
    await setupTestEnvironment({
      testFileUrl: import.meta.url,
      timeout: SETUP_HOOK_TIMEOUT_MS,
    })

    const { importJsonSchema } = await import('@/imports/json')
    await importJsonSchema({
      contents: JSON.stringify({
        name: 'sync-item-storage-test',
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
    fakeEas.modelSchema = { id: uid('4a'), schema: schemaString }
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  const sync = async (storageAttestations: FakeAttestation[]) => {
    const { runSyncFromEas } = await import('@/events/item/syncDbWithEas')
    fakeEas.seeds = [attestation(seed, uid('00'), fakeEas.modelSchema!.id, 8_000)]
    fakeEas.versions = [attestation(version, seed, uid('5b'), 8_001)]
    fakeEas.properties = storageAttestations
    await runSyncFromEas({ addresses: [attester] })
  }

  const rows = async (): Promise<MetadataType[]> => {
    const { BaseDb } = await import('@/db/Db/BaseDb')
    const { metadata } = await import('@/seedSchema')
    return BaseDb.getAppDb().select().from(metadata).where(eq(metadata.versionUid, version))
  }

  /** [propertyValue, revokedAt] of the derived `html` rows (uid null, ref_value_type 'file'). */
  const derivedHtml = async () =>
    (await rows())
      .filter(
        (r) =>
          r.propertyName === 'html' &&
          !r.uid &&
          r.refValueType === 'file' &&
          r.localId !== 'local-html-edit',
      )
      .map((r) => [r.propertyValue, r.revokedAt ?? null])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])))

  /** A local edit of the property, on the same version: sync must never touch it. */
  const localEdit = async () => {
    const draft = (await rows()).find((r) => r.localId === 'local-html-edit')
    return draft && [draft.propertyValue, draft.revokedAt ?? null]
  }

  it('derives a row from the canonical storage transaction', async () => {
    await sync([storageTx(uid('45'), olderTx, 8_002)])
    expect(await derivedHtml()).toEqual([[olderTx, null]])

    const { BaseDb } = await import('@/db/Db/BaseDb')
    const { metadata } = await import('@/seedSchema')
    const synced = (await rows()).find((r) => r.uid === uid('45'))!
    await BaseDb.getAppDb().insert(metadata).values({
      localId: 'local-html-edit',
      propertyName: 'html',
      propertyValue: `${seed}.html`,
      refValueType: 'file',
      seedLocalId: synced.seedLocalId,
      seedUid: seed,
      versionLocalId: synced.versionLocalId,
      versionUid: version,
      createdAt: Date.now(),
    })
  })

  it('replaces the derived row when a newer storage transaction becomes canonical', async () => {
    await sync([storageTx(uid('45'), olderTx, 8_002), storageTx(uid('46'), newerTx, 8_003)])
    expect(await derivedHtml()).toEqual([[newerTx, null]])
    expect(await localEdit()).toEqual([`${seed}.html`, null])
  })

  it('goes back to the older derived row when the newer storage transaction is revoked', async () => {
    await sync([
      storageTx(uid('45'), olderTx, 8_002),
      storageTx(uid('46'), newerTx, 8_003, 1_700_008_000),
    ])
    expect(await derivedHtml()).toEqual([[olderTx, null]])
    expect(await localEdit()).toEqual([`${seed}.html`, null])
  })

  it('marks the derived row revoked once every storage transaction is revoked', async () => {
    await sync([
      storageTx(uid('45'), olderTx, 8_002, 1_700_008_100),
      storageTx(uid('46'), newerTx, 8_003, 1_700_008_000),
    ])
    // The newest revoked attestation is kept, so its derived row is the one left, revoked with it.
    expect(await derivedHtml()).toEqual([[newerTx, 1_700_008_000]])
    expect(await localEdit()).toEqual([`${seed}.html`, null])
  })
})
