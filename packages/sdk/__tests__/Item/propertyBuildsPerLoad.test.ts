import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { Model } from '@/Model/Model'
import { Item } from '@/Item/Item'
import { ItemProperty } from '@/ItemProperty/ItemProperty'
import { createNewItem } from '@/db/write/createNewItem'
import { importJsonSchema } from '@/imports/json'
import { generateId } from '@/helpers'
import type { SchemaFileFormat } from '@/types/import'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'
import { WAIT_TIMEOUT_MS } from '../test-utils/timeouts'

/**
 * Loading an item builds each of its property instances once (G08-2). Before, the constructor, the
 * load and the change feed's first read each looked every property up: about three lookups (and
 * metadata reads) per property per load.
 */
const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe.sequential

const schemaName = 'Property Builds Per Load'
const testSchema: SchemaFileFormat = {
  $schema: 'https://seedprotocol.io/schemas/data-model/v1',
  version: 1,
  id: 'property-builds-per-load',
  metadata: { name: schemaName, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  models: {
    BuildNote: {
      id: generateId(),
      properties: {
        title: { id: generateId(), type: 'Text' },
        count: { id: generateId(), type: 'Number' },
        summary: { id: generateId(), type: 'Text' },
      },
    },
  },
  enums: {},
  migrations: [],
}

testDescribe('Item load', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
    const model = Model.create('BuildNote', schemaName, { waitForReady: false })
    await model.waitForReady({ timeout: WAIT_TIMEOUT_MS })
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    vi.restoreAllMocks()
    await teardownTestEnvironment()
  })

  it('looks each property up once', async () => {
    const { seedLocalId } = await createNewItem({ modelName: 'BuildNote', title: 'Once', count: 2, summary: 's' } as never)
    const create = vi.spyOn(ItemProperty, 'create')
    const find = vi.spyOn(ItemProperty, 'find')

    const item = (await Item.find({ modelName: 'BuildNote', seedLocalId })) as Item<any> | undefined
    try {
      expect(item?.status).toBe('ready')
      // The change feed's first read runs after the load: give it time to (not) look them up again
      await new Promise((resolve) => setTimeout(resolve, 300))
      const lookups = create.mock.calls.length + find.mock.calls.length
      expect(item!.properties.length).toBe(3)
      expect(lookups).toBeLessThanOrEqual(3)
    } finally {
      create.mockRestore()
      find.mockRestore()
      item?.unload()
    }
  })
})
