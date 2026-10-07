import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getPublishPayload } from '@/db/read/getPublishPayload'
import { getPublishUploads, itemHasPublishUploadCandidates } from '@/db/read/getPublishUploads'
import { summarizePublishWork } from '@/db/read/summarizePublishWork'
import { isPublishedSeedRef } from '@/helpers/relationSeedRef'
import { Item } from '@/Item/Item'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../../test-utils/client-init'
import {
  createGetPublishPayloadTestSchema,
  waitForPropertyInstances,
} from '../../test-utils/getPublishPayloadIntegrationHelpers'

/**
 * A server publishing on someone's behalf only holds the uids of their other seeds (no local rows).
 * Relations to those uids are already published: publish must attest the uid and not walk into them.
 */
const AUTHOR_UID = '0x' + 'a'.repeat(64)
const TAG_UID = '0x' + 'b'.repeat(64)

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe

describe('isPublishedSeedRef', () => {
  it('is true only for 0x uids', () => {
    expect(isPublishedSeedRef(AUTHOR_UID)).toBe(true)
    expect(isPublishedSeedRef({ seedUid: AUTHOR_UID })).toBe(true)
    expect(isPublishedSeedRef('abcdefghij')).toBe(false)
    expect(isPublishedSeedRef({ seedLocalId: 'abcdefghij', seedUid: AUTHOR_UID })).toBe(false)
    expect(isPublishedSeedRef('0x1234')).toBe(false)
    expect(isPublishedSeedRef('')).toBe(false)
    expect(isPublishedSeedRef(undefined)).toBe(false)
  })
})

testDescribe('publish with relations to published uids that have no local copy', () => {
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

  const createPostWithUidRelations = async (title: string) => {
    const postItem = await Item.create({
      modelName: 'Post',
      title,
      author: AUTHOR_UID,
      tagIds: [TAG_UID],
    } as any)
    await waitForPropertyInstances(postItem)
    expect(await Item.find({ seedUid: AUTHOR_UID })).toBeUndefined()
    expect(await Item.find({ seedUid: TAG_UID })).toBeUndefined()
    return postItem
  }

  it('getPublishUploads skips the relation instead of throwing', async () => {
    const postItem = await createPostWithUidRelations('Uploads with uid relations')
    await expect(itemHasPublishUploadCandidates(postItem)).resolves.toBe(false)
    await expect(getPublishUploads(postItem)).resolves.toEqual([])
  }, 30000)

  it('summarizePublishWork counts only the post seed', async () => {
    const postItem = await createPostWithUidRelations('Summary with uid relations')
    const summary = await summarizePublishWork(postItem)
    expect(summary.seedCount).toBe(1)
  }, 30000)

  it('getPublishPayload attests the uids on the post and adds no related payloads', async () => {
    const postItem = await createPostWithUidRelations('Payload with uid relations')
    const result = await getPublishPayload(postItem, [])
    expect(result).toHaveLength(1)
    const [mainPayload] = result
    expect(mainPayload.localId).toBe(postItem.seedLocalId)

    const encodedFor = (propertyName: string) =>
      mainPayload.listOfAttestations
        .find((a) => a._propertyName === propertyName)
        ?.data[0]?.data?.toLowerCase()
    expect(encodedFor('author')).toContain('a'.repeat(64))
    expect(encodedFor('tagIds')).toContain('b'.repeat(64))
  }, 30000)

  it('still throws for a local id with no local item', async () => {
    const postItem = await Item.create({
      modelName: 'Post',
      title: 'Uploads with broken local relation',
      author: '0000000000',
    })
    await waitForPropertyInstances(postItem)
    await expect(getPublishUploads(postItem)).rejects.toThrow('No relatedItem found for author')
    await expect(getPublishPayload(postItem, [])).rejects.toThrow(
      'No related item found for required relation',
    )
  }, 30000)
})
