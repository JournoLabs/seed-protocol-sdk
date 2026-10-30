import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { schemas } from '@/seedSchema'
import { properties } from '@/seedSchema/ModelSchema'
import { ConflictError } from '@/Schema/errors'
import { Schema } from '@/Schema/Schema'
import { Model } from '@/Model/Model'
import { ModelProperty } from '@/ModelProperty/ModelProperty'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { importJsonSchema } from '@/imports/json'
import { generateId } from '@/helpers'
import type { SchemaFileFormat } from '@/types/import'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'
import { waitForSchemaIdle, waitForModelPropertyIdle, waitForModelSettled } from '../test-utils/waitForIdle'
import { WAIT_TIMEOUT_MS } from '../test-utils/timeouts'

/**
 * saveNewVersion writes a schema file that can be loaded again: every model with its
 * properties in file format, the new version on the instance, and later saves (after a
 * reload too) succeed.
 */

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe

async function readSaved(filePath: string): Promise<SchemaFileFormat> {
  return JSON.parse(await BaseFileManager.readFileAsString(filePath)) as SchemaFileFormat
}

async function addModel(schema: Schema, modelName: string, properties: Record<string, unknown>) {
  // Awaited create resolves once its properties exist.
  return Model.create(modelName, schema, { properties })
}

