import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Model } from '@/Model/Model'
import { Schema } from '@/Schema/Schema'
import { importJsonSchema } from '@/imports/json'
import { generateId } from '@/helpers'
import type { SchemaFileFormat } from '@/types/import'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'

/**
 * Schema lookups take a hold only with `hold: true`, released by one unload. A schema is cached
 * under its name and, once loaded, its file id; a hold taken under either is one hold on the
 * instance. A schema stays cached when its last hold goes; eviction or destroy stops it.
 *
 * A schema holds each model it loads once; evicting the schema releases those holds, and a model
 * no one else holds stops with it.
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

  const refCount = (schema: Schema) => Schema.cache.entryOf(schema)?.refCount

  it('create takes no hold unless hold: true', async () => {
    const schema = await Schema.create(freshName(), { waitForReady: true })
    expect(refCount(schema)).toBe(0)
    const held = await Schema.create(schema.schemaName!, { waitForReady: true, hold: true })
    expect(held).toBe(schema)
    expect(refCount(schema)).toBe(1)
    held.unload()
    expect(refCount(schema)).toBe(0)
  }, 30000)

  it('the last unload keeps a schema running; eviction stops it', async () => {
    const name = freshName()
    const first = await Schema.create(name, { waitForReady: true, hold: true })
    const second = await Schema.create(name, { waitForReady: true, hold: true })
    expect(second).toBe(first)

    second.unload()
    first.unload()
    expect(status(first)).toBe('active')
    expect(Schema.peek(name)).toBe(first)

    Schema.evict(name)
    expect(status(first)).toBe('stopped')
    expect(Schema.peek(name)).toBeUndefined()
  }, 30000)

  it('holds taken by name and by file id are holds on one instance', async () => {
    const name = freshName()
    const byName = await Schema.create(name, { waitForReady: true, hold: true })
    const schemaFileId = byName.id
    expect(schemaFileId).toBeTruthy()
    const byId = await Schema.find({ schemaFileId: schemaFileId!, hold: true })
    expect(byId).toBe(byName)
    expect(refCount(byName)).toBe(2)

    byId!.unload()
    byName.unload()
    expect(refCount(byName)).toBe(0)

    // After an eviction, neither key hands out the stopped instance
    Schema.evict(name)
    const again = await Schema.create(name, { waitForReady: true })
    expect(status(again)).toBe('active')
    expect(await Schema.find({ schemaFileId: schemaFileId! })).toBe(again)
  }, 30000)

  it('creating a model in the schema takes no hold on it', async () => {
    const name = freshName()
    const schema = await Schema.create(name, { waitForReady: true })
    await Model.create('HoldNote', name, {
      properties: { title: { dataType: 'Text' } },
      waitForReady: true,
    })
    expect(refCount(schema)).toBe(0)
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
    return { name, schema, model, modelFileId }
  }

  it('evicting a schema stops the models only it holds', async () => {
    const { name, schema, model } = await importSchemaWithModel()
    expect(Model.cache.entryOf(model)?.refCount).toBe(1)

    Schema.evict(name)

    expect(status(schema)).toBe('stopped')
    expect(model.getService().getSnapshot().status).toBe('stopped')
  }, 30000)

  it("a model the caller holds outlives its schema's eviction", async () => {
    const { name, schema, model, modelFileId } = await importSchemaWithModel()
    const held = await Model.find({ modelFileId, hold: true })
    expect(held).toBe(model)

    Schema.evict(name)
    expect(status(schema)).toBe('stopped')
    expect(model.getService().getSnapshot().status).toBe('active')

    // Its last hold going keeps it cached too
    held!.unload()
    expect(model.getService().getSnapshot().status).toBe('active')
    Model.evictForSchema(name)
    expect(model.getService().getSnapshot().status).toBe('stopped')
  }, 30000)
})
