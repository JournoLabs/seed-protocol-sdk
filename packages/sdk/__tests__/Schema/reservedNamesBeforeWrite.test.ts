import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { properties as propertiesTable } from '@/seedSchema/ModelSchema'
import { Schema } from '@/Schema/Schema'
import { Model } from '@/Model/Model'
import { ModelProperty } from '@/ModelProperty/ModelProperty'
import { importJsonSchema } from '@/imports/json'
import { generateId } from '@/helpers'
import { findLatestSchemaFile } from '@/helpers/schema'
import { getPropertySchema } from '@/helpers/property'
import { renameModelProperty } from '@/helpers/updateSchema'
import type { SchemaFileFormat } from '@/types/import'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'
import { waitForSchemaIdle, waitForModelPropertyIdle } from '../test-utils/waitForIdle'

/**
 * A name EAS can't use (a reserved Solidity ABI word) is refused before anything is written: no
 * schema version file, no model left in the schema. Valid List-of-relation definitions pass in
 * either shape.
 */

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe.sequential

function schemaFile(name: string): SchemaFileFormat {
  const now = new Date().toISOString()
  return {
    $schema: 'https://seedprotocol.io/schemas/data-model/v1',
    version: 1,
    id: generateId(),
    metadata: { name, createdAt: now, updatedAt: now },
    models: { Post: { id: generateId(), properties: { title: { id: generateId(), type: 'Text' } } } },
    enums: {},
    migrations: [],
  } as SchemaFileFormat
}

async function loadSchema(name: string) {
  const file = schemaFile(name)
  await importJsonSchema({ contents: JSON.stringify(file) }, file.version)
  const schema = Schema.create(name, { waitForReady: false }) as Schema
  await waitForSchemaIdle(schema)
  return { file, schema }
}

const latestVersion = async (file: SchemaFileFormat) => (await findLatestSchemaFile(file.id!))?.version ?? 1

testDescribe('reserved names are refused before writing', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it('saveNewVersion with a reserved property rename and a valid edit rejects and writes no version', async () => {
    const schemaName = 'Test Schema Reserved Save'
    const { file, schema } = await loadSchema(schemaName)
    const propertyData = await vi.waitFor(
      async () => {
        const data = await getPropertySchema('Post', 'title', { schemaName })
        if (!data) throw new Error('Post.title not loaded yet')
        return data
      },
      { timeout: 15000, interval: 100 },
    )
    const title = ModelProperty.create(propertyData, { waitForReady: false })
    await waitForModelPropertyIdle(title)
    title.name = 'memory'
    await waitForModelPropertyIdle(title)
    await Model.create('Note', schema, { properties: { text: { dataType: 'Text' } } })

    await expect(schema.saveNewVersion()).rejects.toThrow(/"memory".*reserved Solidity ABI word/)
    expect(await latestVersion(file)).toBe(1)
  }, 60000)

  it('renameModelProperty to a reserved word rejects, writes no version and keeps the row', async () => {
    const schemaName = 'Test Schema Reserved Rename Helper'
    const { file } = await loadSchema(schemaName)
    const titleId = file.models.Post.properties.title.id

    await expect(renameModelProperty(schemaName, 'Post', 'title', 'memory')).rejects.toThrow(
      /"memory".*reserved Solidity ABI word/,
    )
    expect(await latestVersion(file)).toBe(1)
    const rows = await BaseDb.getAppDb()
      .select({ name: propertiesTable.name })
      .from(propertiesTable)
      .where(eq(propertiesTable.schemaFileId, titleId!))
    expect(rows).toEqual([{ name: 'title' }])
  }, 60000)

  it('Model.create with an id and a reserved name rejects and leaves no model in the schema', async () => {
    const { schema } = await loadSchema('Test Schema Reserved Model Id')

    await expect(Model.create('Fallback', schema, { id: generateId() })).rejects.toThrow(
      /Model "Fallback".*reserved Solidity ABI word/,
    )
    expect(schema.models.map((model) => model.modelName)).not.toContain('Fallback')
  }, 60000)

  it('Model.create accepts a List of relations named with a reserved word in schema-file shape', async () => {
    const { schema } = await loadSchema('Test Schema Reserved List Items')

    const doc = await Model.create('Doc', schema, {
      properties: { indexed: { type: 'List', items: { type: 'Relation', model: 'Post' } } },
    })
    expect(doc.modelName).toBe('Doc')
    const rows = await BaseDb.getAppDb()
      .select({ dataType: propertiesTable.dataType, refValueType: propertiesTable.refValueType })
      .from(propertiesTable)
      .where(eq(propertiesTable.modelId, doc.getService().getSnapshot().context._dbId!))
    expect(rows).toEqual([{ dataType: 'List', refValueType: 'Relation' }])
  }, 60000)
})
