import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { waitFor } from 'xstate'
import { eq } from 'drizzle-orm'
import { importJsonSchema } from '@/imports/json'
import { Model } from '@/Model/Model'
import { Schema } from '@/Schema/Schema'
import { BaseDb } from '@/db/Db/BaseDb'
import { models as modelsTable } from '@/seedSchema/ModelSchema'
import { generateId } from '@/helpers'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'
import { WAIT_TIMEOUT_MS } from '../test-utils/timeouts'

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe

// Regression: Schema.destroy (and cleanupTestSchemaData) evicted the schema's models, which stops their
// actors but can't cancel a writeModelToDb that's already running, then deleted the rows under it. The write
// had inserted its model row but found its schema gone at the join step: "Schema with id N does not exist in
// database. Cannot create join record.", plus an orphan models row. Seen in Model.test.ts, where a test's
// unawaited runtime-model write raced the next test's cleanup.
testDescribe('Schema.destroy with a model write in flight', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it('lets the write finish before deleting the rows', async () => {
    const schemaName = `Destroy In Flight ${generateId()}`
    const schemaFile = {
      $schema: 'https://seedprotocol.io/schemas/data-model/v1',
      version: 1,
      id: generateId(),
      metadata: { name: schemaName, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      models: {},
      enums: {},
      migrations: [],
    }
    await importJsonSchema({ contents: JSON.stringify(schemaFile) }, schemaFile.version)
    const schema = Schema.create(schemaName, { waitForReady: false })
    await waitFor(schema.getService(), (snapshot) => snapshot.value === 'idle', { timeout: 15000 })

    // Definition writes run in a transaction: the first one started is this model's write
    const transaction = vi.spyOn(BaseDb, 'transaction')
    try {
      const model = Model.create('Runtime Article', schema, {
        properties: { body: { dataType: 'Text' } },
        waitForReady: false,
      })
      const modelFileId = model.id!
      // Settles when the model's properties exist, or with why they don't
      const created = Model.create('Runtime Article', schema, { modelFileId }).catch((error: Error) => error)
      await vi.waitFor(() => expect(transaction).toHaveBeenCalled(), { timeout: WAIT_TIMEOUT_MS })

      await schema.destroy()

      // The model was unloaded, so its create fails, but not because its schema row went first
      const outcome = await created
      expect(outcome instanceof Error ? outcome.message : '').not.toContain('does not exist in database')
      const db = BaseDb.getAppDb()!
      const leftover = await db.select().from(modelsTable).where(eq(modelsTable.schemaFileId, modelFileId))
      expect(leftover).toEqual([])
    } finally {
      transaction.mockRestore()
    }
  }, 60000)
})
