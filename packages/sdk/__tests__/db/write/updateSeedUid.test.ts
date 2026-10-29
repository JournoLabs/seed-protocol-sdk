import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { BaseDb } from '@/db/Db/BaseDb'
import { seeds } from '@/seedSchema'
import { eq } from 'drizzle-orm'
import { getPublishPayload } from '@/db/read/getPublishPayload'
import { updateSeedUid } from '@/db/write/updateSeedUid'
import { createSeed } from '@/db/write/createSeed'
import { setGetPublisherForNewSeeds, getGetPublisherForNewSeeds } from '@/helpers/publishConfig'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../../test-utils/client-init'
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
      timeout: SETUP_HOOK_TIMEOUT_MS,
    })
    await createGetPublishPayloadTestSchema()
  }, SETUP_HOOK_TIMEOUT_MS)

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

  // A draft stamped with the EOA and attested by the smart account kept the EOA, so local reads
  // named the wrong attester (PermaPress seed-draft-ownership-next ask 2).
  it("updateSeedUid gives a draft seed the attester as publisher, and leaves a sealed seed's alone", async () => {
    const eoa = '0x' + '1'.repeat(40)
    const smartAccount = '0x' + '2'.repeat(40)
    const db = BaseDb.getAppDb()

    const { item: draft } = await createItemWithBasicPropertiesOnly({ title: 'Draft publisher', count: 1 })
    await db.update(seeds).set({ publisher: eoa }).where(eq(seeds.localId, draft.seedLocalId!))
    await updateSeedUid({ seedLocalId: draft.seedLocalId!, seedUid: '0x' + '9'.repeat(64), publisher: smartAccount })
    const [draftRow] = await db.select({ publisher: seeds.publisher }).from(seeds).where(eq(seeds.localId, draft.seedLocalId!))
    expect(draftRow?.publisher).toBe(smartAccount)

    // A republish after unpublish: the seed was attested before, so its publisher stays.
    await updateSeedUid({ seedLocalId: draft.seedLocalId!, seedUid: '0x' + '8'.repeat(64), publisher: eoa })
    const [sealedRow] = await db.select({ publisher: seeds.publisher }).from(seeds).where(eq(seeds.localId, draft.seedLocalId!))
    expect(sealedRow?.publisher).toBe(smartAccount)
  })

  it('createSeed sets publisher when getPublisherForNewSeeds is configured', async () => {
    const testPublisher = '0xCreateSeedPublisher1234567890abcdef12'
    setGetPublisherForNewSeeds(async () => testPublisher)
    try {
      const seedLocalId = await createSeed({ type: 'test_post', seedUid: '0x' + 'b'.repeat(64) })
      const db = BaseDb.getAppDb()
      const [row] = await db.select({ publisher: seeds.publisher }).from(seeds).where(eq(seeds.localId, seedLocalId))
      expect(row?.publisher).toBe(testPublisher.toLowerCase())
    } finally {
      setGetPublisherForNewSeeds(null)
    }
  })

  it('createSeed leaves publisher null when getter is not configured', async () => {
    const prev = getGetPublisherForNewSeeds()
    setGetPublisherForNewSeeds(null)
    try {
      const seedLocalId = await createSeed({ type: 'test_post', seedUid: '0x' + 'c'.repeat(64) })
      const db = BaseDb.getAppDb()
      const [row] = await db.select({ publisher: seeds.publisher }).from(seeds).where(eq(seeds.localId, seedLocalId))
      expect(row?.publisher).toBeNull()
    } finally {
      setGetPublisherForNewSeeds(prev)
    }
  })
})
