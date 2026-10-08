import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
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
/** One word, so sync's `startCase(modelType)` lookup finds it. */
const MODEL_NAME = 'Zinepage'
const STORAGE_SCHEMA_UID = uid('4c')

// Runs in both projects: sync reads storage settings from the `properties` table, so it doesn't
// depend on whether the model's property instances have loaded (it used to, and was skipped).
describe.sequential(
  'runSyncFromEas: rows derived from storage_transaction_id',
  () => {
    const seed = uid('41')
    const version = uid('42')
    const olderTx = uid('43')
    const newerTx = uid('44')
    const latestTx = uid('48')

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

    const storageTx = (
      id: string,
      txId: string,
      timeCreated: number,
      revocationTime = 0,
    ) =>
      attestation(
        id,
        version,
        STORAGE_SCHEMA_UID,
        timeCreated,
        revocationTime,
        JSON.stringify([
          {
            value: {
              name: 'storage_transaction_id',
              value: txId,
              type: 'string',
            },
          },
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
                  storage: {
                    type: 'ItemStorage',
                    path: '/html',
                    extension: '.html',
                  },
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

      // The import stored the storage settings with the property row; sync reads them from there.
      const { BaseDb } = await import('@/db/Db/BaseDb')
      const { properties, models } = await import('@/seedSchema')
      const [htmlRow] = await BaseDb.getAppDb()
        .select({
          storageType: properties.storageType,
          localStorageDir: properties.localStorageDir,
          filenameSuffix: properties.filenameSuffix,
        })
        .from(properties)
        .innerJoin(models, eq(models.id, properties.modelId))
        .where(and(eq(models.name, MODEL_NAME), eq(properties.name, 'html')))
      expect(htmlRow).toEqual({
        storageType: 'ItemStorage',
        localStorageDir: '/html',
        filenameSuffix: '.html',
      })
    }, SETUP_HOOK_TIMEOUT_MS)

    afterAll(async () => {
      await teardownTestEnvironment()
    })

    const sync = async (storageAttestations: FakeAttestation[]) => {
      const { runSyncFromEas } = await import('@/events/item/syncDbWithEas')
      fakeEas.seeds = [
        attestation(seed, uid('00'), fakeEas.modelSchema!.id, 8_000),
      ]
      fakeEas.versions = [attestation(version, seed, uid('5b'), 8_001)]
      fakeEas.properties = storageAttestations
      await runSyncFromEas({ addresses: [attester] })
    }

    const rows = async (): Promise<MetadataType[]> => {
      const { BaseDb } = await import('@/db/Db/BaseDb')
      const { metadata } = await import('@/seedSchema')
      return BaseDb.getAppDb()
        .select()
        .from(metadata)
        .where(eq(metadata.versionUid, version))
    }

    /** [propertyValue, revokedAt] of the derived `html` rows (marked with `derivedFromUid`). */
    const derivedHtml = async () =>
      (await rows())
        .filter((r) => r.propertyName === 'html' && r.derivedFromUid != null)
        .map((r) => [r.propertyValue, r.revokedAt ?? null])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0])))

    /** The local edit (draft) of the property, on the same version: sync must never touch it. */
    const localEdit = async () => {
      const drafts = (await rows()).filter(
        (r) => r.propertyName === 'html' && !r.uid && r.derivedFromUid == null,
      )
      expect(drafts.length).toBeLessThanOrEqual(1)
      return drafts[0] && [drafts[0].propertyValue, drafts[0].revokedAt ?? null]
    }

    /** The html value readers would show, per the pending diff (which orders rows like they do). */
    const pendingHtml = async () => {
      const { getPublishPendingDiff } =
        await import('@/db/read/getPublishPendingDiff')
      const { pendingProperties } = await getPublishPendingDiff({
        seedUid: seed,
      })
      return pendingProperties.find((p) => p.propertyName === 'html')
    }

    /** Run the ItemStorage save actor, as an ItemProperty loaded from `row` would. */
    const saveHtml = async (row: MetadataType, newValue: string) => {
      const { saveItemStorage } =
        await import('@/ItemProperty/service/actors/saveValueToDb/saveItemStorage')
      const { createActor, createMachine } = await import('xstate')
      const events: { type: string; [key: string]: unknown }[] = []
      const parent = createMachine({
        invoke: {
          src: saveItemStorage,
          input: {
            context: {
              localId: row.localId,
              seedLocalId: row.seedLocalId,
              seedUid: seed,
              propertyName: 'html',
              modelName: MODEL_NAME,
              propertyRecordSchema: {
                dataType: 'Text',
                storageType: 'ItemStorage',
                localStorageDir: '/html',
                filenameSuffix: '.html',
              },
            },
            event: { type: 'save', newValue },
          } as any,
        },
        on: { '*': { actions: ({ event }) => void events.push(event as any) } },
      })
      const actor = createActor(parent).start()
      await vi.waitFor(
        () => {
          if (!events.some((e) => e.type.startsWith('saveItemStorage')))
            throw new Error('save not done')
        },
        { timeout: 10_000 },
      )
      actor.stop()
      return events
    }

    it('derives a row from the canonical storage transaction, marked with its source', async () => {
      await sync([storageTx(uid('45'), olderTx, 8_002)])
      expect(await derivedHtml()).toEqual([[olderTx, null]])
      const derived = (await rows()).find((r) => r.derivedFromUid != null)!
      expect(derived).toMatchObject({
        derivedFromUid: uid('45'),
        uid: null,
        refValueType: 'file',
      })
    })

    it("doesn't report the derived row as a pending local edit", async () => {
      expect(await pendingHtml()).toBeUndefined()
    })

    it('saves an edit into a new local draft, not into the derived row or its file', async () => {
      const derived = (await rows()).find((r) => r.derivedFromUid != null)!
      const events = await saveHtml(derived, '<p>local edit</p>')
      expect(events.map((e) => e.type)).toContain('saveItemStorageSuccess')

      expect(await localEdit()).toEqual([`${seed}.html`, null])
      const draft = (await rows()).find(
        (r) => r.propertyName === 'html' && !r.uid && r.derivedFromUid == null,
      )!
      // The property now points at the draft row.
      expect(events).toContainEqual(
        expect.objectContaining({
          type: 'updateContext',
          localId: draft.localId,
        }),
      )

      // The derived row is as sync left it.
      const derivedAfter = (await rows()).find(
        (r) => r.localId === derived.localId,
      )!
      expect(derivedAfter).toEqual(derived)

      const { BaseFileManager } =
        await import('@/helpers/FileManager/BaseFileManager')
      expect(
        await BaseFileManager.readFileAsString(
          BaseFileManager.getFilesPath('html', `${seed}.html`),
        ),
      ).toBe('<p>local edit</p>')
      expect(
        await BaseFileManager.pathExists(
          BaseFileManager.getFilesPath('html', `${olderTx}.html`),
        ),
      ).toBe(false)

      // Readers show the draft, made after the published storage transaction.
      expect(await pendingHtml()).toMatchObject({
        currentValue: `${seed}.html`,
      })
    })

    it('replaces the derived row when a newer storage transaction becomes canonical', async () => {
      await sync([
        storageTx(uid('45'), olderTx, 8_002),
        storageTx(uid('46'), newerTx, 8_003),
      ])
      expect(await derivedHtml()).toEqual([[newerTx, null]])
      expect(await localEdit()).toEqual([`${seed}.html`, null])
      // Still the value readers show: the edit is newer than either storage transaction.
      expect(await pendingHtml()).toMatchObject({
        currentValue: `${seed}.html`,
      })
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

    it('keeps an unpublish stamp on the source and its derived row until EAS reports a revocation time', async () => {
      const latest = (revocationTime = 0) => [
        storageTx(uid('45'), olderTx, 8_002, 1_700_008_100),
        storageTx(uid('46'), newerTx, 8_003, 1_700_008_000),
        storageTx(uid('47'), latestTx, 8_004, revocationTime),
      ]
      await sync(latest())
      expect(await derivedHtml()).toEqual([[latestTx, null]])

      // Local unpublish stamps the attestations it revoked once the revoke is mined.
      const { updateSeedRevokedAt } =
        await import('@/db/write/updateSeedRevokedAt')
      const source = (await rows()).find((r) => r.uid === uid('47'))!
      await updateSeedRevokedAt({
        seedLocalId: source.seedLocalId!,
        revokedAt: 1_700_009_000,
        metadataUids: [uid('47')],
      })

      // EAS's index still reports it live: the stamp stays, and the derived row takes it.
      await sync(latest())
      const sourceRevokedAt = async () =>
        (await rows()).find((r) => r.uid === uid('47'))?.revokedAt ?? null
      expect(await sourceRevokedAt()).toBe(1_700_009_000)
      expect(await derivedHtml()).toEqual([[latestTx, 1_700_009_000]])

      // EAS's revocation time replaces it, on both.
      await sync(latest(1_700_009_005))
      expect(await sourceRevokedAt()).toBe(1_700_009_005)
      expect(await derivedHtml()).toEqual([[latestTx, 1_700_009_005]])
      expect(await localEdit()).toEqual([`${seed}.html`, null])
    })

    it('points the derived row at a newer attestation of the same transaction id', async () => {
      await sync([
        storageTx(uid('45'), olderTx, 8_002, 1_700_008_100),
        storageTx(uid('46'), newerTx, 8_003, 1_700_008_000),
        storageTx(uid('47'), latestTx, 8_004, 1_700_009_005),
        storageTx(uid('49'), latestTx, 8_005),
      ])
      // One row for the transaction, now following the live attestation (and not its old stamp).
      expect(await derivedHtml()).toEqual([[latestTx, null]])
      const derived = (await rows()).find((r) => r.derivedFromUid != null)!
      expect(derived).toMatchObject({
        derivedFromUid: uid('49'),
        attestationCreatedAt: 8_005_000,
      })
      expect(await localEdit()).toEqual([`${seed}.html`, null])
    })
  },
)
