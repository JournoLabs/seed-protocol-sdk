import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { importJsonSchema } from '@/imports/json'
import { Model } from '@/Model/Model'
import { Schema } from '@/Schema/Schema'
import { generateId } from '@/helpers'
import type { SchemaFileFormat } from '@/types/import'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'

/**
 * Model.create, Model.find and Model.getById each take one hold on the cached instance, released by
 * one unload. Lookups that don't hand the model to a caller (schema.models, Model.resolve and the
 * other synchronous cache reads) must not take one: a hold nobody releases keeps the model running
 * after its real holders unload it.
 *
 * The models here are created at runtime, so their creator's hold is the only one.
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

  const expectStopped = (model: Model) => {
    expect(model.getService().getSnapshot().status).toBe('stopped')
  }

  it("the creator's unload stops a runtime model", async () => {
    const { model } = await createRuntimeModel()
    model.unload()
    expectStopped(model)
  }, 30000)

  it('Model.getById takes a hold that one unload releases', async () => {
    const { model } = await createRuntimeModel()
    const byId = Model.getById(model.id!)
    expect(byId).toBe(model)

    byId!.unload()
    expect(model.getService().getSnapshot().status).not.toBe('stopped')
    model.unload()
    expectStopped(model)
  }, 30000)

  it('reading schema.models takes no hold', async () => {
    const { model } = await createRuntimeModel()
    const schema = await Schema.create(SCHEMA_NAME, { waitForReady: true })
    for (let i = 0; i < 3; i++) {
      expect(schema.models.map((m) => m.id)).toContain(model.id)
    }
    schema.unload()

    model.unload()
    expectStopped(model)
  }, 30000)

  it('synchronous cache lookups take no hold', async () => {
    const { model, modelName } = await createRuntimeModel()
    expect(Model.resolve(modelName, { modelFileId: model.id })).toBe(model)
    expect(Model.resolve(modelName, { schemaName: SCHEMA_NAME })).toBe(model)
    expect(Model.findByModelType(modelName)).toBe(model)
    expect(Model.getCachedInstancesForSchema(SCHEMA_NAME)).toContain(model)

    model.unload()
    expectStopped(model)
  }, 30000)
})
