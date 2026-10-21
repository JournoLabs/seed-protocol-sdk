import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { BaseDb } from '@/db/Db/BaseDb'
import { metadata, versions } from '@/seedSchema'
import { getVersionsForSeedUid } from '@/db/read/getVersionsForSeedUid'
import { getMetadataAttestationUidsForSeedUid } from '@/db/read/getMetadataAttestationUidsForSeedUid'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../../test-utils/client-init'

const SEED_UID = '0x' + 'a1'.repeat(32)
const REAL_UID = '0x' + 'b2'.repeat(32)
const SCHEMA_UID = '0x' + 'c3'.repeat(32)
const ZERO_UPPER = '0X' + '0'.repeat(64)

/**
 * The uids revoke sends to EAS. Both readers used their own placeholder filters: versions let the
 * legacy 'NULL' sentinel and blank uids through, metadata let an upper-case or padded zero uid through.
 * They now use `isPlaceholderUid` from @seedprotocol/eas.
 */
describe.sequential('revoke target uids skip every placeholder form', () => {
  beforeAll(async () => {
    await setupTestEnvironment({
      testFileUrl: import.meta.url,
      timeout: SETUP_HOOK_TIMEOUT_MS,
    })

    const placeholders = [null, '', 'NULL', '  ', ZERO_UPPER, ` ${'0x' + '0'.repeat(64)} `]
    const appDb = BaseDb.getAppDb()
    await appDb.insert(versions).values([
      { localId: 'rtu-version-real', seedUid: SEED_UID, uid: REAL_UID, seedType: 'rtu_post', createdAt: 1_000 },
      ...placeholders.map((uid, i) => ({
        localId: `rtu-version-${i}`,
        seedUid: SEED_UID,
        uid,
        seedType: 'rtu_post',
        createdAt: 1_000,
      })),
    ])
    await appDb.insert(metadata).values([
      { localId: 'rtu-meta-real', seedUid: SEED_UID, uid: REAL_UID, schemaUid: SCHEMA_UID, propertyName: 'title' },
      ...placeholders.map((uid, i) => ({
        localId: `rtu-meta-${i}`,
        seedUid: SEED_UID,
        uid,
        schemaUid: SCHEMA_UID,
        propertyName: 'title',
      })),
    ])
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it('getVersionsForSeedUid returns only attested version uids', async () => {
    expect(await getVersionsForSeedUid(SEED_UID)).toEqual([{ uid: REAL_UID }])
  })

  it('getMetadataAttestationUidsForSeedUid returns only attested metadata uids', async () => {
    expect(await getMetadataAttestationUidsForSeedUid(SEED_UID)).toEqual([
      { uid: REAL_UID, schemaUid: SCHEMA_UID },
    ])
  })
})
