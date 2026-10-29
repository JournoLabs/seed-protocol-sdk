import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Item } from '@/Item/Item'
import { importJsonSchema } from '@/imports/json'
import { generateId } from '@/helpers'
import { waitForEntityReady } from '@/helpers/entity/entityLifecycle'
import type { SchemaFileFormat } from '@/types/import'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'

/**
 * Decision D16: a model property assigned right after Item.create({ waitForReady: false }) is saved.
 * The first items of a process had no ItemProperty instances yet (Item's lazy Model import hadn't
 * resolved), so the assignment became a plain field on the item and was lost once they loaded.
 */
const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe
const SCHEMA_NAME = 'Test Schema Assign Before Load'

function schemaFile(): SchemaFileFormat {
  const now = new Date().toISOString()
  return {
    $schema: 'https://seedprotocol.io/schemas/data-model/v1',
    version: 1,
    id: generateId(),
    metadata: { name: SCHEMA_NAME, createdAt: now, updatedAt: now },
    models: {
      EarlyPost: {
        id: generateId(),
        properties: { title: { id: generateId(), type: 'Text' } },
      },
    },
    enums: {},
    migrations: [],
  } as SchemaFileFormat
}

testDescribe('assigning a property before the item has loaded it (D16)', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    const file = schemaFile()
    await importJsonSchema({ contents: JSON.stringify(file) }, file.version)
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it('keeps a value assigned before the item is ready, and saves it', async () => {
    const item = await Item.create({ modelName: 'EarlyPost', schemaName: SCHEMA_NAME } as never, {
      waitForReady: false,
    } as never)
    const id = item.seedLocalId
    try {
      ;(item as any).title = 'assigned early'
      expect((item as any).title).toBe('assigned early')

      await waitForEntityReady(item)
      const title = item.properties.find((p) => p.propertyName === 'title')!
      await expect.poll(() => title.value, { timeout: 10000 }).toBe('assigned early')
      await title.save()
      expect((item as any).title).toBe('assigned early')
    } finally {
      item.unload()
    }

    Item.dropCachedInstancesForSeedIds([id])
    const reloaded = (await Item.find({ seedLocalId: id, hold: true }))!
    try {
      expect((reloaded as any).title).toBe('assigned early')
    } finally {
      reloaded.unload()
    }
  }, 60000)
})
