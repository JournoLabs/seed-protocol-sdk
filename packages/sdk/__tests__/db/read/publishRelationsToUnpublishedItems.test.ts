import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { seeds, versions } from '@/seedSchema'
import { htmlEmbeddedImageCoPublish } from '@/seedSchema/HtmlEmbeddedImageCoPublishSchema'
import { Item } from '@/Item/Item'
import {
  getPublishPayload,
  PublishValidationFailedError,
  validateItemForPublish,
} from '@/db/read/getPublishPayload'
import { RelatedItemUnpublishedError } from '@/db/read/publishErrors'
import { getUnpublishedRelatedItems, summarizePublishWork } from '@/db/read/summarizePublishWork'
import { updateSeedRevokedAt } from '@/db/write/updateSeedRevokedAt'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../../test-utils/client-init'
import {
  createGetPublishPayloadTestSchema,
  createImageItemWithMissingStorageTxMetadata,
  createPublishedTestAuthor,
  waitForPropertyInstances,
} from '../../test-utils/getPublishPayloadIntegrationHelpers'
import { waitForIdle } from '../../test-utils/waitForIdle'

/**
 * A relation, list or image property pointing at an unpublished (revoked) seed can't be published:
 * the parent would attest a revoked uid. Publish stops before anything is sent and names the items.
 */
const SCHEMA_NAME = 'Test Schema getPublishPayload'

let uidCounter = 0
const nextUid = (): string => {
  uidCounter += 1
  const tail = `${Date.now().toString(16)}${uidCounter.toString(16).padStart(4, '0')}`
  return '0x' + ('3f7a11' + tail).padEnd(64, 'e')
}

/** Marks an item's seed (and its one version) attested under `seedUid`. */
const markPublished = async (item: Item<any>, seedUid = nextUid()): Promise<string> => {
  const db = BaseDb.getAppDb()
  await db.update(seeds).set({ uid: seedUid }).where(eq(seeds.localId, item.seedLocalId))
  await db
    .update(versions)
    .set({ uid: nextUid(), seedUid, attestationCreatedAt: Date.now() })
    .where(eq(versions.seedLocalId, item.seedLocalId))
  item.getService().send({ type: 'updateContext', seedUid })
  return seedUid
}

const unpublish = (item: Item<any>) =>
  updateSeedRevokedAt({ seedLocalId: item.seedLocalId, revokedAt: Math.floor(Date.now() / 1000) })

const createItem = async (props: Record<string, unknown>) => {
  const item = await Item.create({ schemaName: SCHEMA_NAME, ...props } as any)
  await waitForIdle(item, 'Item', 15000)
  await waitForPropertyInstances(item)
  return item
}

const encodedFor = (payload: any[], localId: string, propertyName: string) =>
  payload
    .find((p) => p.localId === localId)
    ?.listOfAttestations.find((a: any) => a._propertyName === propertyName)
    ?.data[0]?.data?.toLowerCase() as string | undefined

