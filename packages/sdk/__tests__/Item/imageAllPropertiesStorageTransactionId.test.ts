import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Item } from '@/Item/Item'
import { waitForEntityReady } from '@/helpers/entity/entityLifecycle'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe

/**
 * Publish reads allProperties.storageTransactionId of the Image items it materializes from Html
 * embedded images (createImageItemFromBytes); this must exist after Item.create({ modelName: 'Image' }).
 */
testDescribe('Image allProperties storageTransactionId key', () => {
  beforeAll(async () => {
    await setupTestEnvironment({
      testFileUrl: import.meta.url,
      timeout: SETUP_HOOK_TIMEOUT_MS,
    })
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it('exposes storageTransactionId on allProperties after minimal Image create', async () => {
    const imageItem = await Item.create({ modelName: 'Image' })
    await waitForEntityReady(imageItem, { timeout: 60_000 })
    const keys = Object.keys(imageItem.allProperties)
    expect(
      imageItem.allProperties.storageTransactionId,
      `expected allProperties.storageTransactionId; keys=${keys.join(',')}`,
    ).toBeDefined()
  }, 120_000)
})
