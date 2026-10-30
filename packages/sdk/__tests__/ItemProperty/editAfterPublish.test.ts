/**
 * Editing a published property writes a new draft row. The property must point at that row, with no
 * uid, or patch Publish skips the edit as attested (PermaPress, 2026-10-17).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { waitFor } from 'xstate'
import { and, eq } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { metadata, seeds, versions } from '@/seedSchema'
import { getPublishPayload } from '@/db/read/getPublishPayload'
import type { Item as ItemClass } from '@/Item/Item'
import type { IItemProperty } from '@/interfaces'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'
import { WAIT_TIMEOUT_MS } from '../test-utils/timeouts'
import {
  createGetPublishPayloadTestSchema,
  createItemWithList,
  createPublishedTestAuthor,
  markPublished,
  UNPUBLISH_TEST_PUBLISHER,
} from '../test-utils/getPublishPayloadIntegrationHelpers'

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe

const propertyOf = (item: ItemClass<any>, name: string) =>
  item.properties.find((p) => p.propertyName === name) as IItemProperty<any>

async function setAndSave(property: IItemProperty<any>, value: unknown): Promise<void> {
  property.value = value
  await waitFor(property.getService(), (s) => s.value === 'idle' && !s.context.isSaving, {
    timeout: WAIT_TIMEOUT_MS,
  })
}

const rowsFor = (seedLocalId: string, propertyName: string) =>
  BaseDb.getAppDb()
    .select()
    .from(metadata)
    .where(and(eq(metadata.seedLocalId, seedLocalId), eq(metadata.propertyName, propertyName)))

const attestedNames = async (item: ItemClass<any>): Promise<string[]> => {
  const payloads = await getPublishPayload(item, [], { publishMode: 'patch' })
  const own = payloads.find((p) => p.localId === item.seedLocalId)
  return (own?.listOfAttestations ?? []).map((a: { _propertyName?: string }) => a._propertyName ?? '')
}

testDescribe('editing a property after its seed is published', () => {
  beforeAll(async () => {
    await setupTestEnvironment({
      testFileUrl: import.meta.url,
      timeout: SETUP_HOOK_TIMEOUT_MS,
      configOverrides: { addresses: [UNPUBLISH_TEST_PUBLISHER] },
    })
    await createGetPublishPayloadTestSchema()
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it('points the property at the new draft row and patch Publish attests it', async () => {
    const { tagItems, postItem } = await createItemWithList({ tagLabels: ['a', 'b', 'c'] })
    await markPublished(postItem, tagItems)
    expect(await attestedNames(postItem)).toEqual([])

    const title = propertyOf(postItem, 'title')
    const author = propertyOf(postItem, 'author')
    const tagIds = propertyOf(postItem, 'tagIds')
    const publishedTitleLocalId = title.localId

    const otherAuthor = await createPublishedTestAuthor()
    await setAndSave(title, 'edited title')
    await setAndSave(author, otherAuthor.seedLocalId)
    const [a, b, c] = tagItems.map((t) => t.seedLocalId!)
    await setAndSave(tagIds, [c, a, b])

    for (const property of [title, author, tagIds]) {
      const { context } = property.getService().getSnapshot()
      expect(context.uid, property.propertyName).toBeUndefined()
      const [row] = await BaseDb.getAppDb().select().from(metadata).where(eq(metadata.localId, context.localId!))
      expect(row?.uid ?? null, property.propertyName).toBeNull()
    }
    expect(title.localId).not.toBe(publishedTitleLocalId)

    const names = await attestedNames(postItem)
    expect(names).toEqual(expect.arrayContaining(['title', 'author']))
    expect(names.some((n) => n.startsWith('tag'))).toBe(true)
    expect(names).not.toContain('count')
  }, 60_000)

  it('keeps later edits in the same draft row', async () => {
    const { postItem } = await createItemWithList({ tagLabels: ['x'] })
    await markPublished(postItem)
    const title = propertyOf(postItem, 'title')

    await setAndSave(title, 'first edit')
    await setAndSave(title, 'second edit')

    const rows = await rowsFor(postItem.seedLocalId!, 'title')
    expect(rows.filter((r) => !r.uid).map((r) => r.propertyValue)).toEqual(['second edit'])
    expect(rows).toHaveLength(2)
  }, 60_000)

  it('an edit back to the published value leaves no draft, even with a context naming the published row', async () => {
    const { postItem } = await createItemWithList({ tagLabels: ['x'] })
    await markPublished(postItem)
    const title = propertyOf(postItem, 'title')
    const publishedValue = title.value

    await setAndSave(title, 'draft edit')
    // A context still naming the published row (the bug this file covers, or another tab's edit).
    const [published] = (await rowsFor(postItem.seedLocalId!, 'title')).filter((r) => r.uid)
    title.getService().send({ type: 'updateContext', localId: published!.localId, uid: published!.uid })

    await setAndSave(title, publishedValue)

    // The draft that held the edit is gone, and the published row is current again (ADR 0019)
    const drafts = (await rowsFor(postItem.seedLocalId!, 'title')).filter((r) => !r.uid)
    expect(drafts).toEqual([])
    expect(title.value).toBe(publishedValue)
  }, 60_000)

  it('patch Publish attests a draft row the property context missed', async () => {
    const { postItem } = await createItemWithList({ tagLabels: ['x'] })
    await markPublished(postItem)
    const title = propertyOf(postItem, 'title')

    await setAndSave(title, 'edited elsewhere')
    const [published] = (await rowsFor(postItem.seedLocalId!, 'title')).filter((r) => r.uid)
    title.getService().send({ type: 'updateContext', localId: published!.localId, uid: published!.uid })

    // Publish reads rows: the draft row is attested, whatever the context names.
    const payloads = await getPublishPayload(postItem, [], { publishMode: 'patch' })
    const own = payloads.find((p) => p.localId === postItem.seedLocalId)!
    const titleAttestation = own.listOfAttestations.find((a: { _propertyName?: string }) => a._propertyName === 'title')
    const [draft] = (await rowsFor(postItem.seedLocalId!, 'title')).filter((r) => !r.uid)
    expect(titleAttestation?._metadataLocalId).toBe(draft!.localId)
  }, 60_000)
})
