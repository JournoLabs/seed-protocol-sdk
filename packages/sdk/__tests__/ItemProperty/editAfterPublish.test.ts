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
  UNPUBLISH_TEST_PUBLISHER,
} from '../test-utils/getPublishPayloadIntegrationHelpers'

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe

const randomUid = () =>
  '0x' + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')

/**
 * Marks the item, its version and every metadata row attested by an owned address, and gives each property its row's
 * uid, as a reload (or the browser's metadata live query) does after a publish.
 */
async function markPublished(item: ItemClass<any>, related: ItemClass<any>[] = []): Promise<void> {
  const db = BaseDb.getAppDb()
  for (const other of related) {
    const uid = randomUid()
    await db.update(seeds).set({ uid }).where(eq(seeds.localId, other.seedLocalId!))
    other.getService().send({ type: 'updateContext', seedUid: uid })
  }
  const seedUid = randomUid()
  const versionUid = randomUid()
  const attestedAt = Date.now() - 10_000
  // Published by an owned address, so the item stays editable.
  await db
    .update(seeds)
    .set({ uid: seedUid, publisher: UNPUBLISH_TEST_PUBLISHER })
    .where(eq(seeds.localId, item.seedLocalId!))
  await db.update(versions).set({ uid: versionUid, seedUid }).where(eq(versions.seedLocalId, item.seedLocalId!))
  const rows = await db.select().from(metadata).where(eq(metadata.seedLocalId, item.seedLocalId!))
  for (const row of rows) {
    await db
      .update(metadata)
      .set({ uid: randomUid(), seedUid, versionUid, attestationCreatedAt: attestedAt, createdAt: attestedAt })
      .where(eq(metadata.localId, row.localId!))
  }
  item.getService().send({ type: 'updateContext', seedUid, latestVersionUid: versionUid })
  const attested = await db.select().from(metadata).where(eq(metadata.seedLocalId, item.seedLocalId!))
  for (const property of item.properties) {
    const row = attested.find((r) => r.localId === property.localId)
    if (row) property.getService().send({ type: 'updateContext', uid: row.uid, versionUid })
  }
}

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

  it('restores the published value over a draft that holds an edit', async () => {
    const { postItem } = await createItemWithList({ tagLabels: ['x'] })
    await markPublished(postItem)
    const title = propertyOf(postItem, 'title')
    const publishedValue = title.value

    await setAndSave(title, 'draft edit')
    // A context still naming the published row (the bug this file covers, or another tab's edit).
    const [published] = (await rowsFor(postItem.seedLocalId!, 'title')).filter((r) => r.uid)
    title.getService().send({ type: 'updateContext', localId: published!.localId, uid: published!.uid })

    await setAndSave(title, publishedValue)

    const drafts = (await rowsFor(postItem.seedLocalId!, 'title')).filter((r) => !r.uid)
    expect(drafts.map((r) => r.propertyValue)).toEqual([publishedValue])
  }, 60_000)

  it('patch Publish attests a draft row the property context missed', async () => {
    const { postItem } = await createItemWithList({ tagLabels: ['x'] })
    await markPublished(postItem)
    const title = propertyOf(postItem, 'title')

    await setAndSave(title, 'edited elsewhere')
    const [published] = (await rowsFor(postItem.seedLocalId!, 'title')).filter((r) => r.uid)
    title.getService().send({ type: 'updateContext', localId: published!.localId, uid: published!.uid })

    expect(await attestedNames(postItem)).toContain('title')
    const { context } = title.getService().getSnapshot()
    expect(context.uid).toBeUndefined()
    expect(context.localId).not.toBe(published!.localId)
  }, 60_000)
})
