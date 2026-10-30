import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { metadata, models as modelsTable, properties as propertiesTable } from '@/seedSchema'
import { Model } from '@/Model/Model'
import { ModelProperty } from '@/ModelProperty/ModelProperty'
import { Item } from '@/Item/Item'
import { importJsonSchema } from '@/imports/json'
import { generateId } from '@/helpers'
import type { SchemaFileFormat } from '@/types/import'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'
import { waitForItemIdle } from '../test-utils/waitForIdle'

/**
 * Destroying a property or model that items have values for. Node's libsql enforces foreign keys,
 * so these deletes used to fail there; destroy() swallowed the error and resolved.
 */

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe
const SCHEMA_NAME = 'Test Schema Destroy With Values'

function schemaFile(): SchemaFileFormat {
  const now = new Date().toISOString()
  return {
    $schema: 'https://seedprotocol.io/schemas/data-model/v1',
    version: 1,
    id: generateId(),
    metadata: { name: SCHEMA_NAME, createdAt: now, updatedAt: now },
    models: {
      DestroyNote: {
        id: generateId(),
        properties: {
          title: { id: generateId(), type: 'Text' },
          body: { id: generateId(), type: 'Text' },
        },
      },
    },
    enums: {},
    migrations: [],
  } as SchemaFileFormat
}

async function titleValues(seedLocalId: string) {
  return BaseDb.getAppDb()!
    .select({ value: metadata.propertyValue, propertyId: metadata.propertyId })
    .from(metadata)
    .where(and(eq(metadata.seedLocalId, seedLocalId), eq(metadata.propertyName, 'title')))
}

testDescribe('destroy with stored item values', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    const file = schemaFile()
    await importJsonSchema({ contents: JSON.stringify(file) }, file.version)
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it('ModelProperty.destroy removes the property and keeps the values, unlinked', async () => {
    const item = await Item.create({ modelName: 'DestroyNote', schemaName: SCHEMA_NAME, title: 'Kept value' })
    await waitForItemIdle(item)
    expect((await titleValues(item.seedLocalId))[0]?.propertyId).not.toBeNull()

    const model = await Model.getByNameAsync('DestroyNote', SCHEMA_NAME)
    const title = model!.properties.find((p) => p.name === 'title')!
    await title.destroy()

    const remaining = await BaseDb.getAppDb()!
      .select({ name: propertiesTable.name })
      .from(propertiesTable)
      .innerJoin(modelsTable, eq(propertiesTable.modelId, modelsTable.id))
      .where(and(eq(modelsTable.name, 'DestroyNote'), eq(propertiesTable.name, 'title')))
    expect(remaining).toEqual([])
    expect(await titleValues(item.seedLocalId)).toEqual([{ value: 'Kept value', propertyId: null }])
  }, 30000)

  it('Model.destroy succeeds when the model has items', async () => {
    const item = await Item.create({ modelName: 'DestroyNote', schemaName: SCHEMA_NAME, body: 'Body' })
    await waitForItemIdle(item)
    const model = await Model.getByNameAsync('DestroyNote', SCHEMA_NAME)

    await model!.destroy()

    const rows = await BaseDb.getAppDb()!.select().from(modelsTable).where(eq(modelsTable.name, 'DestroyNote'))
    expect(rows).toEqual([])
  }, 30000)

  it('ModelProperty.create rejects when its row cannot be written', async () => {
    await expect(
      ModelProperty.create(
        { id: generateId(), name: 'orphan', dataType: 'Text', modelName: 'NoSuchModelAnywhere' } as any,
        { readyTimeout: 3000 },
      ),
    ).rejects.toThrow('has no database row')
  }, 30000)
})
