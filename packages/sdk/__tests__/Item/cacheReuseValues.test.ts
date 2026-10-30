import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Item } from '@/Item/Item'
import { getItemData } from '@/db/read/getItemData'
import { importJsonSchema } from '@/imports/json'
import { generateId } from '@/helpers'
import type { SchemaFileFormat } from '@/types/import'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'
import { waitForItemPropertyIdle } from '../test-utils/waitForIdle'

/**
 * Loading an item from its stored data (getItemData, then Item.create, as publish once did for
 * related items) passes the row's property values to Item.create. When the item is already cached, Item.create returns the cached
 * instance and sends those stored values to its properties as `propertyValue`. The values the item
 * shows must not change: not decoded falsy values, and not a cleared value whose save is in flight.
 * These pass today (the getter prefers `renderValue`) and guard the cache-reuse path in a refactor.
 */

/** Item.create from the item's stored data. */
const loadFromRows = async (seedLocalId: string) => Item.create((await getItemData({ seedLocalId }))! as any)

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe
const SCHEMA_NAME = 'Test Schema Item Cache Reuse Values'

function schemaFile(): SchemaFileFormat {
  const now = new Date().toISOString()
  return {
    $schema: 'https://seedprotocol.io/schemas/data-model/v1',
    version: 1,
    id: generateId(),
    metadata: { name: SCHEMA_NAME, createdAt: now, updatedAt: now },
    models: {
      ReusePost: {
        id: generateId(),
        properties: {
          title: { id: generateId(), type: 'Text' },
          count: { id: generateId(), type: 'Number' },
          isPublished: { id: generateId(), type: 'Boolean' },
        },
      },
    },
    enums: {},
    migrations: [],
  } as SchemaFileFormat
}

type ReusePost = Item<any> & { title: unknown; count: unknown; isPublished: unknown }

testDescribe('Item.create on a cached item keeps its property values', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    const file = schemaFile()
    await importJsonSchema({ contents: JSON.stringify(file) }, file.version)
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  const createPost = async (values: Record<string, unknown>) =>
    (await Item.create({ modelName: 'ReusePost', schemaName: SCHEMA_NAME, ...values } as never)) as ReusePost

  const valuesOf = (item: ReusePost) => ({ title: item.title, count: item.count, isPublished: item.isPublished })

  it('loading from rows leaves falsy values (0, false) as they are', async () => {
    const item = await createPost({ title: 'zero and false', count: 0, isPublished: false })
    const before = valuesOf(item)

    const again = await loadFromRows(item.seedLocalId)

    expect(again).toBe(item)
    expect(valuesOf(item)).toEqual(before)
    item.unload()
    item.unload()
  }, 30000)

  it('loading from rows leaves truthy values as they are', async () => {
    const item = await createPost({ title: 'one and true', count: 1, isPublished: true })
    const before = valuesOf(item)

    await loadFromRows(item.seedLocalId)

    expect(valuesOf(item)).toEqual(before)
    item.unload()
    item.unload()
  }, 30000)

  it('loading from rows while a cleared value is still saving does not bring the old value back', async () => {
    const item = await createPost({ title: 'before clearing' })
    const title = item.properties.find((p) => p.propertyName === 'title')!

    item.title = ''
    await loadFromRows(item.seedLocalId)
    await waitForItemPropertyIdle(title)

    expect(item.title).toBe('')
    item.unload()
    item.unload()
  }, 30000)
})
