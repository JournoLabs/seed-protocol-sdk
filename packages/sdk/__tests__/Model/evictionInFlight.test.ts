import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { importJsonSchema } from '@/imports/json'
import { Model } from '@/Model/Model'
import { ModelProperty } from '@/ModelProperty/ModelProperty'
import { Schema } from '@/Schema/Schema'
import { BaseDb } from '@/db/Db/BaseDb'
import { models as modelsTable, properties as propertiesTable } from '@/seedSchema/ModelSchema'
import { modelSchemas } from '@/seedSchema/ModelSchemaSchema'
import { schemas as schemasTable } from '@/seedSchema/SchemaSchema'
import { generateId } from '@/helpers'
import { waitForInFlightWrites } from '@/services/write/actors/writeToDatabase'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'
import { cleanupTestSchemaData } from '../test-utils/cleanupTestDb'

/**
 * Evicting a schema's models (Schema.destroy, test cleanup) stops their actors, but work started
 * before the eviction keeps running: DB lookups that end in Model.create / ModelProperty.create, and
 * a model's property creation. Finishing after the eviction, that work used to put new instances for
 * the evicted schema back in the caches, built from rows about to be deleted; a re-created model then
 * wrote itself again and failed (or re-inserted its row) once the rows were gone (finding 14 in
 * docs/TEST_SUITE_PERFORMANCE.md).
 */
const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe.sequential

const SCHEMA_NAME = 'Test Schema Eviction In Flight'

