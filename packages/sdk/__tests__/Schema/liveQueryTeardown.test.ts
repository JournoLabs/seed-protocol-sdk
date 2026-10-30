import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { schemas as schemasTable } from '@/seedSchema/SchemaSchema'
import { importJsonSchema } from '@/imports/json'
import { Schema } from '@/Schema/Schema'
import { generateId } from '@/helpers'
import type { SchemaFileFormat } from '@/types/import'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'
import { countLiveQueries, type LiveQueryCounter } from '../test-utils/liveQueryCounter'
import { waitUntilOrThrow } from '../test-utils/waitUntil'

/**
 * In the browser a Schema watches its model links (`model_schemas`) with a liveQuery. Releasing the
 * schema for good (last unload, destroy, evict) must close it. The import loads the schema without a
 * hold, so the test's create is the only one.
 *
 * Browser only: the Node DB's liveQuery is a stub.
 */

const SCHEMA_SQL = /model_schemas/

function schemaFile(name: string): SchemaFileFormat {
  const now = new Date().toISOString()
  return {
    $schema: 'https://seedprotocol.io/schemas/data-model/v1',
    version: 1,
    id: generateId(),
    metadata: { name, createdAt: now, updatedAt: now },
    models: {
      TeardownNote: {
        id: generateId(),
        properties: { title: { id: generateId(), type: 'Text' } },
      },
    },
    enums: {},
    migrations: [],
  } as SchemaFileFormat
}

describe.skipIf(typeof window === 'undefined')('Schema liveQuery teardown', () => {
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

  /** Imports a fresh schema and waits until its liveQuery is subscribed; returns its row id. */
  const importWatchedSchema = async (name: string) => {
    const file = schemaFile(name)
    await importJsonSchema({ contents: JSON.stringify(file) }, file.version)
    const schema = await Schema.create(name, { waitForReady: true })
    const db = BaseDb.getAppDb()!
    const [row] = await db.select({ id: schemasTable.id }).from(schemasTable).where(eq(schemasTable.name, name))
    const filter = { param: row.id, sql: SCHEMA_SQL }
    await waitUntilOrThrow(() => liveQueries.active(filter) > 0, "the schema's liveQuery to be subscribed")
    return { schema, filter }
  }

  const expectClosed = (filter: { param: number; sql: RegExp }) => {
    expect(liveQueries.active(filter), `still open: ${JSON.stringify(liveQueries.activeSql(filter))}`).toBe(0)
  }

  it('the last unload leaves the liveQuery open (a schema stays cached)', async () => {
    const name = `Schema Teardown Unload ${generateId()}`
    const { schema, filter } = await importWatchedSchema(name)
    const held = await Schema.create(name, { waitForReady: true, hold: true })

    held.unload()
    expect(schema.getService().getSnapshot().status).toBe('active')
    expect(liveQueries.active(filter)).toBeGreaterThan(0)
    Schema.evict(name)
  }, 30000)

  it('evict closes the liveQuery', async () => {
    const name = `Schema Teardown Evict ${generateId()}`
    const { schema, filter } = await importWatchedSchema(name)

    Schema.evict(name)

    expect(schema.getService().getSnapshot().status).toBe('stopped')
    expectClosed(filter)
  }, 30000)

  it('destroy closes the liveQuery', async () => {
    const name = `Schema Teardown Destroy ${generateId()}`
    const { schema, filter } = await importWatchedSchema(name)

    await schema.destroy()

    expect(schema.getService().getSnapshot().status).toBe('stopped')
    expectClosed(filter)
  }, 30000)
})
