/**
 * The local query source labels a seed with its EAS schema name ("post"), as the remote source
 * does, not with the name of the SDK schema its model belongs to ("App"). It used to look that up
 * per seed (by model_file_id, else by startCase(type)) and let it override attestation_raw.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { BaseDb } from '@/db/Db/BaseDb'
import { seeds, versions } from '@/seedSchema'
import { importJsonSchema } from '@/imports/json'
import { generateId } from '@/helpers'
import { createLocalQueryDataSource } from '@/query/createLocalQueryDataSource'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'

// Browser test files share one database, and other files insert seeds with uids like 0xa1a1…:
// a per-run prefix keeps these apart.
const RUN = Math.random().toString(16).slice(2, 10).padEnd(8, '0')
const uid = (byte: string) => '0x' + RUN + byte.repeat(28)
const SEED_WITH_MODEL_FILE_ID = uid('a1')
const SEED_WITHOUT_MODEL_FILE_ID = uid('b1')
const SEED_WITHOUT_RAW = uid('c1')
const SEED_SCHEMA_UID = uid('5e')
const ATTESTER = '0x1234567890123456789012345678901234567890'

const postModelId = generateId()

const schemaName = (att: { schema?: { schemaNames?: { name: string }[] } } | null | undefined) =>
  att?.schema?.schemaNames?.[0]?.name

describe.sequential('local query source schema name', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    await importJsonSchema({
      contents: JSON.stringify({
        $schema: 'https://seedprotocol.io/schemas/data-model/v1',
        version: 1,
        id: generateId(),
        metadata: { name: 'App', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        models: { Post: { id: postModelId, properties: { title: { id: generateId(), type: 'Text' } } } },
        enums: {},
        migrations: [],
      }),
    })
    const db = BaseDb.getAppDb()
    const raw = (id: string) =>
      JSON.stringify({
        id,
        refUID: uid('00'),
        schemaId: SEED_SCHEMA_UID,
        timeCreated: 1_700_000_000,
        decodedDataJson: '',
        attester: ATTESTER,
        schema: { schemaNames: [{ name: 'post' }] },
      })
    const rows = [
      { seedUid: SEED_WITH_MODEL_FILE_ID, modelFileId: postModelId, attestationRaw: raw(SEED_WITH_MODEL_FILE_ID) },
      { seedUid: SEED_WITHOUT_MODEL_FILE_ID, modelFileId: null, attestationRaw: raw(SEED_WITHOUT_MODEL_FILE_ID) },
      { seedUid: SEED_WITHOUT_RAW, modelFileId: postModelId, attestationRaw: null },
    ]
    for (const [i, { seedUid, modelFileId, attestationRaw }] of rows.entries()) {
      const seedLocalId = `lqsn-seed-${RUN}-${i}`
      await db.insert(seeds).values({
        localId: seedLocalId,
        uid: seedUid,
        schemaUid: SEED_SCHEMA_UID,
        type: 'post',
        modelFileId,
        publisher: ATTESTER,
        attestationRaw,
        attestationCreatedAt: 1_700_000_000_000 + i,
        createdAt: 1_700_000_000_000 + i,
      })
      await db.insert(versions).values({
        localId: `lqsn-version-${RUN}-${i}`,
        uid: uid(`d${i}`),
        seedLocalId,
        seedUid,
        seedType: 'post',
        publisher: ATTESTER,
        attestationCreatedAt: 1_700_000_001_000 + i,
        createdAt: 1_700_000_001_000 + i,
      })
    }
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it('getSeedByUid returns the EAS schema name', async () => {
    const ds = createLocalQueryDataSource()
    expect(schemaName(await ds.getSeedByUid(SEED_WITH_MODEL_FILE_ID))).toBe('post')
    expect(schemaName(await ds.getSeedByUid(SEED_WITHOUT_MODEL_FILE_ID))).toBe('post')
    // No attestation_raw: falls back to seeds.type.
    expect(schemaName(await ds.getSeedByUid(SEED_WITHOUT_RAW))).toBe('post')
  })

  it('getSeedsByUids returns the EAS schema name', async () => {
    const ds = createLocalQueryDataSource()
    const atts = await ds.getSeedsByUids([SEED_WITH_MODEL_FILE_ID, SEED_WITHOUT_MODEL_FILE_ID, SEED_WITHOUT_RAW])
    expect(atts).toHaveLength(3)
    expect(atts.map(schemaName)).toEqual(['post', 'post', 'post'])
  })

  it('listSeedsBySchemaName labels seeds with the requested name', async () => {
    const ds = createLocalQueryDataSource()
    const listed = await ds.listSeedsBySchemaName('post', { limit: 10, skip: 0 })
    expect(listed).toHaveLength(3)
    expect(listed.map(schemaName)).toEqual(['post', 'post', 'post'])
  })
})
