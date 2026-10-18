import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Model } from '@/Model/Model'
import { Schema } from '@/Schema/Schema'
import { importJsonSchema } from '@/imports/json'
import { generateId } from '@/helpers'
import type { SchemaFileFormat } from '@/types/import'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'

/**
 * Schema.create and Schema.find each take one hold on the cached instance, released by one unload.
 * A schema is cached under its name and, once loaded, its file id; a hold taken under either is one
 * hold on the instance. SDK code that only looks the schema up (Model and ModelProperty writes,
 * validation) must not take one.
 *
 * A schema holds each model it loads once, and its last unload releases those holds.
 */

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe

testDescribe('Schema cache holds', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  const freshName = () => `Schema Holds ${generateId()}`
  const status = (schema: Schema) => schema.getService().getSnapshot().status

  it("the creator's unload stops a new schema", async () => {
    const schema = await Schema.create(freshName(), { waitForReady: true })
    schema.unload()
    expect(status(schema)).toBe('stopped')
  }, 30000)

  it('two creates need two unloads', async () => {
    const name = freshName()
    const first = await Schema.create(name, { waitForReady: true })
    const second = await Schema.create(name, { waitForReady: true })
    expect(second).toBe(first)

    second.unload()
    expect(status(first)).not.toBe('stopped')
    first.unload()
    expect(status(first)).toBe('stopped')
  }, 30000)

  it('holds taken by name and by file id are released together', async () => {
    const name = freshName()
    const byName = await Schema.create(name, { waitForReady: true })
    const schemaFileId = byName.id
    expect(schemaFileId).toBeTruthy()
    const byId = await Schema.find({ schemaFileId: schemaFileId! })
    expect(byId).toBe(byName)

    byId!.unload()
    expect(status(byName)).not.toBe('stopped')
    byName.unload()
    expect(status(byName)).toBe('stopped')

    // Neither cache may still hand out the stopped instance.
    const again = await Schema.create(name, { waitForReady: true })
    expect(status(again)).not.toBe('stopped')
    const againById = await Schema.find({ schemaFileId: schemaFileId! })
    expect(againById).toBe(again)
    againById!.unload()
    again.unload()
  }, 30000)

  it('creating a model in the schema takes no hold on it', async () => {
    const name = freshName()
    const schema = await Schema.create(name, { waitForReady: true })
    const model = await Model.create('HoldNote', name, {
      properties: { title: { dataType: 'Text' } },
      waitForReady: true,
    })
    model.unload()

    schema.unload()
    expect(status(schema)).toBe('stopped')
  }, 30000)

  const importSchemaWithModel = async () => {
    const name = freshName()
    const modelFileId = generateId()
    const now = new Date().toISOString()
    const file = {
      $schema: 'https://seedprotocol.org/schemas/data-model/v1',
      version: 1,
      id: generateId(),
      metadata: { name, createdAt: now, updatedAt: now },
      models: { HeldNote: { id: modelFileId, properties: { title: { id: generateId(), type: 'Text' } } } },
      enums: {},
      migrations: [],
    } as SchemaFileFormat
    await importJsonSchema({ contents: JSON.stringify(file) }, file.version)
    const schema = await Schema.create(name, { waitForReady: true })
    const [model] = await Model.all(name, { waitForReady: true })
    expect(model.id).toBe(modelFileId)
    return { schema, model, modelFileId }
  }

  it("the schema's last unload releases its models", async () => {
    const { schema, model } = await importSchemaWithModel()

    schema.unload()

    expect(status(schema)).toBe('stopped')
    expect(model.getService().getSnapshot().status).toBe('stopped')
  }, 30000)

  it("a model the caller holds outlives its schema's unload", async () => {
    const { schema, model, modelFileId } = await importSchemaWithModel()
    const held = await Model.find({ modelFileId })
    expect(held).toBe(model)

    schema.unload()
    expect(model.getService().getSnapshot().status).not.toBe('stopped')

    held!.unload()
    expect(model.getService().getSnapshot().status).toBe('stopped')
  }, 30000)
})
