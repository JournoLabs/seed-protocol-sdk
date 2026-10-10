import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { eq, inArray, ne } from 'drizzle-orm'
import { importJsonSchema } from '@/imports/json'
import { Item } from '@/Item/Item'
import { Model } from '@/Model/Model'
import { BaseDb } from '@/db/Db/BaseDb'
import { BaseFileManager, generateId } from '@/helpers'
import { SEED_PROTOCOL_SCHEMA_NAME } from '@/helpers/constants'
import { schemas as schemasTable } from '@/seedSchema/SchemaSchema'
import { models as modelsTable } from '@/seedSchema/ModelSchema'
import { seeds } from '@/seedSchema/SeedSchema'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../../test-utils/client-init'
import { waitForIdle } from '../../test-utils/waitForIdle'

/**
 * Browser test files on one worker share OPFS, so what a file leaves in the database is what the
 * next file's client.init loads: its schemas, their Model/ModelProperty instances and the work they
 * start (finding 14 in docs/TEST_SUITE_PERFORMANCE.md). teardownTestEnvironment used to delete only
 * the schema files; it now removes the file's test schema rows and items too.
 */
describe.skipIf(typeof window === 'undefined')('teardownTestEnvironment in the browser', () => {
  const schemaName = `Test Schema Teardown ${generateId()}`

  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it("removes the file's test schemas, models, items, cached models and schema files", async () => {
    const schemaFile = {
      $schema: 'https://seedprotocol.org/schemas/data-model/v1',
      version: 1,
      id: generateId(),
      metadata: { name: schemaName, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      models: {
        TeardownNote: { id: generateId(), properties: { title: { id: generateId(), type: 'Text' } } },
      },
      enums: {},
      migrations: [],
    }
    await importJsonSchema({ contents: JSON.stringify(schemaFile) }, schemaFile.version)
    const item = await Item.create({ modelName: 'TeardownNote', schemaName, title: 'left behind?' } as any)
    await waitForIdle(item, 'Item', 15000)

    const db = BaseDb.getAppDb()
    const testSchemas = () => db.select({ name: schemasTable.name }).from(schemasTable).where(ne(schemasTable.name, SEED_PROTOCOL_SCHEMA_NAME))
    const testModels = () => db.select({ id: modelsTable.id }).from(modelsTable).where(eq(modelsTable.name, 'TeardownNote'))
    const itemSeeds = () => db.select({ localId: seeds.localId }).from(seeds).where(inArray(seeds.localId, [item.seedLocalId]))
    const schemaFiles = async () =>
      (await BaseFileManager.listFiles(BaseFileManager.getWorkingDir())).filter((name) => name.includes(schemaFile.id))
    expect((await testSchemas()).map((r: { name: string | null }) => r.name)).toContain(schemaName)
    expect(await testModels()).toHaveLength(1)
    expect(await itemSeeds()).toHaveLength(1)

    await teardownTestEnvironment()

    expect(await testSchemas()).toEqual([])
    expect(await testModels()).toEqual([])
    expect(await itemSeeds()).toEqual([])
    expect(Model.getCachedInstancesForSchema(schemaName)).toEqual([])
    expect(await schemaFiles()).toEqual([])
  }, 60000)
})