const importSchema = async () => {
  const schemaFile = {
    $schema: 'https://seedprotocol.org/schemas/data-model/v1',
    version: 1,
    id: generateId(),
    metadata: { name: SCHEMA_NAME, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    models: {
      EvictionNote: {
        id: generateId(),
        properties: { title: { id: generateId(), type: 'Text' } },
      },
    },
    enums: {},
    migrations: [],
  }
  await importJsonSchema({ contents: JSON.stringify(schemaFile) }, schemaFile.version)
}

/** What Schema.destroy and test cleanup do before deleting the rows. */
const evictSchema = () => {
  Schema.evict(SCHEMA_NAME)
  ModelProperty.evictForModels(Model.evictForSchema(SCHEMA_NAME), SCHEMA_NAME)
}

const noteRows = async () => {
  const db = BaseDb.getAppDb()
  const [model] = await db
    .select({ id: modelsTable.id, modelFileId: modelsTable.schemaFileId })
    .from(modelsTable)
    .innerJoin(modelSchemas, eq(modelSchemas.modelId, modelsTable.id))
    .innerJoin(schemasTable, eq(schemasTable.id, modelSchemas.schemaId))
    .where(and(eq(modelsTable.name, 'EvictionNote'), eq(schemasTable.name, SCHEMA_NAME)))
  const [property] = await db
    .select({ propertyFileId: propertiesTable.schemaFileId })
    .from(propertiesTable)
    .where(and(eq(propertiesTable.modelId, model!.id), eq(propertiesTable.name, 'title')))
  return { modelFileId: model!.modelFileId!, propertyFileId: property!.propertyFileId! }
}

/** Cached Model instances of the test schema (no refCount side effects). */
const cachedModels = () => Model.getCachedInstancesForSchema(SCHEMA_NAME)

testDescribe('work in flight when a schema is evicted', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await cleanupTestSchemaData()
    await teardownTestEnvironment()
  })

  it('lookups started before the eviction put nothing back in the caches', async () => {
    await importSchema()
    const { modelFileId, propertyFileId } = await noteRows()
    evictSchema()
    await waitForInFlightWrites()
    expect(cachedModels()).toEqual([])

    // Each of these reads the rows, then creates an instance; the eviction lands in between.
    const lookups = Promise.all([
      Model.createById(modelFileId),
      Model.getByNameAsync('EvictionNote'),
      Model.resolveAsync('EvictionNote', { schemaName: SCHEMA_NAME }),
      Model.createBySchemaId(SCHEMA_NAME),
      ModelProperty.createById(propertyFileId),
    ])
    evictSchema()
    const [byId, byName, resolved, bySchema, property] = await lookups

    expect(byId).toBeUndefined()
    expect(byName).toBeUndefined()
    expect(resolved).toBeUndefined()
    expect(bySchema).toEqual([])
    expect(property).toBeUndefined()
    expect(cachedModels()).toEqual([])
    expect(ModelProperty.getById(propertyFileId)).toBeUndefined()

    // A lookup started after the eviction still finds the model while its rows exist.
    const again = await Model.createById(modelFileId)
    expect(again?.id).toBe(modelFileId)
    const againProperty = await ModelProperty.createById(propertyFileId)
    expect(againProperty?.id).toBe(propertyFileId)

    await cleanupTestSchemaData()
  }, 30000)

  it('a model stopped while creating its properties creates none', async () => {
    await importSchema()
    const model = Model.create('EvictionRuntime', SCHEMA_NAME, {
      properties: { headline: { dataType: 'Text' }, summary: { dataType: 'Text' } },
      waitForReady: false,
    })
    // Evict as soon as the model starts creating its properties (after its own write).
    await new Promise<void>((resolve) => {
      const subscription = model.getService().subscribe((snapshot) => {
        if (snapshot.value !== 'creatingProperties') return
        subscription.unsubscribe()
        evictSchema()
        resolve()
      })
    })
    const modelDbId = model.getService().getSnapshot().context._dbId as number
    expect(modelDbId).toBeGreaterThan(0)
    const propertyFileIds = (
      await BaseDb.getAppDb()
        .select({ id: propertiesTable.schemaFileId })
        .from(propertiesTable)
        .where(eq(propertiesTable.modelId, modelDbId))
    ).map((row: { id: string | null }) => row.id!)
    expect(propertyFileIds).toHaveLength(2)

    // Its property creation was already running; give it time to (not) finish.
    await new Promise((resolve) => setTimeout(resolve, 1000))
    await waitForInFlightWrites()
    for (const id of propertyFileIds) expect(ModelProperty.getById(id)).toBeUndefined()
    expect(cachedModels()).toEqual([])

    await cleanupTestSchemaData()
  }, 30000)

  it('a model stopped before its write starts never writes', async () => {
    await importSchema()
    const modelFileId = generateId()
    const model = Model.create('EvictionUnwritten', SCHEMA_NAME, {
      modelFileId,
      properties: { body: { dataType: 'Text' } },
      waitForReady: false,
    })
    // Stop it the moment it is idle: Model.create's write starts from there, after some DB lookups.
    await new Promise<void>((resolve) => {
      const subscription = model.getService().subscribe((snapshot) => {
        if (snapshot.value !== 'idle') return
        subscription.unsubscribe()
        evictSchema()
        resolve()
      })
    })
    await new Promise((resolve) => setTimeout(resolve, 1000))
    await waitForInFlightWrites()
    const rows = await BaseDb.getAppDb()
      .select({ id: modelsTable.id })
      .from(modelsTable)
      .where(eq(modelsTable.schemaFileId, modelFileId))
    expect(rows).toEqual([])

    await cleanupTestSchemaData()
  }, 30000)

  it('a write still validating when its schema is evicted does not load the schema and its models again', async () => {
    await importSchema()
    const model = Model.create('EvictionValidating', SCHEMA_NAME, {
      properties: { body: { dataType: 'Text' } },
      waitForReady: false,
    })
    // Evict while the model's write validates (validation looks the schema up after an await).
    await new Promise<void>((resolve) => {
      const watch = () => {
        const writeProcess = model.getService().getSnapshot().context.writeProcess
        if (!writeProcess) return false
        const subscription = writeProcess.subscribe((snapshot: { value: unknown }) => {
          if (snapshot.value !== 'validating') return
          subscription.unsubscribe()
          evictSchema()
          resolve()
        })
        return true
      }
      if (watch()) return
      const subscription = model.getService().subscribe(() => {
        if (watch()) subscription.unsubscribe()
      })
    })
    await new Promise((resolve) => setTimeout(resolve, 1500))
    await waitForInFlightWrites()
    expect(cachedModels()).toEqual([])

    await cleanupTestSchemaData()
  }, 30000)
})
