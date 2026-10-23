import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { Item } from '@/Item/Item'
import { setEntityUnloadGraceMs } from '@/helpers/entity/entityCache'
import { EntityUnloadedError, evictEntities } from '@/helpers/entity/entityLifecycle'
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

  it('find loads the item without holding it', async () => {
    const created = await Item.create({ modelName: 'HoldPost', schemaName: SCHEMA_NAME, title: 'no hold' } as never)
    const id = created.seedLocalId
    Item.dropCachedInstancesForSeedIds([id])

    const found = await Item.find({ seedLocalId: id })
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

      expect(await Item.find({ seedLocalId: id, readyTimeout: 1, hold: true })).toBeUndefined()
      expect(Item.cache.entryOf(loading)?.refCount).toBe(1)
      finishLoad()
      await loading.waitForReady()
      loading.unload()
    } finally {
      finishLoad()
      spy.mockRestore()
    }
  }, 30000)

  it('all lists the items without holding them', async () => {
    const created = await Item.create({ modelName: 'HoldPost', schemaName: SCHEMA_NAME, title: 'listed' } as never)
    const id = created.seedLocalId
    created.unload()
    const refCount = (item: Item<any>) => Item.cache.entryOf(item)?.refCount

    const listed = await Item.all('HoldPost', false, {
      schemaName: SCHEMA_NAME,
      includeEas: true,
      addressFilter: 'all',
      waitForReady: true,
    })
    const item = listed.find((i) => i.seedLocalId === id)
    expect(item).toBeDefined()
    expect(item).not.toBe(created)
    expect(refCount(item!)).toBe(0)

    // hold: true holds each item once
    const held = await Item.all('HoldPost', false, { schemaName: SCHEMA_NAME, waitForReady: true, hold: true })
    expect(held).toContain(item)
    expect(refCount(item!)).toBe(1)
    for (const i of held) i.unload()
    expect(item!.getService().getSnapshot().status).toBe('stopped')
  }, 30000)

  it('all keeps no holds when an item is not ready in time', async () => {
    const created = await Item.create({ modelName: 'HoldPost', schemaName: SCHEMA_NAME, title: 'slow list' } as never)
    const id = created.seedLocalId
    Item.dropCachedInstancesForSeedIds([id])
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

      await expect(
        Item.all('HoldPost', false, { schemaName: SCHEMA_NAME, waitForReady: true, readyTimeout: 1, hold: true }),
      ).rejects.toThrow()
      expect(Item.cache.entryOf(loading)?.refCount).toBe(1)
      finishLoad()
      await loading.waitForReady()
      loading.unload()
    } finally {
      finishLoad()
      spy.mockRestore()
    }
  }, 30000)

  it('unload on an instance no one holds does nothing', async () => {
    const created = await Item.create({ modelName: 'HoldPost', schemaName: SCHEMA_NAME, title: 'never held' } as never)
    const id = created.seedLocalId
    Item.dropCachedInstancesForSeedIds([id])
    const found = (await Item.find({ seedLocalId: id })) as Item<any>
    expect(Item.cache.entryOf(found)?.refCount).toBe(0)

    found.unload()
    expect(found.getService().getSnapshot().status).toBe('active')
    expect(Item.cache.entryOf(found)?.refCount).toBe(0)
    Item.dropCachedInstancesForSeedIds([id])
  }, 30000)

  it('writes and publish on an unloaded item throw, naming it', async () => {
    const created = await Item.create({ modelName: 'HoldPost', schemaName: SCHEMA_NAME, title: 'gone' } as never)
    const id = created.seedLocalId
    const title = created.properties.find((p) => p.propertyName === 'title')!
    created.unload()
    expect(created.getService().getSnapshot().status).toBe('stopped')

    expect(() => {
      ;(created as any).title = 'after unload'
    }).toThrow(EntityUnloadedError)
    expect(() => {
      ;(created as any).title = 'after unload'
    }).toThrow(id)
    await expect(created.publish()).rejects.toThrow(EntityUnloadedError)
    expect(() => title.setValue('after unload')).toThrow(EntityUnloadedError)
    await expect(title.save()).rejects.toThrow(id)
    // Reads keep the last values
    expect((created as any).title).toBe('gone')
  }, 30000)

  describe('grace period', () => {
    const GRACE_MS = 300
    const pastGrace = () => new Promise((resolve) => setTimeout(resolve, GRACE_MS + 200))
    afterEach(() => setEntityUnloadGraceMs(undefined))

    it('keeps the same instance when a hold is taken within the grace period', async () => {
      setEntityUnloadGraceMs(GRACE_MS)
      const created = await Item.create({ modelName: 'HoldPost', schemaName: SCHEMA_NAME, title: 'graced' } as never)
      const id = created.seedLocalId
      created.unload()
      expect(created.getService().getSnapshot().status).toBe('active')

      // Found cached, not reloaded
      const loadSpy = vi.spyOn(Item as unknown as { load: () => Promise<void> }, 'load')
      try {
        const found = await Item.find({ seedLocalId: id, hold: true })
        expect(found).toBe(created)
        expect(loadSpy).not.toHaveBeenCalled()
      } finally {
        loadSpy.mockRestore()
      }
      await pastGrace()
      expect(created.getService().getSnapshot().status).toBe('active')
      expect(Item.peek(id)).toBe(created)

      created.unload()
      await pastGrace()
      expect(created.getService().getSnapshot().status).toBe('stopped')
      expect(Item.peek(id)).toBeUndefined()
    }, 30000)

    it('unloads an item looked up without a hold after the grace period', async () => {
      setEntityUnloadGraceMs(GRACE_MS)
      const created = await Item.create({ modelName: 'HoldPost', schemaName: SCHEMA_NAME, title: 'looked up' } as never)
      const id = created.seedLocalId
      Item.dropCachedInstancesForSeedIds([id])

      const found = (await Item.find({ seedLocalId: id })) as Item<any>
      expect(found.getService().getSnapshot().status).toBe('active')
      await pastGrace()
      expect(found.getService().getSnapshot().status).toBe('stopped')
      expect(Item.peek(id)).toBeUndefined()
    }, 30000)

    it('drops, eviction and destroy unload at once', async () => {
      setEntityUnloadGraceMs(60_000)
      const dropped = await Item.create({ modelName: 'HoldPost', schemaName: SCHEMA_NAME, title: 'dropped' } as never)
      dropped.unload()
      expect(dropped.getService().getSnapshot().status).toBe('active')
      Item.dropCachedInstancesForSeedIds([dropped.seedLocalId])
      expect(dropped.getService().getSnapshot().status).toBe('stopped')

      const evicted = await Item.create({ modelName: 'HoldPost', schemaName: SCHEMA_NAME, title: 'evicted' } as never)
      evicted.unload()
      evictEntities(Item.cache, (item) => item === evicted)
      expect(evicted.getService().getSnapshot().status).toBe('stopped')

      const destroyed = await Item.create({ modelName: 'HoldPost', schemaName: SCHEMA_NAME, title: 'destroyed' } as never)
      await destroyed.destroy()
      expect(destroyed.getService().getSnapshot().status).toBe('stopped')
      expect(Item.peek(destroyed.seedLocalId)).toBeUndefined()
    }, 30000)
  })
})
