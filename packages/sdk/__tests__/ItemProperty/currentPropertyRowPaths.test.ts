import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { Item } from '@/Item/Item'
import { ItemProperty } from '@/ItemProperty/ItemProperty'
import { BaseDb } from '@/db/Db/BaseDb'
import { metadata } from '@/seedSchema/MetadataSchema'
import { generateId } from '@/helpers/generateId'
import { waitForEntityIdle } from '@/helpers/waitForEntityIdle'
import { currentPropertyRow, currentPropertyRows } from '@/db/read/currentPropertyRow'
import { getItemProperties } from '@/db/read/getItemProperties'
import { getPublishPendingDiff } from '@/db/read/getPublishPendingDiff'
import { appendOutboxOp, startItemOutbox, waitForOutboxOp } from '@/outbox'
import { pauseOutboxDrainForTests } from '@/outbox/outbox'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'
import {
  createGetPublishPayloadTestSchema,
  createPublishedTestAuthor,
  waitForPropertyInstances,
} from '../test-utils/getPublishPayloadIntegrationHelpers'
import { WAIT_TIMEOUT_MS } from '../test-utils/timeouts'

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe.skip

/**
 * Every reader of "the row that holds this property's value" goes through currentPropertyRow
 * (sdk-audit T5). With a published row, a newer draft, an older row with no property_id and a
 * pending outbox op, they all report the same row and value.
 */
testDescribe('current property row', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    await createGetPublishPayloadTestSchema()
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  afterEach(() => {
    pauseOutboxDrainForTests(false)
  })

  const titleRows = (seedLocalId: string) =>
    BaseDb.getAppDb()!
      .select()
      .from(metadata)
      .where(and(eq(metadata.seedLocalId, seedLocalId), eq(metadata.propertyName, 'title')))

  /** A post whose title has a published row, a newer draft and an older row with no property_id. */
  const createPostWithHistory = async () => {
    const author = await createPublishedTestAuthor()
    const item = await Item.create({ modelName: 'Post', title: 'published v1', author: author.seedLocalId } as any)
    await waitForEntityIdle(item, { timeout: WAIT_TIMEOUT_MS })
    await waitForPropertyInstances(item)
    const seedLocalId = item.seedLocalId!
    const db = BaseDb.getAppDb()!

    const [first] = await titleRows(seedLocalId)
    const publishedAt = Date.now() - 60_000
    await db
      .update(metadata)
      .set({ uid: `0x${'1a'.repeat(32)}`, attestationCreatedAt: publishedAt, createdAt: publishedAt })
      .where(eq(metadata.localId, first.localId!))
    await db.insert(metadata).values({
      localId: generateId(),
      seedLocalId,
      propertyName: 'title',
      propertyValue: 'older, unlinked',
      versionLocalId: first.versionLocalId,
      createdAt: publishedAt - 60_000,
    })

    const title = item.allProperties['title']!
    title.value = 'draft v2'
    await title.save()
    const draft = (await titleRows(seedLocalId)).find((row) => row.propertyValue === 'draft v2')!
    expect(draft.uid).toBeFalsy()
    return { item, seedLocalId, draft }
  }

  /** The value and row every reader reports for the post's title. */
  const readAll = async (item: Item<any>, seedLocalId: string) => {
    const seed = { seedLocalId }
    const one = await currentPropertyRow(seed, { propertyName: 'title', modelName: 'Post' })
    const all = (await currentPropertyRows(seed)).find((row) => row.propertyKey === 'title')
    const listed = (await getItemProperties({ seedLocalId })).find((row) => row.propertyName === 'title')
    const diff = (await getPublishPendingDiff({ seedLocalId })).pendingProperties.find(
      (entry) => entry.propertyName === 'title',
    )

    // A fresh instance: loadOrCreateProperty, then (Node) the watch's initial read
    const loadedBefore = item.allProperties['title']!
    item.unload()
    for (let i = 0; i < 20 && loadedBefore.getService().getSnapshot().status !== 'stopped'; i++) loadedBefore.unload()
    const loaded = (await ItemProperty.find({ seedLocalId, propertyName: 'title', modelName: 'Post' }))!
    await waitForEntityIdle(loaded, { timeout: WAIT_TIMEOUT_MS })
    const loadedValue = loaded.value
    const loadedLocalId = loaded.localId

    // hydrateFromDb, from a context that says otherwise
    loaded.getService().send({ type: 'updateContext', propertyValue: 'stale', renderValue: 'stale' })
    loaded.getService().send({ type: 'rehydrateFromDb' })
    await vi.waitFor(() => expect(loaded.value).not.toBe('stale'), { timeout: WAIT_TIMEOUT_MS })
    await waitForEntityIdle(loaded, { timeout: WAIT_TIMEOUT_MS })

    return {
      values: {
        currentPropertyRow: one?.propertyValue,
        currentPropertyRows: all?.propertyValue,
        getItemProperties: listed?.propertyValue,
        getPublishPendingDiff: diff?.currentValue,
        load: loadedValue,
        rehydrate: loaded.value,
      },
      localIds: {
        currentPropertyRow: one?.localId,
        currentPropertyRows: all?.localId,
        getItemProperties: listed?.localId,
        load: loadedLocalId,
        rehydrate: loaded.localId,
      },
    }
  }

  const each = <T,>(value: T, keys: string[]) => Object.fromEntries(keys.map((key) => [key, value]))

  it('reads the newest row, not the published one or the unlinked older one', async () => {
    const { item, seedLocalId, draft } = await createPostWithHistory()
    const { values, localIds } = await readAll(item, seedLocalId)
    expect(values).toEqual(each('draft v2', Object.keys(values)))
    expect(localIds).toEqual(each(draft.localId, Object.keys(localIds)))
  }, 60000)

  it('reads a pending outbox value over the stored row, and the stored row without the overlay', async () => {
    const { item, seedLocalId, draft } = await createPostWithHistory()
    startItemOutbox()
    pauseOutboxDrainForTests(true)
    const opId = await appendOutboxOp({
      seedLocalId,
      propertyName: 'title',
      kind: 'set',
      value: { newValue: 'pending v3', localId: draft.localId, modelName: 'Post', dataType: 'Text' },
    })

    const { values, localIds } = await readAll(item, seedLocalId)
    expect(values).toEqual(each('pending v3', Object.keys(values)))
    // The overlay is on the stored row: same row, no attestation
    expect(localIds).toEqual(each(draft.localId, Object.keys(localIds)))
    const overlaid = await currentPropertyRow({ seedLocalId }, { propertyName: 'title', modelName: 'Post' })
    expect(overlaid).toMatchObject({ overlaid: true, uid: null })

    const stored = await currentPropertyRow({ seedLocalId }, { propertyName: 'title', modelName: 'Post' }, { overlay: false })
    expect(stored).toMatchObject({ propertyValue: 'draft v2', localId: draft.localId, overlaid: false })

    pauseOutboxDrainForTests(false)
    await waitForOutboxOp(opId)
    const applied = await currentPropertyRow({ seedLocalId }, { propertyName: 'title', modelName: 'Post' })
    expect(applied).toMatchObject({ propertyValue: 'pending v3', overlaid: false })
  }, 60000)
})
