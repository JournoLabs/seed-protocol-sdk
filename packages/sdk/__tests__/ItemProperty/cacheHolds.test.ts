import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Item } from '@/Item/Item'
import { ItemProperty } from '@/ItemProperty/ItemProperty'
import { importJsonSchema } from '@/imports/json'
import { generateId } from '@/helpers'
import type { SchemaFileFormat } from '@/types/import'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'

/**
 * ItemProperty operations that look up their item must not take a hold on it. A property known by
 * its item's local id and seed uid is cached under both, as one entry with one hold count.
 */

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe
const SCHEMA_NAME = 'Test Schema ItemProperty Cache Holds'

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
          related: { id: generateId(), type: 'Relation', model: 'HoldPost' },
        },
      },
    },
    enums: {},
    migrations: [],
  } as SchemaFileFormat
}

testDescribe('ItemProperty cache holds', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    const file = schemaFile()
    await importJsonSchema({ contents: JSON.stringify(file) }, file.version)
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  const createPost = (title: string) =>
    Item.create({ modelName: 'HoldPost', schemaName: SCHEMA_NAME, title } as never)

  it('destroy takes no hold on the item', async () => {
    const item = await createPost('destroy')
    const property = await ItemProperty.find({ propertyName: 'title', seedLocalId: item.seedLocalId })
    expect(property).toBeDefined()

    await property!.destroy()

    item.unload()
    expect(item.getService().getSnapshot().status).toBe('stopped')
  }, 30000)

  it('a property released under its seed uid is not handed out stopped under its local id', async () => {
    const item = await createPost('two keys')
    const seedLocalId = item.seedLocalId
    const seedUid = '0x' + 'cd'.repeat(32)
    // Known by both ids: cached under both keys, as one entry
    const byBoth = ItemProperty.create(
      { propertyName: 'title', seedLocalId, seedUid, modelName: 'HoldPost' } as never,
      { waitForReady: false },
    )!
    const byUid = await ItemProperty.find({ propertyName: 'title', seedUid })
    expect(byUid).toBe(byBoth)

    for (let i = 0; i < 20 && byBoth.getService().getSnapshot().status !== 'stopped'; i++) byBoth.unload()
    expect(byBoth.getService().getSnapshot().status).toBe('stopped')

    const byLocalId = await ItemProperty.find({ propertyName: 'title', seedLocalId })
    expect(byLocalId).toBeDefined()
    expect(byLocalId!.getService().getSnapshot().status).not.toBe('stopped')
    item.unload()
  }, 30000)

  it('finds a property cached under its local id when the item has a seed uid too', async () => {
    const other = await createPost('related')
    const item = await Item.create({
      modelName: 'HoldPost',
      schemaName: SCHEMA_NAME,
      title: 'with relation',
      related: other.seedLocalId,
    } as never)
    const related = item.properties.find((p) => p.propertyName === 'related')!
    expect(related).toBeDefined()
    // Published after the item made its instances: they're cached under the local id only. The
    // row stores the name `relatedId`, so a miss would build a second instance under that name.
    const seedUid = '0x' + 'ef'.repeat(32)

    const found = await ItemProperty.find({
      propertyName: 'related',
      seedLocalId: item.seedLocalId,
      seedUid,
      hold: false,
    })
    expect(found?.getService()).toBe(related.getService())
    const byUid = await ItemProperty.find({ propertyName: 'related', seedUid, hold: false })
    expect(byUid?.getService()).toBe(related.getService())
    item.unload()
    other.unload()
  }, 30000)

  it('finds a property made while its row was read, not a second one under the stored name', async () => {
    const other = await createPost('related, raced')
    const item = await Item.create({
      modelName: 'HoldPost',
      schemaName: SCHEMA_NAME,
      title: 'with relation, raced',
      related: other.seedLocalId,
    } as never)
    const seedLocalId = item.seedLocalId
    item.unload()
    expect(ItemProperty.cache.peek(ItemProperty.cacheKey(seedLocalId!, 'related'))).toBeUndefined()

    // find misses the cache before its first await; the item makes the instance meanwhile
    const finding = ItemProperty.find({ propertyName: 'related', seedLocalId, hold: false })
    const made = ItemProperty.create(
      { propertyName: 'related', seedLocalId, modelName: 'HoldPost' } as never,
      { waitForReady: false },
    )!

    expect((await finding)?.getService()).toBe(made.getService())
    made.unload()
    other.unload()
  }, 30000)

  it('a held property dropped with its item stays out of the cache when its context changes', async () => {
    const item = await createPost('dropped')
    const seedLocalId = item.seedLocalId
    const held = await ItemProperty.find({ propertyName: 'title', seedLocalId })
    expect(held).toBeDefined()

    Item.dropCachedInstancesForSeedIds([seedLocalId])
    expect(ItemProperty.cache.peek(ItemProperty.cacheKey(seedLocalId, 'title'))).toBeUndefined()

    // Its live query or a save can still update the held instance after the drop
    held!.getService().send({ type: 'updateContext', renderValue: 'changed after drop' })
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(ItemProperty.cache.peek(ItemProperty.cacheKey(seedLocalId, 'title'))).toBeUndefined()

    const reloaded = await ItemProperty.find({ propertyName: 'title', seedLocalId })
    expect(reloaded).toBeDefined()
    expect(reloaded!.getService()).not.toBe(held!.getService())
    held!.unload()
    reloaded!.unload()
  }, 30000)
})
