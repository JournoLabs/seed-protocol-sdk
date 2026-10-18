import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { models as modelsTable } from '@/seedSchema/ModelSchema'
import { importJsonSchema } from '@/imports/json'
import { Model } from '@/Model/Model'
import { Schema } from '@/Schema/Schema'
import { generateId } from '@/helpers'
import type { SchemaFileFormat } from '@/types/import'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'
import { countLiveQueries, type LiveQueryCounter } from '../test-utils/liveQueryCounter'
import { waitUntilOrThrow } from '../test-utils/waitUntil'

/**
 * In the browser a Model watches its property rows with a liveQuery. Releasing the model for good
 * (last unload, destroy, its schema's eviction or destruction) must close it. A model its schema
 * loaded is held by the schema, so the unload test uses a model created at runtime.
 *
 * Browser only: the Node DB's liveQuery is a stub.
 */

const MODEL_SQL = /FROM\s+properties\s+WHERE\s+model_id/

function schemaFile(name: string, modelFileId: string): SchemaFileFormat {
  const now = new Date().toISOString()
  return {
    $schema: 'https://seedprotocol.org/schemas/data-model/v1',
    version: 1,
    id: generateId(),
    metadata: { name, createdAt: now, updatedAt: now },
    models: {
      TeardownNote: {
        id: modelFileId,
        properties: { title: { id: generateId(), type: 'Text' } },
      },
    },
    enums: {},
    migrations: [],
  } as SchemaFileFormat
}

describe.skipIf(typeof window === 'undefined')('Model liveQuery teardown', () => {
  let liveQueries: LiveQueryCounter

  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  beforeEach(() => {
    liveQueries = countLiveQueries()
  })

  afterEach(() => {
    liveQueries.restore()
  })

  /** Imports a fresh schema and waits until its model's liveQuery is subscribed. */
  const importWatchedModel = async (schemaName: string) => {
    const modelFileId = generateId()
    const file = schemaFile(schemaName, modelFileId)
    await importJsonSchema({ contents: JSON.stringify(file) }, file.version)
    const [model] = await Model.all(schemaName, { waitForReady: true })
    const db = BaseDb.getAppDb()!
    const rowId = await vi.waitUntil(
      async () =>
        (await db.select({ id: modelsTable.id }).from(modelsTable).where(eq(modelsTable.schemaFileId, modelFileId)))[0]?.id,
      { timeout: 15000 },
    )
    const filter = { param: rowId, sql: MODEL_SQL }
    await waitUntilOrThrow(() => liveQueries.active(filter) > 0, "the model's liveQuery to be subscribed")
    return { model, filter }
  }

  const expectClosed = (filter: { param: number; sql: RegExp }) => {
    expect(liveQueries.active(filter), `still open: ${JSON.stringify(liveQueries.activeSql(filter))}`).toBe(0)
  }

  it('the last unload closes the liveQuery of a runtime model', async () => {
    const schemaName = `Model Teardown Unload ${generateId()}`
    const { filter: schemaModelFilter } = await importWatchedModel(schemaName)
    const model = await Model.create(`Runtime${generateId().slice(0, 6)}`, schemaName, {
      properties: { body: { dataType: 'Text' } },
      waitForReady: true,
    })
    const db = BaseDb.getAppDb()!
    const rowId = await vi.waitUntil(
      async () =>
        (await db.select({ id: modelsTable.id }).from(modelsTable).where(eq(modelsTable.schemaFileId, model.id!)))[0]?.id,
      { timeout: 15000 },
    )
    const filter = { param: rowId, sql: MODEL_SQL }
    await waitUntilOrThrow(() => liveQueries.active(filter) > 0, "the model's liveQuery to be subscribed")

    model.unload()

    expect(model.getService().getSnapshot().status).toBe('stopped')
    expectClosed(filter)
    expect(liveQueries.active(schemaModelFilter)).toBeGreaterThan(0)
    Schema.evict(schemaName)
  }, 30000)

  it('destroy closes the liveQuery', async () => {
    const schemaName = `Model Teardown Destroy ${generateId()}`
    const { model, filter } = await importWatchedModel(schemaName)

    await model.destroy()

    expect(model.getService().getSnapshot().status).toBe('stopped')
    expectClosed(filter)
    Schema.evict(schemaName)
  }, 30000)

  it("evicting its schema's models closes the liveQuery", async () => {
    const schemaName = `Model Teardown Evict ${generateId()}`
    const { model, filter } = await importWatchedModel(schemaName)

    Model.evictForSchema(schemaName)

    expect(model.getService().getSnapshot().status).toBe('stopped')
    expectClosed(filter)
    Schema.evict(schemaName)
  }, 30000)

  it('destroying its schema closes the liveQuery', async () => {
    const schemaName = `Model Teardown Schema Destroy ${generateId()}`
    const { model, filter } = await importWatchedModel(schemaName)

    await (await Schema.create(schemaName, { waitForReady: true })).destroy()

    expect(model.getService().getSnapshot().status).toBe('stopped')
    expectClosed(filter)
  }, 30000)
})
