import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import type { MetadataType, SeedType } from '@/seedSchema'
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
  /** `where` of every raw `easClient.request` (the related-seed fetch), by operation name. */
  rawRequests: [] as { operation: string; where: Record<string, any> }[],
}))

const filterFake = (where: Record<string, any>, list: FakeAttestation[]) => {
  const ids: string[] | undefined = where?.id?.in
  const refUIDs: string[] | undefined = where?.refUID?.in
  const liveOnly = JSON.stringify(where ?? {}).includes(
    '"revoked":{"equals":false}',
  )
  return list.filter(
    (a) =>
      (!ids || ids.includes(a.id)) &&
      (!refUIDs || refUIDs.includes(a.refUID)) &&
      (!liveOnly || !a.revoked),
  )
}

// The related-seed fetch queries the EAS client directly. Client init still needs `configure`.
vi.mock('@/helpers/EasClient/BaseEasClient', async () => {
  const actual = await import('@seedprotocol/eas')
  class FakeEasClient extends actual.BaseEasClient {
    static getEasClient(): any {
      return {
        request: async (
          document: any,
          variables: { where: Record<string, any> },
        ) => {
          const operation = document.definitions.find(
            (d: any) => d.kind === 'OperationDefinition',
          )?.name?.value as string
          fakeEas.rawRequests.push({ operation, where: variables.where })
          if (operation === 'GetSeeds')
            return { itemSeeds: filterFake(variables.where, fakeEas.seeds) }
          if (operation === 'GetVersions')
            return {
              itemVersions: filterFake(variables.where, fakeEas.versions),
            }
          if (operation === 'GetProperties')
            return {
              itemProperties: filterFake(variables.where, fakeEas.properties),
            }
          throw new Error(`Unexpected EAS request ${operation}`)
        },
      }
    }
  }
  return { BaseEasClient: FakeEasClient }
})

