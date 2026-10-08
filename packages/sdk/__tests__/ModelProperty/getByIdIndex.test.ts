import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { importJsonSchema } from '@/imports/json'
import { ModelProperty } from '@/ModelProperty/ModelProperty'
import { generateId } from '@/helpers'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'
import { cleanupTestSchemaData } from '../test-utils/cleanupTestDb'

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe

// ModelProperty.getById looks ids up in an index instead of scanning the instance cache (finding 18
// in docs/TEST_SUITE_PERFORMANCE.md). The index has to follow ids that change and instances that
// leave the cache.
testDescribe('ModelProperty.getById id index', () => {
  const schemaName = `GetById Index ${generateId()}`
  const titleId = generateId()
  const bodyId = generateId()

  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    const schemaFile = {
      $schema: 'https://seedprotocol.org/schemas/data-model/v1',
      version: 1,
      id: generateId(),
      metadata: { name: schemaName, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      models: {
        IndexNote: {
          id: generateId(),
          properties: {
            title: { id: titleId, type: 'Text' },
            body: { id: bodyId, type: 'Text' },
          },
        },
      },
      enums: {},
      migrations: [],
    }
    await importJsonSchema({ contents: JSON.stringify(schemaFile) }, schemaFile.version)
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await cleanupTestSchemaData()
    await teardownTestEnvironment()
  })

  it('finds a cached property by id, and nothing for an unknown id', async () => {
    const title = await ModelProperty.createById(titleId)
    expect(title).toBeDefined()
    expect(ModelProperty.getById(titleId)).toBe(title)
    expect(ModelProperty.getById(generateId())).toBeUndefined()
  })

  it('follows a cached property whose id changes', async () => {
    const body = await ModelProperty.createById(bodyId)
    expect(ModelProperty.getById(bodyId)).toBe(body)

    const newId = generateId()
    body!.getService().send({ type: 'updateContext', id: newId })
    expect(ModelProperty.getById(newId)).toBe(body)
    expect(ModelProperty.getById(bodyId)).toBeUndefined()

    body!.getService().send({ type: 'updateContext', id: bodyId })
    expect(ModelProperty.getById(bodyId)).toBe(body)
    expect(ModelProperty.getById(newId)).toBeUndefined()
  })

  it('drops an evicted property and finds the instance that replaces it', async () => {
    const before = await ModelProperty.createById(titleId)
    expect(ModelProperty.getById(titleId)).toBe(before)

    ModelProperty.evictForModels(['IndexNote'], schemaName)
    expect(ModelProperty.getById(titleId)).toBeUndefined()

    const after = await ModelProperty.createById(titleId)
    expect(after).toBeDefined()
    expect(after).not.toBe(before)
    expect(ModelProperty.getById(titleId)).toBe(after)
  })
})
