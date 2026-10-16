import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { inArray } from 'drizzle-orm'
import type { MetadataType, SeedType, VersionsType } from '@/seedSchema'
import {
  setupTestEnvironment,
  teardownTestEnvironment,
  SETUP_HOOK_TIMEOUT_MS,
} from '../test-utils/client-init'

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
/** Another account that attests on the owner's seed and versions. */
const otherAttester = '0x9999999999999999999999999999999999999999'
const uid = (byte: string) => '0x' + byte.repeat(32)
const PROPERTY_SCHEMA_UID = uid('5c')

describe.sequential('removeForeignAttestationRows', () => {
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

  const textProperty = (id: string, versionUid: string, schemaId: string, name: string, value: string, timeCreated: number) =>
    attestation(id, versionUid, schemaId, timeCreated, JSON.stringify([{ value: { name, value, type: 'string' } }]))

  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
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

  // UIDs differ from the other sync test files: files run in one browser worker share its DB.
  const seed = uid('6b')
  const version = uid('6c')
  const ownTitle = uid('6d')
  const foreignSummary = uid('6e')
  const foreignVersion = uid('6f')
  const foreignVersionTitle = uid('8d')
  const SUMMARY_SCHEMA_UID = uid('8e')

  it('deletes stored versions and properties attested by another account, with no network', async () => {
    const { runSyncFromEas } = await import('@/events/item/syncDbWithEas')
    const { removeForeignAttestationRows } = await import('@/db/removeForeignAttestationRows')
    const { BaseDb } = await import('@/db/Db/BaseDb')
    const { versions, metadata } = await import('@/seedSchema')
    const { eq } = await import('drizzle-orm')
    const appDb = BaseDb.getAppDb()

    // What an SDK without the attester check stored: synced as if every attestation were the owner's ...
    const modelSchemaUid = fakeEas.modelSchema!.id
    fakeEas.seeds = [attestation(seed, uid('00'), modelSchemaUid, 5_000)]
    fakeEas.versions = [
      attestation(version, seed, uid('5b'), 5_001),
      attestation(foreignVersion, seed, uid('5b'), 5_010),
    ]
    fakeEas.properties = [
      textProperty(ownTitle, version, PROPERTY_SCHEMA_UID, 'title', 'mine', 5_002),
      textProperty(foreignSummary, version, SUMMARY_SCHEMA_UID, 'summary', 'hijacked', 5_003),
      textProperty(foreignVersionTitle, foreignVersion, PROPERTY_SCHEMA_UID, 'title', 'hijacked version', 5_011),
    ]
    await runSyncFromEas({ addresses: [attester] })

    // ... with the real attester in the stored attestations.
    const setStoredAttester = async (table: typeof versions | typeof metadata, rowUid: string) => {
      const [row] = await appDb.select().from(table).where(eq(table.uid, rowUid))
      expect(row, rowUid).toBeTruthy()
      const raw = JSON.parse(row.attestationRaw)
      await appDb
        .update(table)
        .set({ attestationRaw: JSON.stringify({ ...raw, attester: otherAttester }) })
        .where(eq(table.uid, rowUid))
    }
    await setStoredAttester(versions, foreignVersion)
    await setStoredAttester(metadata, foreignSummary)
    await setStoredAttester(metadata, foreignVersionTitle)

    expect(await removeForeignAttestationRows()).toEqual({ versionRows: 1, propertyRows: 2 })

    const versionRows: VersionsType[] = await appDb
      .select()
      .from(versions)
      .where(inArray(versions.uid, [version, foreignVersion]))
    expect(versionRows.map((r) => r.uid)).toEqual([version])
    const metadataRows: MetadataType[] = await appDb
      .select()
      .from(metadata)
      .where(inArray(metadata.uid, [ownTitle, foreignSummary, foreignVersionTitle]))
    expect(metadataRows.map((r) => [r.uid, r.propertyValue])).toEqual([[ownTitle, 'mine']])

    expect(await removeForeignAttestationRows()).toEqual({ versionRows: 0, propertyRows: 0 })
  })
})
