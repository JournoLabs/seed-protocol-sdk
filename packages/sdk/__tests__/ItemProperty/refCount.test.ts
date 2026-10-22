import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Item } from '@/Item/Item'
import { ItemProperty } from '@/ItemProperty/ItemProperty'
import { importJsonSchema } from '@/imports/json'
import { generateId } from '@/helpers'
import type { SchemaFileFormat } from '@/types/import'
import type { IItemProperty } from '@/interfaces'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'
import { countChangeWatches } from '../test-utils/changeWatches'
import { waitUntilOrThrow } from '../test-utils/waitUntil'

/**
 * Who holds an ItemProperty: its Item holds each property in its map once, and every public
 * `find`/`create` call is one more hold for that caller. Releasing the Item and each find stops the
 * property. SDK lookups that feed the Item's map (its constructor, loadOrCreateItem, its change-feed
 * watch) take none of their own.
 *
 * The holds the Item's change-feed reads used to take only happen in the browser; the rest runs in both.
 */

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe
const isBrowser = typeof window !== 'undefined'
const SCHEMA_NAME = 'Test Schema ItemProperty RefCount'

function schemaFile(): SchemaFileFormat {
  const now = new Date().toISOString()
  return {
    $schema: 'https://seedprotocol.org/schemas/data-model/v1',
    version: 1,
    id: generateId(),
    metadata: { name: SCHEMA_NAME, createdAt: now, updatedAt: now },
    models: {
      RefCountPost: {
        id: generateId(),
        properties: {
          title: { id: generateId(), type: 'Text' },
          summary: { id: generateId(), type: 'Text' },
        },
      },
    },
    enums: {},
    migrations: [],
  } as SchemaFileFormat
}

/** The cache entry holding this instance (one entry, shared by all its keys), if any. */
const entryFor = (property: IItemProperty<any>) => ItemProperty.cache.entryOf(property as ItemProperty<any>)

const status = (property: IItemProperty<any>) => property.getService().getSnapshot().status

/** Lets pending async subscribers (the constructor's cache re-keying awaits an import) run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

testDescribe('ItemProperty refCount', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    const file = schemaFile()
    await importJsonSchema({ contents: JSON.stringify(file) }, file.version)
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  /** Creates an item and, in the browser, waits until its watch setup (which looks up every property) is done. */
  const createPost = async (title: string) => {
    const item = await Item.create({ modelName: 'RefCountPost', schemaName: SCHEMA_NAME, title } as never)
    if (isBrowser) {
      // The item watches its seeds row after looking up its properties' metadata
      await waitUntilOrThrow(
        () => countChangeWatches({ seedLocalId: item.seedLocalId, table: 'seeds' }) > 0,
        "the item's seeds watch to be registered",
      )
    }
    await settle()
    return item
  }

  const itemProperty = (item: Item<any>, propertyName: string): IItemProperty<any> => {
    const instances = item.getService().getSnapshot().context.propertyInstances as Map<string, IItemProperty<any>>
    const property = instances.get(propertyName)
    expect(property, `item has a ${propertyName} property`).toBeDefined()
    return property!
  }

  it('the item holds each property once', async () => {
    const item = await createPost('item hold')

    for (const name of ['title', 'summary']) {
      expect(entryFor(itemProperty(item, name))?.refCount).toBe(1)
    }

    item.unload()
  }, 30000)

  it('item.unload() and one unload per find bring refCount to 0 and stop the property', async () => {
    const item = await createPost('find holds')
    const first = await ItemProperty.find({ propertyName: 'title', seedLocalId: item.seedLocalId })
    const second = await ItemProperty.find({ propertyName: 'title', seedLocalId: item.seedLocalId })
    expect(first).toBeDefined()
    expect(second?.getService()).toBe(first!.getService())
    const entry = entryFor(first!)
    expect(entry?.refCount).toBe(3)

    item.unload()
    expect(entry!.refCount).toBe(2)
    expect(status(first!)).toBe('active')

    first!.unload()
    expect(entry!.refCount).toBe(1)
    expect(status(first!)).toBe('active')

    second!.unload()
    expect(entry!.refCount).toBe(0)
    expect(status(first!)).toBe('stopped')

    await settle()
    expect(entryFor(first!), 'no cache key points at the stopped instance').toBeUndefined()
    if (isBrowser) {
      expect(countChangeWatches({ seedLocalId: item.seedLocalId, table: 'metadata', propertyName: 'title' })).toBe(0)
    }
  }, 30000)

  it('item.unload() stops the properties nobody else holds', async () => {
    const item = await createPost('item only')
    const title = itemProperty(item, 'title')
    const summary = itemProperty(item, 'summary')

    item.unload()

    expect(status(title)).toBe('stopped')
    expect(status(summary)).toBe('stopped')
    await settle()
    expect(entryFor(title)).toBeUndefined()
    expect(entryFor(summary)).toBeUndefined()
  }, 30000)

  it('a find kept past item.unload() keeps the property running until it is released', async () => {
    const item = await createPost('find outlives item')
    const title = await ItemProperty.find({ propertyName: 'title', seedLocalId: item.seedLocalId })
    const summary = itemProperty(item, 'summary')

    item.unload()

    expect(status(title!)).toBe('active')
    expect(title!.value).toBe('find outlives item')
    expect(status(summary)).toBe('stopped')

    title!.unload()
    expect(status(title!)).toBe('stopped')
  }, 30000)
})
