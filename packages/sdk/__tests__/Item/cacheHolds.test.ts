import { describe, it, expect, beforeAll, afterAll } from 'vitest'
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
})
