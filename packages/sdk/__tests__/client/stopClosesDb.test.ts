import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { client } from '@/client'
import { BaseDb } from '@/db/Db/BaseDb'
import type { BrowserDb } from '@/browser/db/Db'
import { Item } from '@/Item/Item'
import { ItemProperty } from '@/ItemProperty/ItemProperty'
import { Model } from '@/Model/Model'
import { ModelProperty } from '@/ModelProperty/ModelProperty'
import { Schema } from '@/Schema/Schema'
import { schemas } from '@/seedSchema'
import { setupTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'

const isBrowser = typeof window !== 'undefined'

/**
 * client.stop() closes the database (destroying SQLocal's worker in the browser) and drops cached entities,
 * from any client state, including after an init that failed once the database was open.
 */
describe('client.stop() releases the database', () => {
  let options: Parameters<typeof client.init>[0]

  beforeAll(async () => {
    const initSpy = vi.spyOn(client, 'init')
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    options = initSpy.mock.calls[0][0]
    initSpy.mockRestore()
  }, SETUP_HOOK_TIMEOUT_MS)

  afterEach(async () => {
    vi.restoreAllMocks()
    if (!client.isInitialized()) await client.init(options)
  }, 60000)

  it('closes the database and empties the entity caches; init opens it again', async () => {
    expect(BaseDb.getAppDb()).toBeDefined()
    expect(Schema.cache.size + Model.cache.size).toBeGreaterThan(0)

    await client.stop()

    expect(BaseDb.getAppDb()).toBeUndefined()
    expect(BaseDb.isAppDbReady()).toBe(false)
    for (const cache of [Item.cache, ItemProperty.cache, ModelProperty.cache, Model.cache, Schema.cache]) {
      expect(cache.size).toBe(0)
    }

    await client.init(options)
    expect(await BaseDb.getAppDb()!.select().from(schemas).limit(1)).toBeDefined()
  }, 60000)

  it.skipIf(!isBrowser)("destroys SQLocal's database worker", async () => {
    // Removing seed.db afterwards proves nothing: SQLite's OPFS VFS lets go of an idle file's
    // handle by itself. The worker is what would keep it, and destroy() terminates it.
    const sqlocal = (BaseDb as unknown as { _impl: BrowserDb })._impl.sqlocalInstance!
    const destroy = vi.spyOn(sqlocal, 'destroy')
    await client.stop()
    expect(destroy).toHaveBeenCalledOnce()
  }, 60000)

  it('stops after an init that failed with the database open, and init then succeeds', async () => {
    await client.stop()
    const prepareDb = BaseDb.prepareDb.bind(BaseDb)
    vi.spyOn(BaseDb, 'prepareDb').mockImplementationOnce(async (...args) => {
      await prepareDb(...args)
      throw new Error('init step failed (test)')
    })
    await expect(client.init(options)).rejects.toThrow('init step failed (test)')
    expect(client.isInitialized()).toBe(false)
    expect(BaseDb.getAppDb()).toBeDefined()

    await expect(client.stop()).resolves.toBeUndefined()
    expect(BaseDb.getAppDb()).toBeUndefined()

    await client.init(options)
    expect(client.isInitialized()).toBe(true)
    expect(BaseDb.getAppDb()).toBeDefined()
  }, 60000)
})