testDescribe('Schema.saveNewVersion writes a loadable file', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it('saves imported and new models with their properties, and updates version', async () => {
    const schemaName = 'Test Schema Save File Imported'
    const now = new Date().toISOString()
    const file: SchemaFileFormat = {
      $schema: 'https://seedprotocol.io/schemas/data-model/v1',
      version: 1,
      id: generateId(),
      metadata: { name: schemaName, createdAt: now, updatedAt: now },
      models: { Post: { id: generateId(), properties: { title: { id: generateId(), type: 'Text' } } } },
      enums: {},
      migrations: [],
    }
    await importJsonSchema({ contents: JSON.stringify(file) }, file.version)
    const schema = Schema.create(schemaName, { waitForReady: false }) as Schema
    await waitForSchemaIdle(schema)

    await addModel(schema, 'Article', {
      body: { dataType: 'Text', validation: { maxLength: 500 } },
      author: { dataType: 'Relation', ref: 'Post' },
    })
    const savedPath = await schema.saveNewVersion()
    const saved = await readSaved(savedPath)

    expect(saved.version).toBe(2)
    expect(schema.version).toBe(2)
    expect(Object.keys(saved.models).sort()).toEqual(['Article', 'Post'])
    expect(saved.models.Post.properties.title).toMatchObject({ type: 'Text', id: expect.any(String) })
    expect(saved.models.Article.properties.body).toMatchObject({ type: 'Text', validation: { maxLength: 500 } })
    expect(saved.models.Article.properties.author).toMatchObject({ type: 'Relation', model: 'Post' })
    expect(JSON.stringify(saved)).not.toContain('_service')

    await addModel(schema, 'Comment', { text: { dataType: 'Text' } })
    const secondPath = await schema.saveNewVersion()
    expect((await readSaved(secondPath)).version).toBe(3)
    expect(schema.version).toBe(3)
  }, 60000)

  it('keeps nameMatch at the schema, model and property level (ADR 0009)', async () => {
    const schemaName = 'Test Schema Save File Name Match'
    const now = new Date().toISOString()
    const file: SchemaFileFormat = {
      $schema: 'https://seedprotocol.io/schemas/data-model/v1',
      version: 1,
      id: generateId(),
      nameMatch: 'normalized',
      metadata: { name: schemaName, createdAt: now, updatedAt: now },
      models: {
        NmSavePost: {
          id: generateId(),
          nameMatch: 'exact',
          properties: {
            title: { id: generateId(), type: 'Text', nameMatch: 'fuzzy' },
            body: { id: generateId(), type: 'Text' },
          },
        },
      },
      enums: {},
      migrations: [],
    }
    await importJsonSchema({ contents: JSON.stringify(file) }, file.version)
    const schema = Schema.create(schemaName, { waitForReady: false }) as Schema
    await waitForSchemaIdle(schema)

    await addModel(schema, 'NmSaveNote', { text: { dataType: 'Text' } })
    const saved = await readSaved(await schema.saveNewVersion())

    expect(saved.nameMatch).toBe('normalized')
    expect(saved.models.NmSavePost.nameMatch).toBe('exact')
    expect(saved.models.NmSavePost.properties.title.nameMatch).toBe('fuzzy')
    expect(saved.models.NmSavePost.properties.body.nameMatch).toBeUndefined()
    expect(saved.models.NmSaveNote.nameMatch).toBeUndefined()
  }, 60000)

  it('keeps nameMatch when the schema loads with its model rows already in the database', async () => {
    const schemaName = 'Test Schema Save File Name Match Reload'
    const now = new Date().toISOString()
    const file: SchemaFileFormat = {
      $schema: 'https://seedprotocol.io/schemas/data-model/v1',
      version: 1,
      id: generateId(),
      metadata: { name: schemaName, createdAt: now, updatedAt: now },
      models: {
        NmReloadPost: {
          id: generateId(),
          nameMatch: 'exact',
          properties: { title: { id: generateId(), type: 'Text', nameMatch: 'fuzzy' } },
        },
      },
      enums: {},
      migrations: [],
    }
    await importJsonSchema({ contents: JSON.stringify(file) }, file.version)
    // A fresh load reads the model rows the import wrote and merges them into the file's models.
    Schema.clearCache()
    const schema = (await Schema.create(schemaName)) as Schema

    await addModel(schema, 'NmReloadNote', { text: { dataType: 'Text' } })
    const saved = await readSaved(await schema.saveNewVersion())

    expect(saved.models.NmReloadPost.nameMatch).toBe('exact')
    expect(saved.models.NmReloadPost.properties.title.nameMatch).toBe('fuzzy')
  }, 60000)

  it('saves a schema created only in code', async () => {
    const schemaName = 'Test Schema Save File Code Only'
    const schema = await Schema.create(schemaName)
    await addModel(schema, 'Note', { title: { dataType: 'Text' } })

    const saved = await readSaved(await schema.saveNewVersion())
    expect(saved.metadata.name).toBe(schemaName)
    expect(saved.models.Note.properties.title).toMatchObject({ type: 'Text' })
  }, 60000)

  it('saves again after the schema is reloaded', async () => {
    const schemaName = 'Test Schema Save File Reload'
    const first = await Schema.create(schemaName)
    await addModel(first, 'Draft', { title: { dataType: 'Text' } })
    await first.saveNewVersion()

    Schema.clearCache()
    const reloaded = (await Schema.create(schemaName)) as Schema
    await addModel(reloaded, 'Revision', { note: { dataType: 'Text' } })
    const saved = await readSaved(await reloaded.saveNewVersion())
    expect(Object.keys(saved.models).sort()).toEqual(['Draft', 'Revision'])
  }, 60000)

  async function importOneProperty(schemaName: string) {
    const now = new Date().toISOString()
    const titleId = generateId()
    const file: SchemaFileFormat = {
      $schema: 'https://seedprotocol.io/schemas/data-model/v1',
      version: 1,
      id: generateId(),
      metadata: { name: schemaName, createdAt: now, updatedAt: now },
      models: { RenamePost: { id: generateId(), properties: { title: { id: titleId, type: 'Text' } } } },
      enums: {},
      migrations: [],
    }
    await importJsonSchema({ contents: JSON.stringify(file) }, file.version)
    return titleId
  }

  async function renameTitle(schemaName: string, titleId: string) {
    const model = await Model.create('RenamePost', schemaName)
    await waitForModelSettled(model as any)
    const prop = ModelProperty.getById(titleId)!
    expect(prop).toBeDefined()
    ;(prop as any).name = 'heading'
    await waitForModelPropertyIdle(prop as any)
    const db = BaseDb.getAppDb()!
    await vi.waitFor(
      async () => expect((await db.select().from(properties).where(eq(properties.schemaFileId, titleId)))[0]?.name).toBe('heading'),
      { timeout: WAIT_TIMEOUT_MS },
    )
  }

  function expectRenamed(saved: SchemaFileFormat, titleId: string) {
    expect(saved.version).toBe(2)
    expect(Object.keys(saved.models.RenamePost.properties)).toEqual(['heading'])
    expect(saved.models.RenamePost.properties.heading).toMatchObject({ id: titleId, type: 'Text' })
  }

  it('saves a setter rename of a property', async () => {
    const schemaName = 'Test Schema Save File Setter Rename'
    const titleId = await importOneProperty(schemaName)
    const schema = (await Schema.create(schemaName)) as Schema
    await renameTitle(schemaName, titleId)

    const savedPath = await schema.saveNewVersion()
    expect(savedPath).not.toBe('')
    expectRenamed(await readSaved(savedPath), titleId)
  }, 60000)

  it('saves a setter rename made before the schema was loaded', async () => {
    const schemaName = 'Test Schema Save File Setter Rename Unloaded'
    const titleId = await importOneProperty(schemaName)
    await renameTitle(schemaName, titleId)
    Schema.evict(schemaName)

    const schema = (await Schema.create(schemaName)) as Schema
    const savedPath = await schema.saveNewVersion()
    expect(savedPath).not.toBe('')
    expectRenamed(await readSaved(savedPath), titleId)

    // Saved: the next load has nothing left to save
    Schema.evict(schemaName)
    const reloaded = (await Schema.create(schemaName)) as Schema
    expect(await reloaded.saveNewVersion()).toBe('')
  }, 60000)
})

testDescribe('Schema.lastSaveError', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
  }, SETUP_HOOK_TIMEOUT_MS)

  it('keeps the ConflictError from a draft save that a rename started', async () => {
    const schemaName = 'Test Schema Last Save Error'
    const now = new Date().toISOString()
    const file: SchemaFileFormat = {
      $schema: 'https://seedprotocol.io/schemas/data-model/v1',
      version: 1,
      id: generateId(),
      metadata: { name: schemaName, createdAt: now, updatedAt: now },
      models: {},
      enums: {},
      migrations: [],
    }
    await importJsonSchema({ contents: JSON.stringify(file) }, file.version)
    const schema = Schema.create(schemaName, { waitForReady: false }) as Schema
    await waitForSchemaIdle(schema)
    // Another writer updates the row after this instance loaded it.
    const db = BaseDb.getAppDb()!
    await db
      .update(schemas)
      .set({ updatedAt: Date.now() + 60_000 })
      .where(eq(schemas.schemaFileId, schema.id!))

    schema.name = 'Test Schema Last Save Error Renamed'

    await vi.waitFor(() => expect(schema.lastSaveError).toBeInstanceOf(ConflictError), { timeout: 10_000 })
  }, 30000)
})
