import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Item } from '@/Item/Item'
import { importJsonSchema } from '@/imports/json'
import { generateId } from '@/helpers'
import type { SchemaFileFormat } from '@/types/import'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'
import { countChangeWatches } from '../test-utils/changeWatches'
import { waitUntilOrThrow } from '../test-utils/waitUntil'

/**
 * In the browser an Item watches its seed row and its versions through the change feed (ADR 0020),
 * one watch each. Releasing the item for good (last unload, destroy, a local purge) must remove
 * both; otherwise every item that was ever loaded keeps re-reading its rows on every write to them,
 * and the versions read keeps creating ItemProperty instances for an item whose actor is stopped.
 *
 * Browser only: the change feed runs in the browser, and Item skips watching outside a window.
 */

const SCHEMA_NAME = 'Test Schema LiveQuery Teardown'

function schemaFile(): SchemaFileFormat {
  const now = new Date().toISOString()
  return {
    $schema: 'https://seedprotocol.org/schemas/data-model/v1',
    version: 1,
    id: generateId(),
    metadata: { name: SCHEMA_NAME, createdAt: now, updatedAt: now },
    models: {
      TeardownPost: {
        id: generateId(),
        properties: {
          title: { id: generateId(), type: 'Text' },
        },
      },
    },
    enums: {},
    migrations: [],
  } as SchemaFileFormat
}

describe.skipIf(typeof window === 'undefined')('Item watch teardown', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    const file = schemaFile()
    await importJsonSchema({ contents: JSON.stringify(file) }, file.version)
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  const createPost = (title: string, options?: { waitForReady?: boolean }) =>
    Item.create({ modelName: 'TeardownPost', schemaName: SCHEMA_NAME, title } as never, options)

  /** The item's seeds and versions watches; its ItemProperty instances watch metadata with their own. */
  const itemWatches = (seedLocalId: string) =>
    countChangeWatches({ seedLocalId, table: 'seeds' }) + countChangeWatches({ seedLocalId, table: 'versions' })

  /** Waits until the item watches both its seed row and its versions. */
  const waitForItemWatches = (seedLocalId: string) =>
    waitUntilOrThrow(() => itemWatches(seedLocalId) === 2, "the item's seeds and versions watches to be registered")

  const expectNoWatches = (seedLocalId: string) => {
    expect(itemWatches(seedLocalId), 'item watches still registered').toBe(0)
  }

  it('the last unload removes the seeds and versions watches', async () => {
    const item = await createPost('unload')
    const seedLocalId = item.seedLocalId
    await waitForItemWatches(seedLocalId)

    item.unload()

    expect(item.getService().getSnapshot().status).toBe('stopped')
    expectNoWatches(seedLocalId)
  }, 30000)

  it('an unload that leaves another holder keeps the watches', async () => {
    const item = await createPost('shared')
    const seedLocalId = item.seedLocalId
    await waitForItemWatches(seedLocalId)
    const found = await Item.find({ seedLocalId })
    expect(found).toBe(item)

    found!.unload()
    expect(itemWatches(seedLocalId)).toBe(2)

    item.unload()
    expectNoWatches(seedLocalId)
  }, 30000)

  it('destroy removes the watches', async () => {
    const item = await createPost('destroy')
    const seedLocalId = item.seedLocalId
    await waitForItemWatches(seedLocalId)

    await item.destroy()

    expect(item.getService().getSnapshot().status).toBe('stopped')
    expectNoWatches(seedLocalId)
  }, 30000)

  it('dropCachedInstancesForSeedIds removes the watches', async () => {
    const item = await createPost('purge')
    const seedLocalId = item.seedLocalId
    await waitForItemWatches(seedLocalId)

    Item.dropCachedInstancesForSeedIds([seedLocalId])

    expect(item.getService().getSnapshot().status).toBe('stopped')
    expectNoWatches(seedLocalId)
  }, 30000)

  it('an unload before watch setup finishes leaves no watch', async () => {
    const item = await createPost('early unload', { waitForReady: false })
    const seedLocalId = item.seedLocalId

    // Setup is async (imports, the initial seed and metadata reads); unload while it runs.
    item.unload()
    expect(item.getService().getSnapshot().status).toBe('stopped')

    // Give setup time to finish: it skips watching once it sees the stopped actor.
    await new Promise((resolve) => setTimeout(resolve, 1000))
    expectNoWatches(seedLocalId)
  }, 30000)
})
