import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Item } from '@/Item/Item'
import { ItemProperty } from '@/ItemProperty/ItemProperty'
import { importJsonSchema } from '@/imports/json'
import { generateId } from '@/helpers'
import type { SchemaFileFormat } from '@/types/import'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'

/**
 * ItemProperty operations that look up their item must not take a hold on it.
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
        properties: { title: { id: generateId(), type: 'Text' } },
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
})
