import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { Item } from '@/Item/Item'
import { importJsonSchema } from '@/imports/json'
import { generateId } from '@/helpers'
import type { SchemaFileFormat } from '@/types/import'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'

/**
 * Every Item.create / Item.find / Item.getById caller holds the cached instance once and releases
 * it with one unload. SDK code that only looks an item up, without handing it to a caller, must not
 * take a hold: one it never releases keeps the item running after its real holders unload it.
 */

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe
const SCHEMA_NAME = 'Test Schema Item Cache Holds'
const PUBLISHER = '0x' + 'a'.repeat(40)

function schemaFile(): SchemaFileFormat {
  const now = new Date().toISOString()
  return {
    $schema: 'https://seedprotocol.org/schemas/data-model/v1',
    version: 1,
    id: generateId(),
    metadata: { name: SCHEMA_NAME, createdAt: now, updatedAt: now },
    models: {
      HoldPost: {
        id: generateId(),
        properties: {
          title: { id: generateId(), type: 'Text' },
        },
      },
    },
    enums: {},
    migrations: [],
  } as SchemaFileFormat
}

testDescribe('Item cache holds', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    const file = schemaFile()
    await importJsonSchema({ contents: JSON.stringify(file) }, file.version)
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it('setPublisherForCachedSeeds sets the publisher without taking a hold', async () => {
    const item = await Item.create({ modelName: 'HoldPost', schemaName: SCHEMA_NAME, title: 'held once' } as never)

    Item.setPublisherForCachedSeeds([item.seedLocalId], PUBLISHER)
    expect(item.publisher?.toLowerCase()).toBe(PUBLISHER)

    // The create was the only hold, so its unload stops the item.
    item.unload()
    expect(item.getService().getSnapshot().status).toBe('stopped')
    expect(Item.peekReady(item.seedLocalId)).toBeUndefined()
  }, 30000)

  it('find with hold: false loads the item without holding it', async () => {
    const created = await Item.create({ modelName: 'HoldPost', schemaName: SCHEMA_NAME, title: 'no hold' } as never)
    const id = created.seedLocalId
    Item.dropCachedInstancesForSeedIds([id])

    const found = await Item.find({ seedLocalId: id, hold: false })
    expect(found).toBeDefined()
    expect(Item.cache.entryOf(found as Item<any>)?.refCount).toBe(0)
    // A cached one too
    expect(await Item.find({ seedLocalId: id, hold: false })).toBe(found)
    expect(Item.cache.entryOf(found as Item<any>)?.refCount).toBe(0)

    expect(Item.retain(found!)).toBe(true)
    found!.unload()
    expect(found!.getService().getSnapshot().status).toBe('stopped')
    expect(Item.retain(found!)).toBe(false)
  }, 30000)

  it('find keeps no hold when the item is not ready in time', async () => {
    const created = await Item.create({ modelName: 'HoldPost', schemaName: SCHEMA_NAME, title: 'slow' } as never)
    const id = created.seedLocalId
    Item.dropCachedInstancesForSeedIds([id])
    // Cached and still loading (its load waits for `finishLoad`), held once by this create
    let finishLoad!: () => void
    const gate = new Promise<void>((resolve) => (finishLoad = resolve))
    const itemClass = Item as unknown as { load: (item: Item<any>) => Promise<void> }
    const load = itemClass.load.bind(Item)
    const spy = vi.spyOn(itemClass, 'load').mockImplementation(async (item) => {
      await gate
      return load(item)
    })
    try {
      const loading = await Item.create({ seedLocalId: id, modelName: 'HoldPost' } as never, { waitForReady: false })
      expect(loading.status).toBe('loading')

      expect(await Item.find({ seedLocalId: id, readyTimeout: 1 })).toBeUndefined()
      expect(Item.cache.entryOf(loading)?.refCount).toBe(1)
      finishLoad()
      await loading.waitForReady()
      loading.unload()
    } finally {
      finishLoad()
      spy.mockRestore()
    }
  }, 30000)
})
