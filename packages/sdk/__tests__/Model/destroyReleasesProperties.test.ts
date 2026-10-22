import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { importJsonSchema } from '@/imports/json'
import { Model } from '@/Model/Model'
import { ModelProperty } from '@/ModelProperty/ModelProperty'
import { generateId } from '@/helpers'
import type { SchemaFileFormat } from '@/types/import'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'
import { waitUntilOrThrow } from '../test-utils/waitUntil'

/**
 * Model.destroy deletes its properties' rows, so their cached instances go too (G11-9): before,
 * ModelProperty.getById kept returning a destroyed model's properties, bound to deleted rows.
 */

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe
const SCHEMA_NAME = 'Test Schema Model Destroy Releases Properties'

function schemaFile(): SchemaFileFormat {
  const now = new Date().toISOString()
  return {
    $schema: 'https://seedprotocol.org/schemas/data-model/v1',
    version: 1,
    id: generateId(),
    metadata: { name: SCHEMA_NAME, createdAt: now, updatedAt: now },
    models: {
      Base: {
        id: generateId(),
        properties: { title: { id: generateId(), type: 'Text' } },
      },
    },
    enums: {},
    migrations: [],
  } as SchemaFileFormat
}

testDescribe('Model.destroy', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    const file = schemaFile()
    await importJsonSchema({ contents: JSON.stringify(file) }, file.version)
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it('stops its cached properties and drops them from the cache', async () => {
    const model = await Model.create(`Doomed${generateId().slice(0, 8)}`, SCHEMA_NAME, {
      properties: { body: { dataType: 'Text' } },
      waitForReady: true,
    })
    await waitUntilOrThrow(() => model.properties.length > 0, 'the model to list its properties')
    const [property] = model.properties as ModelProperty[]
    const propertyFileId = property.id!
    expect(ModelProperty.getById(propertyFileId)).toBe(property)

    await model.destroy()

    expect(ModelProperty.getById(propertyFileId)).toBeUndefined()
    expect(property.getService().getSnapshot().status).toBe('stopped')
  }, 30000)

  it('also stops a property an app still holds', async () => {
    const model = await Model.create(`DoomedHeld${generateId().slice(0, 8)}`, SCHEMA_NAME, {
      properties: { body: { dataType: 'Text' } },
      waitForReady: true,
    })
    await waitUntilOrThrow(() => model.properties.length > 0, 'the model to list its properties')
    const [owned] = model.properties as ModelProperty[]
    // An app's own hold, as useModelProperty takes
    const held = await ModelProperty.create({
      id: owned.id!,
      name: owned.name!,
      modelName: owned.modelName!,
      dataType: owned.dataType!,
    })
    expect(held).toBe(owned)

    await model.destroy()

    expect(held!.getService().getSnapshot().status).toBe('stopped')
  }, 30000)
})
