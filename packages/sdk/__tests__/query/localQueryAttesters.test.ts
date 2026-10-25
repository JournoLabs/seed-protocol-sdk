/**
 * The local query source's `attesters` filter matches the seed's attester (from attestation_raw,
 * else `publisher`) in any case, before `limit` and `skip`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { BaseDb } from '@/db/Db/BaseDb'
import { seeds, versions } from '@/seedSchema'
import { createLocalQueryDataSource } from '@/query/createLocalQueryDataSource'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'

// Browser test files share one database: a per-run prefix keeps these uids apart.
const RUN = Math.random().toString(16).slice(2, 10).padEnd(8, '0')
const uid = (byte: string) => '0x' + RUN + byte.repeat(28)
const SCHEMA = 'lqattesters_post'
const SEED_SCHEMA_UID = uid('5e')
const OWNER = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'
const OTHER = '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359'

// Newest first: OWNER_NEW, OTHER_SEED, OWNER_OLD_NO_RAW.
const OWNER_NEW = uid('a1')
const OTHER_SEED = uid('b1')
const OWNER_OLD_NO_RAW = uid('c1')

describe.sequential('local query source attesters filter', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    const db = BaseDb.getAppDb()
    const raw = (id: string, attester: string) =>
      JSON.stringify({
        id,
        refUID: uid('00'),
        schemaId: SEED_SCHEMA_UID,
        timeCreated: 1_700_000_000,
        decodedDataJson: '',
        attester,
        schema: { schemaNames: [{ name: SCHEMA }] },
      })
    const rows = [
      { seedUid: OWNER_OLD_NO_RAW, publisher: OWNER.toLowerCase(), attestationRaw: null },
      { seedUid: OTHER_SEED, publisher: OTHER, attestationRaw: raw(OTHER_SEED, OTHER) },
      { seedUid: OWNER_NEW, publisher: OWNER, attestationRaw: raw(OWNER_NEW, OWNER) },
    ]
    for (const [i, { seedUid, publisher, attestationRaw }] of rows.entries()) {
      const seedLocalId = `lqat-seed-${RUN}-${i}`
      await db.insert(seeds).values({
        localId: seedLocalId,
        uid: seedUid,
        schemaUid: SEED_SCHEMA_UID,
        type: SCHEMA,
        publisher,
        attestationRaw,
        attestationCreatedAt: 1_700_000_000_000 + i,
        createdAt: 1_700_000_000_000 + i,
      })
      await db.insert(versions).values({
        localId: `lqat-version-${RUN}-${i}`,
        uid: uid(`d${i}`),
        seedLocalId,
        seedUid,
        seedType: SCHEMA,
        publisher,
        attestationCreatedAt: 1_700_000_001_000 + i,
        createdAt: 1_700_000_001_000 + i,
      })
    }
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  const listIds = async (opts: { attesters?: string[]; limit?: number; skip?: number }) => {
    const ds = createLocalQueryDataSource()
    const listed = await ds.listSeedsBySchemaName(SCHEMA, { limit: 10, skip: 0, ...opts })
    return listed.map((att) => att.id)
  }

  it('keeps only seeds attested by one of the attesters', async () => {
    expect(await listIds({})).toEqual([OWNER_NEW, OTHER_SEED, OWNER_OLD_NO_RAW])
    expect(await listIds({ attesters: [OWNER.toLowerCase()] })).toEqual([OWNER_NEW, OWNER_OLD_NO_RAW])
    expect(await listIds({ attesters: [OTHER.toLowerCase()] })).toEqual([OTHER_SEED])
    expect(await listIds({ attesters: [OWNER.toLowerCase(), OTHER.toLowerCase()] })).toEqual([
      OWNER_NEW,
      OTHER_SEED,
      OWNER_OLD_NO_RAW,
    ])
  })

  it('applies limit and skip to the filtered seeds', async () => {
    const attesters = [OWNER.toLowerCase()]
    expect(await listIds({ attesters, limit: 1, skip: 0 })).toEqual([OWNER_NEW])
    expect(await listIds({ attesters, limit: 1, skip: 1 })).toEqual([OWNER_OLD_NO_RAW])
  })
})
