// @vitest-environment node
import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { ModelProperty } from '@/ModelProperty/ModelProperty'
import { SchemaFileFormat } from '@/types/import'
import { importJsonSchema } from '@/imports/json'
import { updateModelProperties } from '@/helpers/updateSchema'
import { models as modelsTable, properties, modelSchemas } from '@/seedSchema'
import { schemas } from '@/seedSchema/SchemaSchema'
import { propertyUids } from '@/seedSchema/PropertyUidSchema'
import { modelUids } from '@/seedSchema/ModelUidSchema'
import { generateId } from '@/helpers'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'

function createTestSchema(name: string, models: Record<string, any>): SchemaFileFormat {
  return {
    $schema: 'https://seedprotocol.org/schemas/data-model/v1',
    version: 1,
    id: generateId(),
    metadata: {
      name,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    models,
    enums: {},
    migrations: [],
  }
}

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe

testDescribe('Property row changes reach cached ModelProperty instances', () => {
  beforeAll(async () => {
    await setupTestEnvironment({
      testFileUrl: import.meta.url,
      timeout: SETUP_HOOK_TIMEOUT_MS,
    })
  }, SETUP_HOOK_TIMEOUT_MS)

  afterEach(async () => {
    const db = BaseDb.getAppDb()
    if (db) {
      await db.update(properties).set({ refModelId: null })
      await db.delete(propertyUids)
      await db.delete(modelUids)
      await db.delete(properties)
      await db.delete(modelSchemas)
      await db.delete(modelsTable)
      await db.delete(schemas)
    }
  })

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it('should give the cached instance the dataType and required the schema update stored', async () => {
    const schemaName = 'Property Row Sync Test Schema'
    const viewsId = generateId()
    const testSchema = createTestSchema(schemaName, {
      Post: {
        id: generateId(),
        properties: {
          views: {
            id: viewsId,
            dataType: 'Text',
          },
        },
      },
    })

    await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)

    const cachedProperty = await ModelProperty.createById(viewsId)
    expect(cachedProperty).toBeDefined()
    expect(cachedProperty!.dataType).toBe('Text')

    await updateModelProperties(schemaName, [
      { modelName: 'Post', propertyName: 'views', updates: { type: 'Number', required: true } },
    ])

    const db = BaseDb.getAppDb()
    if (!db) throw new Error('Database not available')
    const [row] = await db.select().from(properties).where(eq(properties.schemaFileId, viewsId))
    expect(row.dataType).toBe('Number')
    expect(row.required).toBe(true)

    expect(ModelProperty.getById(viewsId)).toBe(cachedProperty)
    expect(cachedProperty!.name).toBe('views')
    expect(cachedProperty!.dataType).toBe('Number')
    // required isn't a ModelProperty field; it's in the service context
    const context = cachedProperty!.getService().getSnapshot().context
    expect(context.required).toBe(true)
    // Synced from storage, not edited
    expect(cachedProperty!.isEdited).toBe(false)
  })
})
