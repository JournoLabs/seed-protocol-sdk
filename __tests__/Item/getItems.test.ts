import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getItemsData } from '@/db/read/getItems'
import { BaseDb } from '@/db/Db/BaseDb'
import { seeds } from '@/seedSchema'
import { setupTestEnvironment, teardownTestEnvironment } from '../test-utils/client-init'
import {
  createGetPublishPayloadTestSchema,
  createItemWithBasicPropertiesOnly,
} from '../test-utils/getPublishPayloadIntegrationHelpers'

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe

testDescribe('getItemsData', () => {
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

  it('returns only local items (no seedUid) by default', async () => {
    const { item } = await createItemWithBasicPropertiesOnly({
      title: 'Local only test',
      count: 1,
    })
    expect(item.seedLocalId).toBeTruthy()

    const items = await getItemsData({ modelName: 'Post', includeEas: false })
    expect(Array.isArray(items)).toBe(true)
    // All returned items should have no seedUid (local only)
    for (const i of items) {
      expect(i.seedUid === null || i.seedUid === undefined || i.seedUid === '').toBe(true)
    }
    const found = items.find((i) => i.seedLocalId === item.seedLocalId)
    expect(found).toBeDefined()
  })

  it('includes EAS items when includeEas is true', async () => {
    // Create a local item
    await createItemWithBasicPropertiesOnly({
      title: 'Include EAS test',
      count: 1,
    })

    // Manually insert an EAS-style seed (with uid) for testing
    const appDb = BaseDb.getAppDb()
    const easSeedLocalId = 'eas-test-seed-' + Date.now()
    const easSeedUid = '0x' + 'b'.repeat(64)
    await appDb.insert(seeds).values({
      localId: easSeedLocalId,
      uid: easSeedUid,
      type: 'post',
      schemaUid: null,
      createdAt: Date.now(),
    })
    // Need a version for the seed to appear in getItemsData (versionsCount > 0)
    const { versions } = await import('@/seedSchema')
    await appDb.insert(versions).values({
      localId: 'eas-test-version-' + Date.now(),
      seedLocalId: easSeedLocalId,
      seedUid: easSeedUid,
      seedType: 'post',
      createdAt: Date.now(),
    })

    const itemsWithEas = await getItemsData({ modelName: 'Post', includeEas: true })
    const easItem = itemsWithEas.find((i) => i.seedUid === easSeedUid)
    expect(easItem).toBeDefined()

    const itemsLocalOnly = await getItemsData({ modelName: 'Post', includeEas: false })
    const easItemInLocalOnly = itemsLocalOnly.find((i) => i.seedUid === easSeedUid)
    expect(easItemInLocalOnly).toBeUndefined()
  })
})
