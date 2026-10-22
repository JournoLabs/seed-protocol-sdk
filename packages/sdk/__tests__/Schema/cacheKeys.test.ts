import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Schema } from '@/Schema/Schema'
import { generateId } from '@/helpers'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'
import { waitUntilOrThrow } from '../test-utils/waitUntil'

/**
 * A schema is cached under its file id and its current name (G13-6). Before, a rename left the
 * cache on the old name, so `Schema.create(new)` loaded a second instance for the same row, and an
 * instance created again after an unload never got its id key, so lookups by id missed it.
 */

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe

testDescribe('Schema cache keys', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  const freshName = () => `Schema Keys ${generateId()}`

  it('a rename moves the name key', async () => {
    const oldName = freshName()
    const newName = freshName()
    const schema = await Schema.create(oldName, { waitForReady: true })

    schema.name = newName
    await waitUntilOrThrow(() => schema.schemaName === newName, 'the rename to apply')

    const byNewName = await Schema.create(newName, { waitForReady: true })
    expect(byNewName).toBe(schema)
    expect(Schema.peek(oldName)).toBeUndefined()

    byNewName.unload()
    expect(schema.getService().getSnapshot().status).not.toBe('stopped')
    schema.unload()
    expect(schema.getService().getSnapshot().status).toBe('stopped')
  }, 30000)

  it('a schema created again after an unload is cached under its id', async () => {
    const name = freshName()
    const first = await Schema.create(name, { waitForReady: true })
    const schemaFileId = first.id!
    expect(Schema.peek(schemaFileId)).toBe(first)
    first.unload()
    expect(Schema.peek(schemaFileId)).toBeUndefined()

    const second = await Schema.create(name, { waitForReady: true })
    expect(second).not.toBe(first)
    expect(second.id).toBe(schemaFileId)
    expect(Schema.peek(schemaFileId)).toBe(second)
    second.unload()
  }, 30000)
})
