import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { Item } from '@/Item/Item'
import { ItemProperty } from '@/ItemProperty/ItemProperty'
import { importJsonSchema } from '@/imports/json'
import { generateId } from '@/helpers'
import type { SchemaFileFormat } from '@/types/import'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'

/**
 * A File property's value is its content URL (file:// in Node, a blob URL in browsers), before and
 * after a reload. It used to turn into the file's text a moment after each save or load.
 */

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe
const SCHEMA_NAME = 'Test Schema File Value'

function schemaFile(): SchemaFileFormat {
  const now = new Date().toISOString()
  return {
    $schema: 'https://seedprotocol.org/schemas/data-model/v1',
    version: 1,
    id: generateId(),
    metadata: { name: SCHEMA_NAME, createdAt: now, updatedAt: now },
    models: {
      FileDoc: {
        id: generateId(),
        properties: {
          title: { id: generateId(), type: 'Text' },
          attachment: { id: generateId(), type: 'File' },
        },
      },
    },
    enums: {},
    migrations: [],
  } as SchemaFileFormat
}

testDescribe('File property values', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    const file = schemaFile()
    await importJsonSchema({ contents: JSON.stringify(file) }, file.version)
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it('stay the content URL after the save settles and after a reload', async () => {
    if (typeof window !== 'undefined') return // Node: file:// URLs
    const item = (await Item.create({ modelName: 'FileDoc', schemaName: SCHEMA_NAME, title: 'doc' } as never)) as any
    const property = await ItemProperty.find({ seedLocalId: item.seedLocalId, propertyName: 'attachment' })
    property!.value = 'data:text/plain,hi%20there'
    await property!.save()

    await vi.waitFor(() => expect(String(item.attachment)).toMatch(/^file:\/\//))
    const urlAfterSave = item.attachment
    // The subscription that used to swap in the file's text runs after the save.
    await new Promise((resolve) => setTimeout(resolve, 1500))
    expect(item.attachment).toBe(urlAfterSave)

    Item.dropCachedInstancesForSeedIds([item.seedLocalId])
    const reloaded = (await Item.find({ seedLocalId: item.seedLocalId })) as any
    await vi.waitFor(() => expect(String(reloaded.attachment)).toMatch(/^file:\/\//))
    await new Promise((resolve) => setTimeout(resolve, 1500))
    expect(reloaded.attachment).toBe(urlAfterSave)
  }, 30000)
})
