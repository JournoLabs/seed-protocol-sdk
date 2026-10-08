import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { models as modelsTable, properties as propertiesTable } from '@/seedSchema/ModelSchema'
import { modelSchemas } from '@/seedSchema/ModelSchemaSchema'
import { schemas as schemasTable } from '@/seedSchema/SchemaSchema'
import { importJsonSchema } from '@/imports/json'
import { AmbiguousModelError } from '@/Model/errors'
import { generateId } from '@/helpers'
import { getItemStoragePropertiesForModel, getPropertyIdForModelAndName } from '@/helpers/db'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'

/**
 * Sync passes a seed's EAS model type (the snake_case model name) to these helpers. A model whose
 * name has spaces ("Spaced Lookup Model", type `spaced_lookup_model`) must resolve too; it used to be
 * looked up as upperFirst(camelCase(type)) = "SpacedLookupModel", which matches no model.
 */
const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe

// Unique per file: browser test files in one worker share a DB.
const MODEL_NAME = 'Spaced Lookup Model'
const MODEL_TYPE = 'spaced_lookup_model'

const schemaFile = (schemaName: string) => ({
  $schema: 'https://seedprotocol.org/schemas/data-model/v1',
  version: 1,
  id: generateId(),
  metadata: { name: schemaName, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  models: {
    [MODEL_NAME]: {
      id: generateId(),
      properties: {
        title: { id: generateId(), type: 'Text' },
        body: {
          id: generateId(),
          type: 'Text',
          storage: { type: 'ItemStorage', path: '/spaced-body', extension: '.html' },
        },
      },
    },
  },
  enums: {},
  migrations: [],
})

const propertyIdIn = async (schemaName: string, propertyName: string): Promise<number> => {
  const rows = await BaseDb.getAppDb()
    .select({ id: propertiesTable.id })
    .from(propertiesTable)
    .innerJoin(modelsTable, eq(propertiesTable.modelId, modelsTable.id))
    .innerJoin(modelSchemas, eq(modelSchemas.modelId, modelsTable.id))
    .innerJoin(schemasTable, eq(modelSchemas.schemaId, schemasTable.id))
    .where(
      and(
        eq(modelsTable.name, MODEL_NAME),
        eq(schemasTable.name, schemaName),
        eq(propertiesTable.name, propertyName),
      ),
    )
  expect(rows).toHaveLength(1)
  return rows[0].id
}

testDescribe('model lookups by EAS model type for names with spaces', () => {
  const suffix = generateId()
  const schemaA = schemaFile(`Spaced Lookup A ${suffix}`)
  const schemaB = schemaFile(`Spaced Lookup B ${suffix}`)

  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    await importJsonSchema({ contents: JSON.stringify(schemaA) }, schemaA.version)
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it('getPropertyIdForModelAndName resolves the model from its type (and still from its name)', async () => {
    const titleId = await propertyIdIn(schemaA.metadata.name, 'title')
    expect(await getPropertyIdForModelAndName(MODEL_TYPE, 'title')).toBe(titleId)
    expect(await getPropertyIdForModelAndName(MODEL_NAME, 'title')).toBe(titleId)
  })

  it('getItemStoragePropertiesForModel resolves the model from its type', async () => {
    const stored = await getItemStoragePropertiesForModel(MODEL_TYPE)
    expect(stored.map((p) => p.name)).toEqual(['body'])
    expect(stored[0].localStorageDir).toBe('/spaced-body')
  })

  it('a type defined by models in two schemas is ambiguous by type alone, like by name', async () => {
    await importJsonSchema({ contents: JSON.stringify(schemaB) }, schemaB.version)

    await expect(getPropertyIdForModelAndName(MODEL_TYPE, 'title')).rejects.toBeInstanceOf(AmbiguousModelError)
    await expect(getPropertyIdForModelAndName(MODEL_NAME, 'title')).rejects.toBeInstanceOf(AmbiguousModelError)
    await expect(getItemStoragePropertiesForModel(MODEL_TYPE)).rejects.toBeInstanceOf(AmbiguousModelError)

    // A scope picks one.
    expect(
      await getPropertyIdForModelAndName(MODEL_TYPE, 'title', { schemaName: schemaB.metadata.name }),
    ).toBe(await propertyIdIn(schemaB.metadata.name, 'title'))
    expect(
      await getPropertyIdForModelAndName(MODEL_TYPE, 'title', { modelFileId: schemaA.models[MODEL_NAME].id }),
    ).toBe(await propertyIdIn(schemaA.metadata.name, 'title'))
  })
})
