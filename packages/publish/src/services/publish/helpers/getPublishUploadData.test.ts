import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Item } from '@seedprotocol/sdk'
import { getPublishUploadData } from './getPublishUploadData'
import {
  setupTestEnvironment,
  teardownTestEnvironment,
  SETUP_HOOK_TIMEOUT_MS,
} from '../../../../../sdk/__tests__/test-utils/client-init'
import {
  createGetPublishPayloadTestSchema,
  waitForPropertyInstances,
} from '../../../../../sdk/__tests__/test-utils/getPublishPayloadIntegrationHelpers'

/**
 * A server publishing on someone's behalf only holds the uids of their other seeds (no local rows).
 * The upload walk must treat those relations as already published instead of throwing.
 */
describe.sequential('getPublishUploadData with relations to published uids', () => {
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

  it('skips a 0x relation with no local item', async () => {
    const postItem = await Item.create({
      modelName: 'Post',
      title: 'Post with uid author',
      author: '0x' + 'a'.repeat(64),
      tagIds: ['0x' + 'b'.repeat(64)],
    } as any)
    await waitForPropertyInstances(postItem)
    await expect(getPublishUploadData(postItem)).resolves.toEqual([])
  }, 30000)

  it('still throws for a local id with no local item', async () => {
    const postItem = await Item.create({
      modelName: 'Post',
      title: 'Post with broken author',
      author: '0000000000',
    } as any)
    await waitForPropertyInstances(postItem)
    await expect(getPublishUploadData(postItem)).rejects.toThrow('No relatedItem found for author')
  }, 30000)
})
