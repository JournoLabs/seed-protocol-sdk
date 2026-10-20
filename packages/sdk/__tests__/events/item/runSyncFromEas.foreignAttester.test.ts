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
  downloadAllFilesBinaryRequestHandler: async () => {},
  downloadTransactionIdWithDedupe: async () => false,
  scheduleBulkFilesDownloadFromEasSync: () => {},
}))

const attester = '0x1234567890123456789012345678901234567890'
/** Another account that attests on the owner's seed and versions. */
const otherAttester = '0x9999999999999999999999999999999999999999'
const uid = (byte: string) => '0x' + byte.repeat(32)
const PROPERTY_SCHEMA_UID = uid('5c')

describe.sequential("runSyncFromEas: another account's attestations", () => {
  let modelName = ''

  const attestation = (
    id: string,
    refUID: string,
    schemaId: string,
    timeCreated: number,
    decodedDataJson = '',
    by = attester,
  ): FakeAttestation => ({
    id,
    schemaId,
    refUID,
    attester: by,
    timeCreated,
    revoked: false,
    revocationTime: 0,
    decodedDataJson,
    schema: { schemaNames: [{ name: modelName }] },
  })

  const titleProperty = (
    id: string,
    versionUid: string,
    value: string,
    timeCreated: number,
    by = attester,
  ) =>
    attestation(
      id,
      versionUid,
      PROPERTY_SCHEMA_UID,
      timeCreated,
      JSON.stringify([{ value: { name: 'title', value, type: 'string' } }]),
      by,
    )

  beforeAll(async () => {
    await setupTestEnvironment({
      testFileUrl: import.meta.url,
      timeout: SETUP_HOOK_TIMEOUT_MS,
    })

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
  const seed = uid('9a')
  const version = uid('9b')
  const ownTitle = uid('9c')
  const foreignTitle = uid('9d')
  const foreignVersion = uid('9e')
  const foreignVersionTitle = uid('9f')

  const readRows = async () => {
    const { BaseDb } = await import('@/db/Db/BaseDb')
    const { versions, metadata } = await import('@/seedSchema')
    const appDb = BaseDb.getAppDb()
    const versionRows: VersionsType[] = await appDb
      .select()
      .from(versions)
      .where(inArray(versions.uid, [version, foreignVersion]))
    const metadataRows: MetadataType[] = await appDb
      .select()
      .from(metadata)
      .where(inArray(metadata.uid, [ownTitle, foreignTitle, foreignVersionTitle]))
    return {
      versionUids: versionRows.map((r) => r.uid).sort(),
      titles: metadataRows.map((r) => [r.uid, r.propertyValue]),
    }
  }

  it('stores only versions and properties from the seed\'s attester', async () => {
    const { runSyncFromEas } = await import('@/events/item/syncDbWithEas')
    const modelSchemaUid = fakeEas.modelSchema!.id

    fakeEas.seeds = [attestation(seed, uid('00'), modelSchemaUid, 4_000)]
    fakeEas.versions = [
      attestation(version, seed, uid('5b'), 4_001),
      attestation(foreignVersion, seed, uid('5b'), 4_010, '', otherAttester),
    ]
    fakeEas.properties = [
      titleProperty(ownTitle, version, 'mine', 4_002),
      titleProperty(foreignTitle, version, 'hijacked', 4_005, otherAttester),
      titleProperty(foreignVersionTitle, foreignVersion, 'hijacked version', 4_011, otherAttester),
    ]
    await runSyncFromEas({ addresses: [attester] })

    const rows = await readRows()
    expect(rows.versionUids).toEqual([version])
    expect(rows.titles).toEqual([[ownTitle, 'mine']])
  })
})
