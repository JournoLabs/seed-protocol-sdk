import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { BaseDb } from '@/db/Db/BaseDb'
import { seeds } from '@/seedSchema'
import { eq } from 'drizzle-orm'
import { getPublishPayload } from '@/db/read/getPublishPayload'
import { updateSeedUid } from '@/db/write/updateSeedUid'
import { setupTestEnvironment, teardownTestEnvironment } from '../../test-utils/client-init'
import {
  createGetPublishPayloadTestSchema,
  createItemWithBasicPropertiesOnly,
} from '../../test-utils/getPublishPayloadIntegrationHelpers'

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe

const TEST_SEED_UID = '0x' + 'a'.repeat(64)

testDescribe('updateSeedUid and persistSeedUid', () => {
  beforeAll(async () => {
    await setupTestEnvironment({
      testFileUrl: import.meta.url,
      timeout: 90000,
    })
    await createGetPublishPayloadTestSchema()
  }, 90000)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it('persistSeedUid writes seedUid to DB and getPublishPayload uses it', async () => {
    const { item } = await createItemWithBasicPropertiesOnly({
      title: 'Persist seedUid test',
      count: 1,
    })
    const seedLocalId = item.seedLocalId
    expect(seedLocalId).toBeTruthy()

    // Before assign: DB row has no uid (or null)
    const db = BaseDb.getAppDb()
    const beforeRows = await db.select({ uid: seeds.uid }).from(seeds).where(eq(seeds.localId, seedLocalId)).limit(1)
    expect(beforeRows.length).toBe(1)
    expect(beforeRows[0].uid).toBeFalsy()

    // Assign and persist
    ;(item as any).seedUid = TEST_SEED_UID
    await item.persistSeedUid()

    // DB should now have the uid
    const afterRows = await db.select({ uid: seeds.uid }).from(seeds).where(eq(seeds.localId, seedLocalId)).limit(1)
    expect(afterRows.length).toBe(1)
    expect(afterRows[0].uid).toBe(TEST_SEED_UID)

    // getPublishPayload should return the assigned seedUid in the main payload
    const result = await getPublishPayload(item, [])
    expect(result.length).toBeGreaterThanOrEqual(1)
    const mainPayload = result.find((p) => p.localId === seedLocalId)
    expect(mainPayload).toBeDefined()
    expect(mainPayload!.seedUid).toBe(TEST_SEED_UID)
  }, 30000)

  it('updateSeedUid no-ops when seedLocalId or seedUid is missing', async () => {
    await updateSeedUid({ seedLocalId: '', seedUid: '0x123' })
    await updateSeedUid({ seedLocalId: 'some-id', seedUid: '' })
    // Should not throw; no rows updated is acceptable
  })
})
