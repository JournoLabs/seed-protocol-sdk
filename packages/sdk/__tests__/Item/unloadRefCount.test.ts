import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Item } from '@/Item/Item'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'
import {
  createGetPublishPayloadTestSchema,
  createItemWithBasicPropertiesOnly,
} from '../test-utils/getPublishPayloadIntegrationHelpers'

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe

/**
 * Item.create and Item.find hand every caller the same cached instance. unload used to stop it for
 * all of them; it now releases one holder.
 */
testDescribe('Item.unload releases one holder', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    await createGetPublishPayloadTestSchema()
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it('keeps a shared item running until its last holder unloads it', async () => {
    const { item } = await createItemWithBasicPropertiesOnly({ title: 'shared' })
    const found = await Item.find({ seedLocalId: item.seedLocalId!, hold: true })
    expect(found).toBe(item)

    found!.unload()
    expect(item.getService().getSnapshot().status).toBe('active')
    const again = await Item.find({ seedLocalId: item.seedLocalId!, hold: true })
    expect(again).toBe(item)
    expect(again!.getService().getSnapshot().status).toBe('active')

    again!.unload()
    item.unload()
    expect(item.getService().getSnapshot().status).toBe('stopped')
  }, 30000)
})
