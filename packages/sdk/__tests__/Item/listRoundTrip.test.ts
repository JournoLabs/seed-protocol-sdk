import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Item } from '@/Item/Item'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'
import { createGetPublishPayloadTestSchema, createItemWithList } from '../test-utils/getPublishPayloadIntegrationHelpers'
import { waitForItemIdle } from '../test-utils/waitForIdle'

/** A List of Relation reads back as an array, on the created item and after a reload. */

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe

testDescribe('List of Relation round trip', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    await createGetPublishPayloadTestSchema()
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it('reads back as an array of ids', async () => {
    const { tagItems, postItem } = await createItemWithList({ tagLabels: ['a', 'b'] })
    const ids = tagItems.map((t) => t.seedLocalId)
    expect(postItem.tagIds).toEqual(ids)

    Item.dropCachedInstancesForSeedIds([postItem.seedLocalId])
    const reloaded = await Item.find({ seedLocalId: postItem.seedLocalId })
    await waitForItemIdle(reloaded!)
    expect((reloaded as any).tagIds).toEqual(ids)
  }, 30000)
})
