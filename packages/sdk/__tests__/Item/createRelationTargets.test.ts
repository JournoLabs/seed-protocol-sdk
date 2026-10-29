import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Item } from '@/Item/Item'
import { importJsonSchema } from '@/imports/json'
import { generateId } from '@/helpers'
import { OutboxOpFailedError } from '@/outbox/outbox'
import { RelationTargetError } from '@/outbox/itemAppliers'
import type { SchemaFileFormat } from '@/types/import'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'

/**
 * Item.create checks its initial Relation values like an assignment does (batch 12): a local seed id
 * that doesn't exist is refused instead of stored.
 */
const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe
const SCHEMA_NAME = 'Test Schema Create Relation Targets'

function schemaFile(): SchemaFileFormat {
  const now = new Date().toISOString()
  return {
    $schema: 'https://seedprotocol.io/schemas/data-model/v1',
    version: 1,
    id: generateId(),
    metadata: { name: SCHEMA_NAME, createdAt: now, updatedAt: now },
    models: {
      Byline: { id: generateId(), properties: { name: { id: generateId(), type: 'Text' } } },
      Story: {
        id: generateId(),
        properties: {
          title: { id: generateId(), type: 'Text' },
          author: { id: generateId(), type: 'Relation', model: 'Byline' },
        },
      },
    },
    enums: {},
    migrations: [],
  } as SchemaFileFormat
}

testDescribe('Item.create relation targets', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    const file = schemaFile()
    await importJsonSchema({ contents: JSON.stringify(file) }, file.version)
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it('refuses a local seed id that does not exist, and keeps an existing one', async () => {
    await expect(
      Item.create({ modelName: 'Story', schemaName: SCHEMA_NAME, title: 'dangling', author: 'noSuchByline' } as never),
    ).rejects.toThrow(/Relation target not found: noSuchByline/)

    const byline = await Item.create({ modelName: 'Byline', schemaName: SCHEMA_NAME, name: 'Ada' } as never)
    const story = await Item.create({
      modelName: 'Story',
      schemaName: SCHEMA_NAME,
      title: 'related',
      author: byline.seedLocalId,
    } as never)
    try {
      expect((story as any).author).toBe(byline.seedLocalId)
    } finally {
      story.unload()
      byline.unload()
    }
  }, 60000)

  it('rejects with OutboxOpFailedError whose cause is the RelationTargetError, with its targets (D31)', async () => {
    const error = await Item.create({ modelName: 'Story', schemaName: SCHEMA_NAME, title: 'dangling', author: 'noSuchByline2' } as never).catch(
      (e: unknown) => e,
    )
    expect(error).toBeInstanceOf(OutboxOpFailedError)
    expect((error as OutboxOpFailedError).errorName).toBe('RelationTargetError')
    const cause = (error as Error).cause
    expect(cause).toBeInstanceOf(RelationTargetError)
    expect((cause as RelationTargetError).targets).toEqual(['noSuchByline2'])
  }, 60000)

  it('a property save to a missing target rejects the same way', async () => {
    const story = await Item.create({ modelName: 'Story', schemaName: SCHEMA_NAME, title: 'later' } as never)
    try {
      const author = story.properties.find((p) => p.propertyName === 'author')!
      author.value = 'noSuchByline3'
      const error = await author.save().catch((e: unknown) => e)
      expect(error).toBeInstanceOf(OutboxOpFailedError)
      expect((error as Error).cause).toBeInstanceOf(RelationTargetError)
      expect(((error as Error).cause as RelationTargetError).targets).toEqual(['noSuchByline3'])
    } finally {
      story.unload()
    }
  }, 60000)
})
