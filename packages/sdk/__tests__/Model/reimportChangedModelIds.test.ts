import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { models as modelsTable, properties as propertiesTable } from '@/seedSchema/ModelSchema'
import { modelSchemas } from '@/seedSchema/ModelSchemaSchema'
import { schemas as schemasTable } from '@/seedSchema/SchemaSchema'
import { importJsonSchema } from '@/imports/json'
import { Model } from '@/Model/Model'
import { generateId } from '@/helpers'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'
import { waitForModelIdle } from '../test-utils/waitForIdle'

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe

const MODEL_NAME = 'ReimportIdPost'

const buildSchemaFile = (schemaName: string) => ({
  $schema: 'https://seedprotocol.org/schemas/data-model/v1',
  version: 1,
  id: generateId(),
  metadata: { name: schemaName, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  models: {
    [MODEL_NAME]: {
      id: generateId(),
      properties: { title: { id: generateId(), type: 'Text' } },
    },
  },
  enums: {},
  migrations: [],
})

/** Deletes a schema's rows directly, leaving its Model instances cached (no eviction). */
async function deleteSchemaRows(schemaName: string): Promise<void> {
  const db = BaseDb.getAppDb()!
  const schemaRows = await db.select({ id: schemasTable.id }).from(schemasTable).where(eq(schemasTable.name, schemaName))
  const schemaIds = schemaRows.map((r: { id: number }) => r.id)
  const modelIds = (
    await db.select({ modelId: modelSchemas.modelId }).from(modelSchemas).where(inArray(modelSchemas.schemaId, schemaIds))
  ).map((r: { modelId: number }) => r.modelId)
  await db.delete(modelSchemas).where(inArray(modelSchemas.schemaId, schemaIds))
  await db.delete(propertiesTable).where(inArray(propertiesTable.modelId, modelIds))
  await db.delete(modelsTable).where(inArray(modelsTable.id, modelIds))
  await db.delete(schemasTable).where(inArray(schemasTable.id, schemaIds))
}

// Regression: a schema re-imported under the same name with new model ids, while the previous
// import's Model instances were still cached by name, got the old instances back from Model.create
// (name cache hit despite a different modelFileId). The DB held the new ids, the Model the old one,
// so items were created under an id no models row has and lists scoped by the new id came back empty.
testDescribe('re-importing a schema whose model ids changed', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it('Model.create returns a model with the requested new id, not the stale cached one', async () => {
    const schemaName = `Reimport Changed Ids ${generateId()}`
    const first = buildSchemaFile(schemaName)
    const oldId = first.models[MODEL_NAME].id
    await importJsonSchema({ contents: JSON.stringify(first) }, first.version)
    const oldModel = Model.create(MODEL_NAME, schemaName, { modelFileId: oldId, waitForReady: false }) as Model
    await waitForModelIdle(oldModel)
    expect(oldModel.id).toBe(oldId)

    await deleteSchemaRows(schemaName)

    const second = buildSchemaFile(schemaName)
    const newId = second.models[MODEL_NAME].id
    expect(newId).not.toBe(oldId)
    await importJsonSchema({ contents: JSON.stringify(second) }, second.version)

    const newModel = Model.create(MODEL_NAME, schemaName, { modelFileId: newId, waitForReady: false }) as Model
    await waitForModelIdle(newModel)
    expect(newModel.id).toBe(newId)
    expect(Model.getByName(MODEL_NAME, schemaName)?.id).toBe(newId)

    const db = BaseDb.getAppDb()!
    const rows = await db
      .select({ schemaFileId: modelsTable.schemaFileId })
      .from(modelsTable)
      .innerJoin(modelSchemas, eq(modelSchemas.modelId, modelsTable.id))
      .innerJoin(schemasTable, eq(schemasTable.id, modelSchemas.schemaId))
      .where(eq(schemasTable.name, schemaName))
    expect(rows.map((r: { schemaFileId: string | null }) => r.schemaFileId)).toEqual([newId])
  })
})
