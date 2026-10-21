/**
 * Publish reads (payload build, upload data, work summary, draft graph) load the related items
 * they walk. Each load takes an Item cache hold; the read must drop its own holds when it is done,
 * or every related item stays loaded and running for the session (audit 1.10 / V8).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getPublishPayload } from '@/db/read/getPublishPayload'
import { getPublishUploadData, itemHasPublishUploadCandidates } from '@/db/read/getPublishUploads'
import { getPublishDraftGraph } from '@/db/read/publishDraftGraph'
import { getRelatedItemsForPublish } from '@/db/read/getRelatedItemsForPublish'
import { getUnpublishedRelatedItems, summarizePublishWork } from '@/db/read/summarizePublishWork'
import { Item } from '@/Item/Item'
import type { IItem } from '@/interfaces'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../../test-utils/client-init'
import {
  createGetPublishPayloadTestSchema,
  createItemWithRelation,
} from '../../test-utils/getPublishPayloadIntegrationHelpers'

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe

const refCount = (id: string) =>
  ((Item as any).instanceCache as Map<string, { refCount: number }>).get(id)?.refCount

const status = (item: IItem<any>) => item.getService().getSnapshot().status

testDescribe('publish reads release the Item holds they take', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    await createGetPublishPayloadTestSchema()
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it('getPublishPayload leaves the related item refCount unchanged, and it stops once its holder unloads', async () => {
    const { authorItem, postItem } = await createItemWithRelation({ authorName: 'Holds Author', postTitle: 'Holds Post' })
    const authorId = authorItem.seedLocalId
    const postId = postItem.seedLocalId
    const before = { author: refCount(authorId), post: refCount(postId) }
    expect(before.author).toBeGreaterThan(0)

    const payload = await getPublishPayload(postItem, [])
    expect(payload.map((p) => p.localId)).toContain(authorId)
    await getPublishPayload(postItem, [])

    expect({ author: refCount(authorId), post: refCount(postId) }).toEqual(before)

    authorItem.unload()
    postItem.unload()
    expect(refCount(authorId)).toBeUndefined()
    expect(status(authorItem)).toBe('stopped')
  }, 60_000)

  it('getPublishPayload stops a related item it loaded itself', async () => {
    const { authorItem, postItem } = await createItemWithRelation({ authorName: 'Unheld Author', postTitle: 'Unheld Post' })
    const authorId = authorItem.seedLocalId
    authorItem.unload()
    expect(refCount(authorId)).toBeUndefined()

    const payload = await getPublishPayload(postItem, [])
    expect(payload.map((p) => p.localId)).toContain(authorId)
    expect(refCount(authorId)).toBeUndefined()
    postItem.unload()
  }, 60_000)

  it('upload data, work summary and unpublished-ref reads stop the related items they loaded', async () => {
    const { authorItem, postItem } = await createItemWithRelation({ authorName: 'Walk Author', postTitle: 'Walk Post' })
    const authorId = authorItem.seedLocalId
    authorItem.unload()

    await getPublishUploadData(postItem)
    expect(refCount(authorId)).toBeUndefined()
    await itemHasPublishUploadCandidates(postItem)
    expect(refCount(authorId)).toBeUndefined()
    const summary = await summarizePublishWork(postItem)
    expect(summary.newSeedCount).toBe(2)
    expect(refCount(authorId)).toBeUndefined()
    await getUnpublishedRelatedItems(postItem)
    expect(refCount(authorId)).toBeUndefined()
    postItem.unload()
  }, 60_000)

  it('getPublishDraftGraph and getRelatedItemsForPublish hold only the items they return', async () => {
    const { authorItem, postItem } = await createItemWithRelation({ authorName: 'Graph Author', postTitle: 'Graph Post' })
    const authorId = authorItem.seedLocalId
    authorItem.unload()

    const { drafts } = await getPublishDraftGraph(postItem)
    expect(drafts.map((d) => d.item.seedLocalId)).toEqual([authorId])
    expect(refCount(authorId)).toBe(1)
    drafts[0]!.item.unload()
    expect(refCount(authorId)).toBeUndefined()

    const related = await getRelatedItemsForPublish(postItem)
    expect(related.map((r) => r.seedLocalId)).toEqual([authorId])
    expect(refCount(authorId)).toBe(1)
    related[0]!.unload()
    expect(refCount(authorId)).toBeUndefined()
    postItem.unload()
  }, 60_000)
})
