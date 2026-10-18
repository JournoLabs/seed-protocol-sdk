import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { importJsonSchema } from '@/imports/json'
import { ModelProperty } from '@/ModelProperty/ModelProperty'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { generateId } from '@/helpers'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'
import { WAIT_TIMEOUT_MS } from '../test-utils/timeouts'

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe

// Regression: a ModelProperty looked up its schema name with this.modelId, which is never assigned, so
// it always fell back to reading and parsing every schema file in the working dir. Importing a schema
// with many properties spent seconds on that after the import returned.
testDescribe('ModelProperty schema name lookup', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    vi.restoreAllMocks()
    await teardownTestEnvironment()
  })

  it('resolves the schema name from the DB without reading schema files', async () => {
    const schemaName = `Schema Name Lookup ${generateId()}`
    const titleId = generateId()
    const schemaFile = {
      $schema: 'https://seedprotocol.org/schemas/data-model/v1',
      version: 1,
      id: generateId(),
      metadata: { name: schemaName, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      models: {
        Note: { id: generateId(), properties: { title: { id: titleId, type: 'Text' } } },
      },
      enums: {},
      migrations: [],
    }
    await importJsonSchema({ contents: JSON.stringify(schemaFile) }, schemaFile.version)

    // Drop the cached instance so createById builds a new one from the DB row, without a schema name.
    ModelProperty.evictForModels(['Note'], schemaName)
    const readFile = vi.spyOn(BaseFileManager, 'readFileAsString')

    const property = await ModelProperty.createById(titleId)
    expect(property).toBeDefined()
    await vi.waitFor(() => expect(property!._getSnapshotContext()._schemaName).toBe(schemaName), { timeout: WAIT_TIMEOUT_MS })
    expect(readFile).not.toHaveBeenCalled()
  })
})
