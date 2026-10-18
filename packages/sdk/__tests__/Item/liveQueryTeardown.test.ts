import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { Item } from '@/Item/Item'
import { importJsonSchema } from '@/imports/json'
import { generateId } from '@/helpers'
import type { SchemaFileFormat } from '@/types/import'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'
import { countLiveQueries, type LiveQueryCounter } from '../test-utils/liveQueryCounter'
import { waitUntil, waitUntilOrThrow } from '../test-utils/waitUntil'

/**
 * In the browser an Item watches its seed row and its versions with two liveQueries. Releasing the
 * item for good (last unload, destroy, a local purge) must close both; otherwise every item that was
 * ever loaded keeps two reactive queries running, and the versions one keeps creating ItemProperty
 * instances for an item whose actor is stopped.
 *
 * Browser only: the Node DB's liveQuery is a stub and Item skips liveQueries outside a window.
 */

const SCHEMA_NAME = 'Test Schema LiveQuery Teardown'
const ITEM_LIVE_QUERIES = 2
/** The item's own liveQueries; its ItemProperty instances watch metadata with their own. */
const ITEM_LIVE_QUERY_SQL = /FROM\s+(seeds|versions)\s+WHERE/

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

describe.skipIf(typeof window === 'undefined')('Item liveQuery teardown', () => {
  let liveQueries: LiveQueryCounter

  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    const file = schemaFile()
    await importJsonSchema({ contents: JSON.stringify(file) }, file.version)
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

  const createPost = (title: string, options?: { waitForReady?: boolean }) =>
    Item.create({ modelName: 'TeardownPost', schemaName: SCHEMA_NAME, title } as never, options)

  const itemQueries = (seedLocalId: string) => ({ param: seedLocalId, sql: ITEM_LIVE_QUERY_SQL })

  /** Waits until the item's seeds and versions liveQueries are both subscribed. */
  const waitForItemLiveQueries = (seedLocalId: string) =>
    waitUntilOrThrow(
      () => liveQueries.active(itemQueries(seedLocalId)) === ITEM_LIVE_QUERIES,
      `the item's ${ITEM_LIVE_QUERIES} liveQueries to be subscribed`,
    ).catch((error) => {
      const calls = liveQueries.calls(itemQueries(seedLocalId))
      const open = liveQueries.activeSql(itemQueries(seedLocalId))
      throw new Error(`${error.message} (${calls} calls, open: ${JSON.stringify(open)})`)
    })

  const expectNoOpenLiveQueries = (seedLocalId: string) => {
    expect(
      liveQueries.active(itemQueries(seedLocalId)),
      `still open: ${JSON.stringify(liveQueries.activeSql(itemQueries(seedLocalId)))}`,
    ).toBe(0)
  }

  it('the last unload closes the seeds and versions liveQueries', async () => {
    const item = await createPost('unload')
    const seedLocalId = item.seedLocalId
    await waitForItemLiveQueries(seedLocalId)

    item.unload()

    expect(item.getService().getSnapshot().status).toBe('stopped')
    expectNoOpenLiveQueries(seedLocalId)
  }, 30000)

  it('an unload that leaves another holder keeps the liveQueries open', async () => {
    const item = await createPost('shared')
    const seedLocalId = item.seedLocalId
    await waitForItemLiveQueries(seedLocalId)
    const found = await Item.find({ seedLocalId })
    expect(found).toBe(item)

    found!.unload()
    expect(liveQueries.active(itemQueries(seedLocalId))).toBe(ITEM_LIVE_QUERIES)

    item.unload()
    expectNoOpenLiveQueries(seedLocalId)
  }, 30000)

  it('destroy closes the liveQueries', async () => {
    const item = await createPost('destroy')
    const seedLocalId = item.seedLocalId
    await waitForItemLiveQueries(seedLocalId)

    await item.destroy()

    expect(item.getService().getSnapshot().status).toBe('stopped')
    expectNoOpenLiveQueries(seedLocalId)
  }, 30000)

  it('dropCachedInstancesForSeedIds closes the liveQueries', async () => {
    const item = await createPost('purge')
    const seedLocalId = item.seedLocalId
    await waitForItemLiveQueries(seedLocalId)

    Item.dropCachedInstancesForSeedIds([seedLocalId])

    expect(item.getService().getSnapshot().status).toBe('stopped')
    expectNoOpenLiveQueries(seedLocalId)
  }, 30000)

  it('an unload before liveQuery setup finishes leaves no liveQuery open', async () => {
    const item = await createPost('early unload', { waitForReady: false })
    const seedLocalId = item.seedLocalId

    // Setup is async (imports, the initial seed and metadata reads); unload while it runs.
    item.unload()
    expect(item.getService().getSnapshot().status).toBe('stopped')

    // Give setup time to finish. A fixed Item may skip subscribing altogether, so this may time out.
    await waitUntil(() => liveQueries.calls(itemQueries(seedLocalId)) >= ITEM_LIVE_QUERIES, 5000)
    expectNoOpenLiveQueries(seedLocalId)
  }, 30000)
})