describe.sequential('publish with relations to unpublished items', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    await createGetPublishPayloadTestSchema()
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it('relation to a revoked item: throws RelatedItemUnpublishedError naming it; nothing to send', async () => {
    const author = await createItem({ modelName: 'Author', name: 'Gone author' })
    const authorUid = await markPublished(author)
    await unpublish(author)
    const post = await createItem({ modelName: 'Post', title: 'Points at gone author', author: author.seedLocalId })

    const error = await getPublishPayload(post, []).catch((e) => e)
    expect(error).toBeInstanceOf(RelatedItemUnpublishedError)
    expect(error).toBeInstanceOf(PublishValidationFailedError)
    expect(error.unpublishedRelatedItems).toEqual([
      { propertyName: 'author', modelName: 'Author', seedLocalId: author.seedLocalId, seedUid: authorUid },
    ])
    expect(error.message).toContain(author.seedLocalId)
    expect(error.message).toContain(authorUid)
    expect(error.message).toMatch(/republish/i)

    // The publish package's checking step uses this: it fails before uploading or attesting.
    const validation = await validateItemForPublish(post, [])
    expect(validation.isValid).toBe(false)
    expect(validation.errors).toContainEqual(
      expect.objectContaining({ field: 'author', code: 'related_item_unpublished' }),
    )

    // Estimates don't throw; they list what blocks the publish.
    const summary = await summarizePublishWork(post)
    expect(summary.unpublishedRelatedItems).toEqual(error.unpublishedRelatedItems)
    // What the publish package's checking step runs before registering schemas or uploading.
    expect(await getUnpublishedRelatedItems(post)).toEqual(error.unpublishedRelatedItems)
  }, 60000)

  it('list member that is revoked: names the list property', async () => {
    const author = await createPublishedTestAuthor()
    const liveTag = await createItem({ modelName: 'Tag', label: 'live tag' })
    await markPublished(liveTag)
    const goneTag = await createItem({ modelName: 'Tag', label: 'gone tag' })
    const goneTagUid = await markPublished(goneTag)
    await unpublish(goneTag)
    const post = await createItem({
      modelName: 'Post',
      title: 'Lists a gone tag',
      author: author.seedLocalId,
      tagIds: JSON.stringify([liveTag.seedLocalId, goneTag.seedLocalId]),
    })

    const error = await getPublishPayload(post, []).catch((e) => e)
    expect(error).toBeInstanceOf(RelatedItemUnpublishedError)
    expect(error.unpublishedRelatedItems).toEqual([
      { propertyName: 'tagIds', modelName: 'Tag', seedLocalId: goneTag.seedLocalId, seedUid: goneTagUid },
    ])
    expect((await summarizePublishWork(post)).unpublishedRelatedItems).toEqual(error.unpublishedRelatedItems)
  }, 60000)

  it('image pointing at a revoked image seed: names the image property', async () => {
    const author = await createPublishedTestAuthor()
    const { imageSeedLocalId } = await createImageItemWithMissingStorageTxMetadata()
    const image = (await Item.find({ seedLocalId: imageSeedLocalId }))! as Item<any>
    const imageUid = await markPublished(image)
    await unpublish(image)
    const post = await createItem({
      modelName: 'Post',
      title: 'Shows a gone image',
      author: author.seedLocalId,
      coverImage: imageSeedLocalId,
    })

    const error = await getPublishPayload(post, []).catch((e) => e)
    expect(error).toBeInstanceOf(RelatedItemUnpublishedError)
    expect(error.unpublishedRelatedItems).toEqual([
      { propertyName: 'coverImage', modelName: 'Image', seedLocalId: imageSeedLocalId, seedUid: imageUid },
    ])
  }, 60000)

  it('image embedded in an Html property (co-published) pointing at a revoked image seed: names the Html property', async () => {
    const author = await createPublishedTestAuthor()
    const { imageSeedLocalId } = await createImageItemWithMissingStorageTxMetadata()
    const image = (await Item.find({ seedLocalId: imageSeedLocalId }))! as Item<any>
    const imageUid = await markPublished(image)
    await unpublish(image)
    const post = await createItem({ modelName: 'Post', title: 'Embeds a gone image', author: author.seedLocalId })
    // As prepareHtmlEmbeddedImagesForPublish leaves it: bodyHtml holds its Html seed, and a co-publish
    // row links the embedded image to the post (a row left from an earlier, interrupted publish).
    const htmlSeedLocalId = `html${Date.now().toString(36)}`
    const bodyHtml = post.allProperties['bodyHtml']
    expect(bodyHtml).toBeDefined()
    bodyHtml!.getService().send({ type: 'updateContext', propertyValue: htmlSeedLocalId })
    await BaseDb.getAppDb().insert(htmlEmbeddedImageCoPublish).values({
      parentSeedLocalId: post.seedLocalId,
      htmlSeedLocalId,
      imageSeedLocalId,
      stableKey: `gone-${imageSeedLocalId}`,
      createdAt: Date.now(),
    })

    const expected = [
      { propertyName: 'bodyHtml', modelName: 'Image', seedLocalId: imageSeedLocalId, seedUid: imageUid },
    ]
    const error = await getPublishPayload(post, []).catch((e) => e)
    expect(error).toBeInstanceOf(RelatedItemUnpublishedError)
    expect(error.unpublishedRelatedItems).toEqual(expected)
    expect((await summarizePublishWork(post)).unpublishedRelatedItems).toEqual(expected)
    expect(await getUnpublishedRelatedItems(post)).toEqual(expected)
  }, 60000)

  it('relation to a live published item: unchanged, attests its uid', async () => {
    const author = await createPublishedTestAuthor()
    const post = await createItem({ modelName: 'Post', title: 'Points at live author', author: author.seedLocalId })

    const payload = await getPublishPayload(post, [])
    expect(payload.map((p) => p.localId)).toEqual([post.seedLocalId])
    expect(encodedFor(payload, post.seedLocalId, 'author')).toContain(author.seedUid!.slice(2).toLowerCase())
    expect((await summarizePublishWork(post)).unpublishedRelatedItems).toEqual([])
  }, 60000)

  it('revoked item since republished (new uid): attests the new uid, by local id or by its old uid', async () => {
    const author = await createItem({ modelName: 'Author', name: 'Back again' })
    const oldUid = await markPublished(author)
    await unpublish(author)
    // Republished: a new seed attestation. Its old version row still records the old seed uid.
    const newUid = nextUid()
    await BaseDb.getAppDb()
      .update(seeds)
      .set({ uid: newUid, revokedAt: null })
      .where(eq(seeds.localId, author.seedLocalId))
    ;(author as { seedUid?: string }).seedUid = newUid

    for (const ref of [author.seedLocalId, oldUid]) {
      const post = await createItem({ modelName: 'Post', title: `Republished author via ${ref}`, author: ref })
      const payload = await getPublishPayload(post, [])
      expect(payload.map((p) => p.localId)).toEqual([post.seedLocalId])
      const encoded = encodedFor(payload, post.seedLocalId, 'author')
      expect(encoded).toContain(newUid.slice(2).toLowerCase())
      expect(encoded).not.toContain(oldUid.slice(2).toLowerCase())
      expect((await summarizePublishWork(post)).unpublishedRelatedItems).toEqual([])
    }
  }, 60000)
})
