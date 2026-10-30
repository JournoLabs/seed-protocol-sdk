import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Item } from '@/Item/Item'
import { importJsonSchema } from '@/imports/json'
import { generateId } from '@/helpers'
import type { SchemaFileFormat } from '@/types/import'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'

/** `storagePropertyName` is the name new rows are stored under (late triage E7, batch 12). */
const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe
const SCHEMA_NAME = 'Test Schema Storage Property Name'

function schemaFile(): SchemaFileFormat {
  const now = new Date().toISOString()
  return {
    $schema: 'https://seedprotocol.io/schemas/data-model/v1',
    version: 1,
    id: generateId(),
    metadata: { name: SCHEMA_NAME, createdAt: now, updatedAt: now },
    models: {
      Writer: { id: generateId(), properties: { name: { id: generateId(), type: 'Text' } } },
      Article: {
        id: generateId(),
        properties: {
          title: { id: generateId(), type: 'Text' },
          author: { id: generateId(), type: 'Relation', model: 'Writer' },
        },
      },
    },
    enums: {},
    migrations: [],
  } as SchemaFileFormat
}

testDescribe('ItemProperty.storagePropertyName', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    const file = schemaFile()
    await importJsonSchema({ contents: JSON.stringify(file) }, file.version)
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it('is <key>Id for a single Relation and the key for Text', async () => {
    const article = await Item.create({ modelName: 'Article', schemaName: SCHEMA_NAME, title: 'A' } as never)
    try {
      const author = article.properties.find((p) => p.propertyName === 'author')!
      const title = article.properties.find((p) => p.propertyName === 'title')!
      expect(author.storagePropertyName).toBe('authorId')
      expect(title.storagePropertyName).toBe('title')
    } finally {
      article.unload()
    }
  }, 30000)
})
