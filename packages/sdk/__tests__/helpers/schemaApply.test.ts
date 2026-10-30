import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { SEED_PROTOCOL_SCHEMA_NAME } from '@/helpers/constants'
import { schemas } from '@/seedSchema/SchemaSchema'
import { models as modelsTable, properties as propertiesTable } from '@/seedSchema/ModelSchema'
import { Schema } from '@/Schema/Schema'
import { Model } from '@/Model/Model'
import { importJsonSchema, syncSchemaFromSource } from '@/imports/json'
import { updateModelProperties } from '@/helpers/updateSchema'
import { applySchemaFile, deriveSchemaFileId, resolveSchemaRow } from '@/helpers/schemaApply'
import { listLatestSchemaFiles, loadAllSchemasFromDb, readSchemaFile } from '@/helpers/schema'
import { processSchemaFilesOnce } from '@/client/actors/processSchemaFiles'
import type { SchemaFileFormat, SchemaFileInput } from '@/types/import'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'
import { cleanupTestSchemaData } from '../test-utils/cleanupTestDb'
import { WAIT_TIMEOUT_MS } from '../test-utils/timeouts'

/**
 * applySchemaFile, resolveSchemaRow and writeNextSchemaVersion (helpers/schemaApply.ts): the one
 * path between schema files and rows.
 */
const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe.skip

const schemaRow = async (where: { id?: string; name?: string }) => {
  const db = BaseDb.getAppDb()!
  return db
    .select()
    .from(schemas)
    .where(where.id ? eq(schemas.schemaFileId, where.id) : eq(schemas.name, where.name!))
}

const propertyRow = async (modelFileId: string, name: string) => {
  const db = BaseDb.getAppDb()!
  const [model] = await db.select().from(modelsTable).where(eq(modelsTable.schemaFileId, modelFileId))
  const [row] = await db
    .select()
    .from(propertiesTable)
    .where(and(eq(propertiesTable.modelId, model!.id), eq(propertiesTable.name, name)))
  return row
}

