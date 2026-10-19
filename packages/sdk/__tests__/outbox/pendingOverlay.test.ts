import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { pendingWrites } from '@/seedSchema'
import { Item } from '@/Item/Item'
import { ItemProperty } from '@/ItemProperty/ItemProperty'
import { importJsonSchema } from '@/imports/json'
import { generateId } from '@/helpers'
import { getItemProperties } from '@/db/read/getItemProperties'
import { getItemData } from '@/db/read/getItemData'
import { startItemOutbox } from '@/outbox'
import { outboxIdleForTests, pauseOutboxDrainForTests } from '@/outbox/outbox'
import type { SchemaFileFormat } from '@/types/import'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'
import { waitForIdle } from '../test-utils/waitForIdle'
import { waitForPropertyInstances } from '../test-utils/getPublishPayloadIntegrationHelpers'

/**
 * The read overlay (ADR 0019): readers that build item values show a value whose outbox op hasn't
 * applied yet, for plain values in item lists and for Html and ItemStorage values after a reload.
 */

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe.sequential
const SCHEMA_NAME = 'Test Schema Outbox Pending Overlay'
const MODEL = 'OverlayPost'

function schemaFile(): SchemaFileFormat {
  const now = new Date().toISOString()
  return {
    $schema: 'https://seedprotocol.org/schemas/data-model/v1',
    version: 1,
    id: generateId(),
    metadata: { name: SCHEMA_NAME, createdAt: now, updatedAt: now },
    models: {
      [MODEL]: {
        id: generateId(),
        properties: {
          title: { id: generateId(), type: 'Text' },
          summary: { id: generateId(), type: 'Text' },
          html: { id: generateId(), type: 'Html' },
          notes: { id: generateId(), type: 'Text', storage: { type: 'ItemStorage', path: '/notes', extension: '.md' } },
        },
      },
    },
    enums: {},
    migrations: [],
  } as SchemaFileFormat
}

testDescribe('read overlay for pending values', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    const file = schemaFile()
    await importJsonSchema({ contents: JSON.stringify(file) }, file.version)
    startItemOutbox()
  }, SETUP_HOOK_TIMEOUT_MS)

  afterEach(async () => {
    pauseOutboxDrainForTests(false)
    await outboxIdleForTests()
  })

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  const createPost = async (values: Record<string, unknown> = {}) => {
    const post = (await Item.create({ modelName: MODEL, schemaName: SCHEMA_NAME, title: 'stored', ...values } as never)) as Item<any>
    await waitForIdle(post, 'Item', 15000)
    await waitForPropertyInstances(post)
    return post
  }
  const propertyOf = (post: Item<any>, name: string) =>
    post.properties.find((p) => p.propertyName === name || p.propertyName === `${name}Id`)!
  const pendingOp = async (seedLocalId: string, kind: string) => {
    await vi.waitFor(
      async () => {
        const ops = await BaseDb.getAppDb()
          .select()
          .from(pendingWrites)
          .where(
            and(
              eq(pendingWrites.seedLocalId, seedLocalId),
              eq(pendingWrites.kind, kind),
              eq(pendingWrites.status, 'pending'),
            ),
          )
        expect(ops).toHaveLength(1)
      },
      { timeout: 10000 },
    )
  }
  /** A reload: the cached instances go, the ops stay in the table. */
  const reload = async (seedLocalId: string) => {
    Item.dropCachedInstancesForSeedIds([seedLocalId])
    ItemProperty.clearInstanceCacheForItem(seedLocalId)
    const reloaded = (await Item.find({ seedLocalId })) as Item<any>
    await waitForPropertyInstances(reloaded)
    return reloaded
  }

  it('item property lists show a pending value as an edit, including a property with no row yet', async () => {
    const post = await createPost()
    pauseOutboxDrainForTests(true)
    propertyOf(post, 'title').value = 'pending title'
    await pendingOp(post.seedLocalId, 'set')
    propertyOf(post, 'summary').value = 'pending summary'
    await vi.waitFor(async () => {
      const values = Object.fromEntries(
        (await getItemProperties({ seedLocalId: post.seedLocalId })).map((p) => [p.propertyName, p.propertyValue]),
      )
      expect(values.title).toBe('pending title')
      expect(values.summary).toBe('pending summary')
    })

    const edited = (await getItemProperties({ seedLocalId: post.seedLocalId, edited: true })).map((p) => p.propertyName)
    expect(edited).toEqual(expect.arrayContaining(['title', 'summary']))
    const itemData = await getItemData({ seedLocalId: post.seedLocalId })
    expect(itemData?.title).toBe('pending title')
    post.unload()
  }, 30000)

  it('an Html value whose op is pending shows after a reload', async () => {
    const post = await createPost()
    pauseOutboxDrainForTests(true)
    propertyOf(post, 'html').value = '<p>pending html</p>'
    await pendingOp(post.seedLocalId, 'storage')

    const reloaded = await reload(post.seedLocalId)
    await vi.waitFor(() => expect(propertyOf(reloaded, 'html').value).toBe('<p>pending html</p>'), { timeout: 10000 })
    reloaded.unload()
  }, 30000)

  it('an ItemStorage value whose op is pending shows after a reload, read from its staged file', async () => {
    const post = await createPost({ notes: 'stored notes' })
    pauseOutboxDrainForTests(true)
    propertyOf(post, 'notes').value = 'pending notes'
    await pendingOp(post.seedLocalId, 'storage')

    const reloaded = await reload(post.seedLocalId)
    await vi.waitFor(() => expect(propertyOf(reloaded, 'notes').value).toBe('pending notes'), { timeout: 10000 })

    pauseOutboxDrainForTests(false)
    await outboxIdleForTests()
    await vi.waitFor(() => expect(propertyOf(reloaded, 'notes').value).toBe('pending notes'))
    reloaded.unload()
  }, 30000)
})
