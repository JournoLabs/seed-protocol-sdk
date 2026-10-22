import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Schema } from '@/Schema/Schema'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe

/** A Schema's load: `status` goes from loading to ready, and the loaded fields are in its context. */
testDescribe('Schema load', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it('creates a schema with an unknown name', async () => {
    const schemaName = `test-schema-${Date.now()}`
    const schema = Schema.create(schemaName, { waitForReady: false })
    expect(schema.status).toBe('loading')

    await schema.waitForReady()
    expect(schema.status).toBe('ready')
    expect(schema.schemaName).toBe(schemaName)
    expect(schema.id).toBeDefined()
    schema.unload()
  })

  it('loads an existing schema in a new instance', async () => {
    const schemaName = `test-existing-${Date.now()}`
    const first = await Schema.create(schemaName)
    const schemaFileId = first.id
    first.unload()

    const second = await Schema.create(schemaName)
    expect(second).not.toBe(first)
    expect(second.status).toBe('ready')
    expect(second.id).toBe(schemaFileId)
    expect(second.getService().getSnapshot().context._dbId).toBeDefined()
    second.unload()
  })
})
