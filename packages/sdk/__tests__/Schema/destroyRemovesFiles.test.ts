import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { importJsonSchema } from '@/imports/json'
import { Schema } from '@/Schema/Schema'
import { generateId } from '@/helpers'
import { listCompleteSchemaFiles } from '@/helpers/schema'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe

// Schema.destroy deletes the schema's files, since loadAllSchemasFromDb imports any schema file
// without a DB row. Versions imported from complete schema files can each have their own id, so
// matching files on the destroyed row's id alone left the older versions to bring it back.
testDescribe('Schema.destroy removes every version file', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it('a multi-word schema with versions under different ids stays destroyed', async () => {
    // Spaces become underscores in the file name: {id}_Destroy_Files_{suffix}_v{n}.json
    const schemaName = `Destroy Files ${generateId()}`
    const schemaFile = (version: number) => ({
      $schema: 'https://seedprotocol.org/schemas/data-model/v1',
      version,
      id: generateId(),
      metadata: { name: schemaName, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      models: {},
      enums: {},
      migrations: [],
    })
    const filesNamed = async () => (await listCompleteSchemaFiles()).filter((f) => f.name === schemaName)

    await importJsonSchema({ contents: JSON.stringify(schemaFile(1)) }, 1)
    await importJsonSchema({ contents: JSON.stringify(schemaFile(2)) }, 2)
    expect((await filesNamed()).map((f) => f.version).sort()).toEqual([1, 2])

    const schema = await Schema.create(schemaName, { waitForReady: true })
    expect(schema.getService().getSnapshot().context.version).toBe(2)
    await schema.destroy()

    expect(await filesNamed()).toEqual([])
    const all = await Schema.all()
    expect(all.map((s) => s.schemaName)).not.toContain(schemaName)
  }, 60000)
})
