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
      $schema: 'https://seedprotocol.org/schemas/data-model/v1',
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

    const consoleError = vi.spyOn(console, 'error')
    try {
      const model = Model.create('Runtime Article', schema, {
        properties: { body: { dataType: 'Text' } },
        waitForReady: false,
      })
      const modelFileId = model.id!
      const writeProcess = (
        await waitFor(model.getService(), (snapshot) => !!snapshot.context.writeProcess, { timeout: 10000 })
      ).context.writeProcess!
      await waitFor(writeProcess, (snapshot) => snapshot.value === 'writing', { timeout: 10000 })

      await schema.destroy()

      const writeErrors = consoleError.mock.calls
        .map((args) => String(args[0]))
        .filter((message) => message.includes('Write error'))
      expect(writeErrors).toEqual([])
      const db = BaseDb.getAppDb()!
      const leftover = await db.select().from(modelsTable).where(eq(modelsTable.schemaFileId, modelFileId))
      expect(leftover).toEqual([])
    } finally {
      consoleError.mockRestore()
    }
  }, 60000)
})