testDescribe('applySchemaFile', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
  }, SETUP_HOOK_TIMEOUT_MS)

  afterEach(async () => {
    vi.restoreAllMocks()
    await cleanupTestSchemaData()
  })

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  // Audit V4 / defect 1.4: the rename was undone at the next init, which matched files by name.
  it('keeps a schema rename through the next init', async () => {
    const schemaId = 'apply-rename-schema'
    const oldName = 'Apply Rename Original'
    const newName = 'Apply Rename Renamed'
    const now = new Date().toISOString()
    const file: SchemaFileFormat = {
      $schema: 'https://seedprotocol.io/schemas/data-model/v1',
      version: 1,
      id: schemaId,
      metadata: { name: oldName, createdAt: now, updatedAt: now },
      models: { RenameNote: { id: 'apply-rename-note', properties: { title: { id: 'apply-rename-title', type: 'Text' } } } },
      enums: {},
      migrations: [],
    }
    await importJsonSchema({ contents: JSON.stringify(file) }, 1)

    const schema = (await Schema.create(oldName)) as Schema
    schema.name = newName
    await vi.waitFor(async () => expect((await schemaRow({ id: schemaId }))[0]?.name).toBe(newName), {
      timeout: WAIT_TIMEOUT_MS,
    })
    await vi.waitFor(() => expect(schema.version).toBe(2), { timeout: WAIT_TIMEOUT_MS })
    expect(schema.lastSaveError).toBeUndefined()

    // The rename is the next version file, under the new name
    const latest = (await listLatestSchemaFiles()).find((info) => info.schemaFileId === schemaId)
    expect(latest).toMatchObject({ name: newName, version: 2 })

    await processSchemaFilesOnce({})
    const rows = await schemaRow({ id: schemaId })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ name: newName, version: 2, isDraft: false })
    const loaded = (await loadAllSchemasFromDb()).filter((entry) => entry.schema.id === schemaId)
    expect(loaded.map((entry) => entry.schema.metadata.name)).toEqual([newName])
  }, 60_000)

  it('skips an unchanged config.schema on the second init', async () => {
    // PermaPress's shape: no ids, no timestamps, `dataType` and `ref` keys, models as an array
    const configSchema = {
      metadata: { name: 'Apply Config Schema' },
      models: [
        {
          name: 'ConfigPost',
          properties: [
            { name: 'title', dataType: 'text' },
            { name: 'publication', dataType: 'Relation', ref: 'ConfigPublication' },
          ],
        },
        { name: 'ConfigPublication', properties: [{ name: 'name', dataType: 'text' }] },
      ],
    } as unknown as SchemaFileInput

    await processSchemaFilesOnce({ schema: configSchema })
    const [first] = await schemaRow({ name: 'Apply Config Schema' })
    expect(first.contentHash).toBeTruthy()

    const transaction = vi.spyOn(BaseDb, 'transaction')
    const models = await processSchemaFilesOnce({ schema: configSchema })
    expect(transaction).not.toHaveBeenCalled()
    expect(Object.keys(models)).toEqual(expect.arrayContaining(['ConfigPost', 'ConfigPublication']))
    const [second] = await schemaRow({ name: 'Apply Config Schema' })
    expect(second).toEqual(first)
  }, 60_000)

  // The format URL moved from seedprotocol.org to seedprotocol.io; stored files keep the old one.
  it('matches a stored file that has the old $schema URL', async () => {
    const now = new Date().toISOString()
    const file: SchemaFileFormat = {
      $schema: 'https://seedprotocol.org/schemas/data-model/v1',
      version: 1,
      id: 'apply-format-url-schema',
      metadata: { name: 'Apply Format URL', createdAt: now, updatedAt: now },
      models: { FormatNote: { id: 'apply-format-note', properties: { title: { id: 'apply-format-title', type: 'Text' } } } },
      enums: {},
      migrations: [],
    }
    await applySchemaFile(file)

    const result = await applySchemaFile({ ...file, $schema: 'https://seedprotocol.io/schemas/data-model/v1' })
    expect(result.skipped).toBe(true)
  }, 60_000)

  it('assigns missing ids once, from the names, and keeps them when the schema changes', async () => {
    const name = 'Apply Stable Ids'
    const base: SchemaFileInput = {
      metadata: { name },
      models: { StablePost: { properties: { title: { type: 'Text' } } } },
    }
    const first = await applySchemaFile(base, { onChangedContent: 'replace' })
    const ids = {
      schema: first.schemaFile.id,
      model: first.schemaFile.models.StablePost.id,
      title: first.schemaFile.models.StablePost.properties.title.id,
    }
    expect(ids).toEqual({
      schema: deriveSchemaFileId(name),
      model: deriveSchemaFileId(name, 'StablePost'),
      title: deriveSchemaFileId(name, 'StablePost', 'title'),
    })
    // Written into the stored file
    const stored = await readSchemaFile(first.filePath!)
    expect(stored?.models.StablePost.properties.title.id).toBe(ids.title)

    const second = await applySchemaFile(
      {
        ...base,
        version: 2,
        models: { StablePost: { properties: { title: { type: 'Text' }, body: { type: 'Text' } } } },
      },
      { onChangedContent: 'replace' },
    )
    expect(second.schemaFile.id).toBe(ids.schema)
    expect(second.schemaFile.models.StablePost.id).toBe(ids.model)
    expect(second.schemaFile.models.StablePost.properties.title.id).toBe(ids.title)
    expect((await propertyRow(ids.model!, 'title'))?.schemaFileId).toBe(ids.title)
    expect(await schemaRow({ name })).toHaveLength(1)
  }, 60_000)

  it("reads `dataType`, `ref` and storage columns and keeps the file's other fields", async () => {
    const now = new Date().toISOString()
    const file: SchemaFileFormat = {
      $schema: 'https://seedprotocol.io/schemas/data-model/v1',
      version: 1,
      id: 'apply-shapes',
      metadata: { name: 'Apply Shapes', createdAt: now, updatedAt: now },
      models: {
        ShapePost: {
          id: 'apply-shapes-post',
          properties: {
            publication: { id: 'apply-shapes-pub', dataType: 'Relation', ref: 'ShapePublication' },
            cover: { id: 'apply-shapes-cover', dataType: 'Relation', refValueType: 'Image', ref: 'Image' },
            tags: { id: 'apply-shapes-tags', dataType: 'List', refValueType: 'Relation', ref: 'ShapePublication' },
            body: { id: 'apply-shapes-body', dataType: 'Html', htmlEmbeddedDataUriPolicy: 'preserve' },
            notes: { id: 'apply-shapes-notes', dataType: 'Text', storageType: 'ItemStorage', localStorageDir: '/notes', filenameSuffix: '.md' },
          },
        },
        ShapePublication: { id: 'apply-shapes-publication', properties: { name: { id: 'apply-shapes-name', type: 'Text' } } },
      },
      enums: {},
      migrations: [],
    }
    await importJsonSchema({ contents: JSON.stringify(file) })
    const db = BaseDb.getAppDb()!
    const [publication] = await db.select().from(modelsTable).where(eq(modelsTable.schemaFileId, 'apply-shapes-publication'))

    const relation = await propertyRow('apply-shapes-post', 'publication')
    expect(relation).toMatchObject({ dataType: 'Relation', refModelId: publication.id })
    expect(await propertyRow('apply-shapes-post', 'cover')).toMatchObject({ dataType: 'Relation', refValueType: 'Image' })
    expect(await propertyRow('apply-shapes-post', 'tags')).toMatchObject({ dataType: 'List', refValueType: 'Relation', refModelId: publication.id })
    expect(await propertyRow('apply-shapes-post', 'notes')).toMatchObject({ storageType: 'ItemStorage', localStorageDir: '/notes', filenameSuffix: '.md' })

    // A patch keeps every property it doesn't touch as it was
    await updateModelProperties('Apply Shapes', [
      { modelName: 'ShapePost', propertyName: 'notes', updates: { required: true } },
    ])
    expect(await propertyRow('apply-shapes-post', 'publication')).toMatchObject({ dataType: 'Relation', refModelId: publication.id })
    expect(await propertyRow('apply-shapes-post', 'notes')).toMatchObject({ required: true, storageType: 'ItemStorage' })
    expect(await propertyRow('apply-shapes-post', 'cover')).toMatchObject({ refValueType: 'Image' })
    const latest = (await listLatestSchemaFiles()).find((info) => info.schemaFileId === 'apply-shapes')!
    const saved = await readSchemaFile(latest.filePath)
    expect(saved?.version).toBe(2)
    expect(saved?.models.ShapePost.properties.body.htmlEmbeddedDataUriPolicy).toBe('preserve')
  }, 60_000)

  // G13-4: saveNewVersion wrote only what row-built instances carry
  it('saveNewVersion keeps fields the instances do not carry', async () => {
    const schemaName = 'Apply Next Version Fields'
    const now = new Date().toISOString()
    const file: SchemaFileFormat = {
      $schema: 'https://seedprotocol.io/schemas/data-model/v1',
      version: 1,
      id: 'apply-next-fields',
      metadata: { name: schemaName, createdAt: now, updatedAt: now },
      models: {
        FieldsPost: {
          id: 'apply-next-fields-post',
          description: 'A post',
          indexes: ['title'],
          properties: {
            title: { id: 'apply-next-fields-title', type: 'Text', validation: { maxLength: 80 }, description: 'Headline' },
            body: { id: 'apply-next-fields-body', type: 'Html', htmlEmbeddedDataUriPolicy: 'preserve' },
          },
        },
      },
      enums: { Mood: ['calm'] },
      migrations: [],
    }
    await importJsonSchema({ contents: JSON.stringify(file) })
    // Loaded cold, the instances are built from rows
    Schema.clearCache()
    const schema = (await Schema.create(schemaName)) as Schema
    await Model.create('FieldsNote', schema, { properties: { text: { dataType: 'Text' } } })

    const saved = await readSchemaFile(await schema.saveNewVersion())
    expect(saved?.version).toBe(2)
    expect(saved?.enums).toEqual({ Mood: ['calm'] })
    expect(saved?.models.FieldsPost).toMatchObject({ description: 'A post', indexes: ['title'] })
    expect(saved?.models.FieldsPost.properties.title).toMatchObject({
      id: 'apply-next-fields-title',
      validation: { maxLength: 80 },
      description: 'Headline',
    })
    expect(saved?.models.FieldsPost.properties.body.htmlEmbeddedDataUriPolicy).toBe('preserve')
    expect(Object.keys(saved?.models ?? {}).sort()).toEqual(['FieldsNote', 'FieldsPost'])
  }, 60_000)

  it('syncSchemaFromSource replaces a changed file of the same id and version', async () => {
    const source: SchemaFileInput = {
      id: 'apply-sync-replace',
      metadata: { name: 'Apply Sync Replace' },
      models: { SyncNote: { properties: { title: { type: 'Text' } } } },
    }
    await syncSchemaFromSource(source)
    await syncSchemaFromSource({ ...source, models: { SyncNote: { properties: { title: { type: 'Number' } } } } })
    const [row] = await schemaRow({ id: 'apply-sync-replace' })
    expect(row.version).toBe(1)
    expect((await propertyRow(deriveSchemaFileId('Apply Sync Replace', 'SyncNote'), 'title'))?.dataType).toBe('Number')
  }, 60_000)

  // PermaPress twin: the browser FileManager logged ENOENT for SEEDPROTOCOL_Seed_Protocol_v1.json
  it('resolves the internal schema from its row without reading a file', async () => {
    const [row] = await schemaRow({ name: SEED_PROTOCOL_SCHEMA_NAME })
    expect(row?.schemaFileId).toBeTruthy()
    const read = vi.spyOn(BaseFileManager, 'readFileAsString')
    const { schema, filePath } = await resolveSchemaRow(row!)
    expect(read).not.toHaveBeenCalled()
    expect(filePath).toBeUndefined()
    expect(schema.metadata.name).toBe(SEED_PROTOCOL_SCHEMA_NAME)
    expect(Object.keys(schema.models)).toEqual(expect.arrayContaining(['Seed', 'Version', 'Metadata']))
  }, 60_000)
})
