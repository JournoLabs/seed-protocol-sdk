import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { seeds } from '@/seedSchema'
import { Item } from '@/Item/Item'
import { ItemCreateValidationError, UnknownModelError } from '@/Item/errors'
import { importJsonSchema } from '@/imports/json'
import { generateId } from '@/helpers'
import type { SchemaFileFormat } from '@/types/import'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'

/** Item.create rejects unknown models, unknown keys and invalid values, and writes nothing. */

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe
const SCHEMA_NAME = 'Test Schema Strict Create'

function schemaFile(): SchemaFileFormat {
  const now = new Date().toISOString()
  return {
    $schema: 'https://seedprotocol.org/schemas/data-model/v1',
    version: 1,
    id: generateId(),
    metadata: { name: SCHEMA_NAME, createdAt: now, updatedAt: now },
    models: {
      StrictNote: {
        id: generateId(),
        properties: {
          title: { id: generateId(), type: 'Text', validation: { maxLength: 10 } },
          rating: { id: generateId(), type: 'Number' },
        },
      },
    },
    enums: {},
    migrations: [],
  } as SchemaFileFormat
}

async function seedCount() {
  const rows = await BaseDb.getAppDb()!.select().from(seeds).where(eq(seeds.type, 'strict_note'))
  return rows.length
}

testDescribe('Item.create is strict', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    const file = schemaFile()
    await importJsonSchema({ contents: JSON.stringify(file) }, file.version)
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it('rejects an unknown model', async () => {
    await expect(Item.create({ modelName: 'NoSuchModel', schemaName: SCHEMA_NAME })).rejects.toBeInstanceOf(
      UnknownModelError,
    )
  })

  it('rejects unknown keys, too-long values and wrong types, and writes nothing', async () => {
    const before = await seedCount()
    const error = await Item.create({
      modelName: 'StrictNote',
      schemaName: SCHEMA_NAME,
      title: 'Far too long a title',
      rating: 'five',
      colour: 'blue',
    } as any).catch((e) => e)

    expect(error).toBeInstanceOf(ItemCreateValidationError)
    expect((error as ItemCreateValidationError).problems.map((p) => [p.property, p.code])).toEqual(
      expect.arrayContaining([
        ['title', expect.any(String)],
        ['rating', expect.any(String)],
        ['colour', 'unknown_property'],
      ]),
    )
    expect(await seedCount()).toBe(before)
  })

  it('creates an item with valid values', async () => {
    const item = await Item.create({ modelName: 'StrictNote', schemaName: SCHEMA_NAME, title: 'Short', rating: 4 })
    expect(item.seedLocalId).toBeTruthy()
  })
})
