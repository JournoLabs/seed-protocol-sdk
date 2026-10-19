import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { Item } from '@/Item/Item'
import { ItemProperty } from '@/ItemProperty/ItemProperty'
import { importJsonSchema } from '@/imports/json'
import { generateId } from '@/helpers'
import type { SchemaFileFormat } from '@/types/import'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'
import { countLiveQueries, type LiveQueryCounter, type LiveQueryFilter } from '../test-utils/liveQueryCounter'
import { waitUntilOrThrow } from '../test-utils/waitUntil'

/**
 * In the browser an ItemProperty watches its metadata rows and its property definition with two
 * liveQueries. Releasing the property for good (last unload, destroy) must close both.
 *
 * Browser only: the Node DB's liveQuery is a stub.
 */

const SCHEMA_NAME = 'Test Schema ItemProperty LiveQuery Teardown'
const MODEL_FILE_ID = generateId()

function schemaFile(): SchemaFileFormat {
  const now = new Date().toISOString()
  return {
    $schema: 'https://seedprotocol.org/schemas/data-model/v1',
    version: 1,
    id: generateId(),
    metadata: { name: SCHEMA_NAME, createdAt: now, updatedAt: now },
    models: {
      TeardownPost: {
        id: MODEL_FILE_ID,
        properties: { title: { id: generateId(), type: 'Text' } },
      },
    },
    enums: {},
    migrations: [],
  } as SchemaFileFormat
}

describe.skipIf(typeof window === 'undefined')('ItemProperty liveQuery teardown', () => {
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

  /** The title property's metadata and definition liveQueries. */
  const titleQueries = (seedLocalId: string): LiveQueryFilter[] => [
    { param: [seedLocalId, 'title'], sql: /FROM\s+metadata/ },
    { param: [MODEL_FILE_ID, 'title'], sql: /FROM\s+properties\s+p/ },
  ]

  const openCount = (filters: LiveQueryFilter[]) => filters.reduce((sum, f) => sum + liveQueries.active(f), 0)

  /** Creates an item and waits until its title property has both liveQueries subscribed. */
  const createWatchedTitle = async (title: string) => {
    const item = await Item.create({ modelName: 'TeardownPost', schemaName: SCHEMA_NAME, title } as never)
    const filters = titleQueries(item.seedLocalId)
    await waitUntilOrThrow(
      () => filters.every((f) => liveQueries.active(f) > 0),
      "the title property's liveQueries to be subscribed",
    )
    const property = await ItemProperty.find({ propertyName: 'title', seedLocalId: item.seedLocalId })
    expect(property).toBeDefined()
    return { item, property: property!, filters }
  }

  const expectClosed = (filters: LiveQueryFilter[]) => {
    const open = filters.flatMap((f) => liveQueries.activeSql(f))
    expect(openCount(filters), `still open: ${JSON.stringify(open)}`).toBe(0)
  }

  it('destroy closes both liveQueries', async () => {
    const { item, property, filters } = await createWatchedTitle('destroy')

    await property.destroy()

    expect(property.getService().getSnapshot().status).toBe('stopped')
    expectClosed(filters)
    // The item stays loaded otherwise, and its own new title property would match the next test's
    // definition-query filter (by model and property name, not by item)
    item.unload()
    await new Promise((resolve) => setTimeout(resolve, 300))
    expectClosed(filters)
  }, 30000)

  it('the last unload closes both liveQueries', async () => {
    const { item, property, filters } = await createWatchedTitle('unload')

    // The item and this find each hold the property once
    item.unload()
    property.unload()

    expect(property.getService().getSnapshot().status).toBe('stopped')

    expectClosed(filters)
  }, 30000)
})
