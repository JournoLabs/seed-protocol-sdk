import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { importJsonSchema } from '@/imports/json'
import { Schema } from '@/Schema/Schema'
import { BaseDb } from '@/db/Db/BaseDb'
import { schemas as schemasTable } from '@/seedSchema/SchemaSchema'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'
import { WAIT_TIMEOUT_MS } from '../test-utils/timeouts'

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe.skip

const SCHEMA_FILE_ID = 'draft-save-conflict-schema'
const SCHEMA_NAME = 'Draft Save Conflict Schema'

// Regression (audit 1.5): each draft save refreshes _dbUpdatedAt with an updateContext that carries only
// `_` keys. The machine's updateContext guard rejected internal-only events, so the refresh was dropped
// and the next save's conflict check saw the row's newer updatedAt as an external write. The second
// edit failed with "ConflictError: Database was updated externally" and was never saved.
testDescribe('Schema draft saves after load', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it('saves two consecutive edits without a ConflictError', async () => {
    const now = new Date().toISOString()
    await importJsonSchema(
      {
        contents: JSON.stringify({
          $schema: 'https://seedprotocol.io/schemas/data-model/v1',
          version: 1,
          id: SCHEMA_FILE_ID,
          metadata: { name: SCHEMA_NAME, createdAt: now, updatedAt: now },
          models: {
            DraftSaveNote: {
              id: 'draft-save-note-model',
              properties: { title: { id: 'draft-save-note-title', type: 'Text' } },
            },
          },
          enums: {},
          migrations: [],
        }),
      },
      1,
    )

    const db = BaseDb.getAppDb()!
    const savedMigrations = async () => {
      const [row] = await db.select().from(schemasTable).where(eq(schemasTable.schemaFileId, SCHEMA_FILE_ID))
      return JSON.parse(row.schemaData!).migrations
    }

    const schema = (await Schema.create(SCHEMA_NAME)) as any

    schema.migrations = [{ note: 'first' }]
    await vi.waitFor(async () => expect(await savedMigrations()).toEqual([{ note: 'first' }]), {
      timeout: WAIT_TIMEOUT_MS,
    })
    expect(schema.lastSaveError).toBeUndefined()

    // updatedAt is millisecond-resolution; make sure the second save stamps a later time.
    await new Promise((r) => setTimeout(r, 20))

    schema.migrations = [{ note: 'second' }]
    await vi.waitFor(
      async () => {
        expect(schema.lastSaveError).toBeUndefined()
        expect(await savedMigrations()).toEqual([{ note: 'second' }])
      },
      { timeout: WAIT_TIMEOUT_MS },
    )
  }, 60_000)
})
