import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { BaseDb } from '@/db/Db/BaseDb'
import { importJsonSchema } from '@/imports/json'
import { generateId } from '@/helpers'
import { Model } from '@/Model/Model'
import { ModelProperty } from '@/ModelProperty/ModelProperty'
import { setupTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../../test-utils/client-init'
import { cleanupTestSchemaData } from '../../test-utils/cleanupTestDb'

type Driver = (sql: string, params: unknown[], method: string) => Promise<unknown>

// Schema import persists its models through addModelsToDb. The Model instances it creates adopt those
// rows instead of writing their own, so each model and property row is written once: an insert, and no
// update from a second writer (or a second insert, when the two writers race).
describe('schema import writes each model and property row once', () => {
  const writes: { sql: string; params: unknown[] }[] = []
  let originalClient: Driver

  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    const session = (BaseDb.getAppDb() as any).session as { client: Driver }
    originalClient = session.client
    session.client = async (sql, params, method) => {
      if (/^(insert into|update) /.test(sql)) writes.push({ sql, params })
      return originalClient(sql, params, method)
    }
    return () => {
      session.client = originalClient
    }
  }, SETUP_HOOK_TIMEOUT_MS)

  afterEach(async () => {
    writes.length = 0
    await cleanupTestSchemaData()
  })

  const writesTo = (table: string, fileId: string) =>
    writes
      .filter(({ sql, params }) => sql.includes(` "${table}" `) && params.includes(fileId))
      .map(({ sql }) => sql.split(' (')[0].split(' set ')[0])

  it('writes each row once and the models still create their properties', async () => {
    const schemaName = `Single Write ${generateId()}`
    const noteId = generateId()
    const titleId = generateId()
    const bodyId = generateId()
    const tagId = generateId()
    const labelId = generateId()
    const schemaFile = {
      $schema: 'https://seedprotocol.org/schemas/data-model/v1',
      version: 1,
      id: generateId(),
      metadata: { name: schemaName, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      models: {
        Note: {
          id: noteId,
          properties: { title: { id: titleId, type: 'Text' }, body: { id: bodyId, type: 'Text' } },
        },
        Tag: { id: tagId, properties: { label: { id: labelId, type: 'Text' } } },
      },
      enums: {},
      migrations: [],
    }

    await importJsonSchema({ contents: JSON.stringify(schemaFile) }, schemaFile.version)

    // Same instances import created; resolves once their properties exist
    const note = await Model.create('Note', schemaName, { modelFileId: noteId })
    const tag = await Model.create('Tag', schemaName, { modelFileId: tagId })

    for (const model of [note, tag]) {
      const context = model.getService().getSnapshot().context
      expect(context._pendingPropertyDefinitions).toBeUndefined()
      expect(context._dbId).toEqual(expect.any(Number))
    }
    for (const propertyId of [titleId, bodyId, labelId]) {
      expect(ModelProperty.getById(propertyId)).toBeDefined()
    }

    // Writes that would duplicate these can trail the models becoming ready
    await new Promise((resolve) => setTimeout(resolve, 500))
    for (const modelId of [noteId, tagId]) {
      expect(writesTo('models', modelId)).toEqual(['insert into "models"'])
    }
    for (const propertyId of [titleId, bodyId, labelId]) {
      expect(writesTo('properties', propertyId)).toEqual(['insert into "properties"'])
    }
  })
})