// `@/eas` re-exports `@seedprotocol/eas` plus `getModelSchemasFromEas`, so the mock is built from
// the package. (Mocking these modules with importOriginal made this file hang while loading.)
vi.mock('@/eas', async () => {
  const actual = await import('@seedprotocol/eas')
  return {
    ...actual,
    getModelSchemasFromEas: async () =>
      fakeEas.modelSchema ? [fakeEas.modelSchema] : [],
    getSeedsFromSchemaUids: async ({
      schemaUids,
      excludeRevoked = true,
    }: {
      schemaUids: string[]
      excludeRevoked?: boolean
    }) =>
      fakeEas.seeds.filter(
        (s) =>
          schemaUids.includes(s.schemaId) && (!excludeRevoked || !s.revoked),
      ),
    getItemVersionsFromEas: async ({
      seedUids,
      excludeRevoked = true,
    }: {
      seedUids: string[]
      excludeRevoked?: boolean
    }) =>
      fakeEas.versions.filter(
        (v) => seedUids.includes(v.refUID) && (!excludeRevoked || !v.revoked),
      ),
    getItemPropertiesFromEas: async ({
      versionUids,
      excludeRevoked = true,
    }: {
      versionUids: string[]
      excludeRevoked?: boolean
    }) =>
      fakeEas.properties.filter(
        (p) =>
          versionUids.includes(p.refUID) && (!excludeRevoked || !p.revoked),
      ),
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
const TITLE_SCHEMA_UID = uid('5c')
const AUTHOR_SCHEMA_UID = uid('5d')
const EDITOR_SCHEMA_UID = uid('5e')
/** Related seeds use a schema the main sync doesn't query, so only the related fetch finds them. */
const OTHER_MODEL_SCHEMA_UID = uid('6a')

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

  const property = (
    id: string,
    versionUid: string,
    schemaId: string,
    name: string,
    value: string,
    timeCreated: number,
    revocationTime = 0,
  ): FakeAttestation => ({
    ...attestation(id, versionUid, schemaId, timeCreated, revocationTime),
    decodedDataJson: JSON.stringify([
      {
        value: {
          name,
          value,
          type: name.endsWith('_id') ? 'bytes32' : 'string',
        },
      },
    ]),
  })

  const metadataRows = async (versionUid: string): Promise<MetadataType[]> => {
    const { BaseDb } = await import('@/db/Db/BaseDb')
    const { metadata } = await import('@/seedSchema')
    return BaseDb.getAppDb()
      .select()
      .from(metadata)
      .where(eq(metadata.versionUid, versionUid))
  }

  const relatedSeedRequests = () =>
    fakeEas.rawRequests
      .filter((r) => r.operation === 'GetSeeds')
      .map((r) => r.where?.id?.in as string[])

  const seedRow = async (seedUid: string): Promise<SeedType | undefined> => {
    const { BaseDb } = await import('@/db/Db/BaseDb')
    const { seeds } = await import('@/seedSchema')
    const rows: SeedType[] = await BaseDb.getAppDb()
      .select()
      .from(seeds)
      .where(eq(seeds.uid, seedUid))
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

  it('skips the related-seed request when no synced property relates to another seed', async () => {
    const { runSyncFromEas } = await import('@/events/item/syncDbWithEas')
    const modelSchemaUid = fakeEas.modelSchema!.id
    const seed = uid('d1')
    const version = uid('d2')

    fakeEas.seeds = [attestation(seed, uid('00'), modelSchemaUid, 2_000)]
    fakeEas.versions = [attestation(version, seed, uid('5b'), 2_001)]
    fakeEas.properties = [
      property(uid('d3'), version, TITLE_SCHEMA_UID, 'title', 'plain', 2_002),
    ]
    fakeEas.rawRequests = []
    await runSyncFromEas({ addresses: [attester] })

    expect(relatedSeedRequests()).toEqual([])
  })

  it('syncs relation targets like the main sync: revoked attestations are fetched and resolved canonically', async () => {
    const { runSyncFromEas } = await import('@/events/item/syncDbWithEas')
    const modelSchemaUid = fakeEas.modelSchema!.id
    const seed = uid('e1')
    const version = uid('e2')
    // Unpublished related seed: seed, version and property attestations all revoked.
    const revokedRelated = uid('e3')
    const revokedRelatedVersion = uid('e4')
    const revokedRelatedTitle = uid('e5')
    // Live related seed whose newest title attestation was revoked.
    const liveRelated = uid('f1')
    const liveRelatedVersion = uid('f2')
    const liveRelatedOldTitle = uid('f3')
    const liveRelatedNewTitle = uid('f4')

    fakeEas.seeds = [
      attestation(seed, uid('00'), modelSchemaUid, 3_000),
      attestation(
        revokedRelated,
        uid('00'),
        OTHER_MODEL_SCHEMA_UID,
        3_010,
        1_700_002_000,
      ),
      attestation(liveRelated, uid('00'), OTHER_MODEL_SCHEMA_UID, 3_020),
    ]
    fakeEas.versions = [
      attestation(version, seed, uid('5b'), 3_001),
      attestation(
        revokedRelatedVersion,
        revokedRelated,
        uid('5b'),
        3_011,
        1_700_002_000,
      ),
      attestation(liveRelatedVersion, liveRelated, uid('5b'), 3_021),
    ]
    fakeEas.properties = [
      property(
        uid('e6'),
        version,
        AUTHOR_SCHEMA_UID,
        'author_id',
        revokedRelated,
        3_002,
      ),
      property(
        uid('e7'),
        version,
        EDITOR_SCHEMA_UID,
        'editor_id',
        liveRelated,
        3_003,
      ),
      property(
        revokedRelatedTitle,
        revokedRelatedVersion,
        TITLE_SCHEMA_UID,
        'title',
        'gone',
        3_012,
        1_700_002_000,
      ),
      property(
        liveRelatedOldTitle,
        liveRelatedVersion,
        TITLE_SCHEMA_UID,
        'title',
        'live',
        3_022,
      ),
      property(
        liveRelatedNewTitle,
        liveRelatedVersion,
        TITLE_SCHEMA_UID,
        'title',
        'revoked',
        3_023,
        1_700_002_100,
      ),
    ]
    fakeEas.rawRequests = []
    await runSyncFromEas({ addresses: [attester] })

    // Related seeds are fetched by id without a revoked filter, like the main sync.
    expect(relatedSeedRequests().map((uids) => [...uids].sort())).toEqual([
      [liveRelated, revokedRelated].sort(),
    ])
    expect(
      fakeEas.rawRequests.every(
        (r) => !JSON.stringify(r.where).includes('revoked'),
      ),
    ).toBe(true)

    expect((await seedRow(revokedRelated))?.revokedAt).toBe(1_700_002_000)
    expect((await seedRow(liveRelated))?.revokedAt ?? null).toBeNull()

    // All revoked: the newest is kept, like an unpublished seed synced in its own right.
    expect(
      (await metadataRows(revokedRelatedVersion)).map((r) => [
        r.uid,
        r.propertyValue,
      ]),
    ).toEqual([[revokedRelatedTitle, 'gone']])
    // Newest revoked, older live: the live one is canonical.
    expect(
      (await metadataRows(liveRelatedVersion)).map((r) => [
        r.uid,
        r.propertyValue,
      ]),
    ).toEqual([[liveRelatedOldTitle, 'live']])
  })
})
