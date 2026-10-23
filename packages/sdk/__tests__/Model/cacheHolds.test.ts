import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { importJsonSchema } from '@/imports/json'
import { Model } from '@/Model/Model'
import { Schema } from '@/Schema/Schema'
import { generateId } from '@/helpers'
import type { SchemaFileFormat } from '@/types/import'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'

/**
 * Model lookups take a hold only with `hold: true`, released by one unload. Lookups that don't
 * hand the model to a caller (schema.models, Model.resolve and the other synchronous cache reads)
 * never take one. A model stays cached when its last hold goes; eviction or destroy stops it.
 *
 * The models here are created at runtime, so no schema holds them.
 */

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe
const SCHEMA_NAME = 'Test Schema Model Cache Holds'

function schemaFile(): SchemaFileFormat {
  const now = new Date().toISOString()
  return {
    $schema: 'https://seedprotocol.org/schemas/data-model/v1',
    version: 1,
    id: generateId(),
    metadata: { name: SCHEMA_NAME, createdAt: now, updatedAt: now },
    models: {
      HoldBase: {
        id: generateId(),
        properties: { title: { id: generateId(), type: 'Text' } },
      },
    },
    enums: {},
    migrations: [],
  } as SchemaFileFormat
}

testDescribe('Model cache holds', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    const file = schemaFile()
    await importJsonSchema({ contents: JSON.stringify(file) }, file.version)
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  const createRuntimeModel = async () => {
    const modelName = `HoldRuntime${generateId().slice(0, 8)}`
    const model = await Model.create(modelName, SCHEMA_NAME, {
      properties: { body: { dataType: 'Text' } },
      waitForReady: true,
    })
    return { model, modelName }
  }

  const refCount = (model: Model) => Model.cache.entryOf(model)?.refCount

  it("a runtime model stays cached after its creator's unload", async () => {
    const { model, modelName } = await createRuntimeModel()
    expect(refCount(model)).toBe(0)
    model.unload()
    expect(model.getService().getSnapshot().status).toBe('active')
    expect(Model.peekByName(modelName, SCHEMA_NAME)).toBe(model)
  }, 30000)

  it('Model.getById takes a hold with hold: true, released by one unload', async () => {
    const { model } = await createRuntimeModel()
    expect(Model.getById(model.id!)).toBe(model)
    expect(refCount(model)).toBe(0)

    const byId = Model.getById(model.id!, { hold: true })
    expect(byId).toBe(model)
    expect(refCount(model)).toBe(1)
    byId!.unload()
    expect(refCount(model)).toBe(0)
  }, 30000)

  it('reading schema.models takes no hold', async () => {
    const { model } = await createRuntimeModel()
    const schema = await Schema.create(SCHEMA_NAME, { waitForReady: true })
    for (let i = 0; i < 3; i++) {
      expect(schema.models.map((m) => m.id)).toContain(model.id)
    }
    expect(refCount(model)).toBe(0)
  }, 30000)

  it('synchronous cache lookups take no hold', async () => {
    const { model, modelName } = await createRuntimeModel()
    expect(Model.resolve(modelName, { modelFileId: model.id })).toBe(model)
    expect(Model.resolve(modelName, { schemaName: SCHEMA_NAME })).toBe(model)
    expect(Model.findByModelType(modelName)).toBe(model)
    expect(Model.getCachedInstancesForSchema(SCHEMA_NAME)).toContain(model)
    expect(refCount(model)).toBe(0)
  }, 30000)
})
