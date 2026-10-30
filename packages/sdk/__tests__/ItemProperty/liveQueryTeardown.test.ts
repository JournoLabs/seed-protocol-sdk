import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { Item } from '@/Item/Item'
import { ItemProperty } from '@/ItemProperty/ItemProperty'
import { importJsonSchema } from '@/imports/json'
import { generateId } from '@/helpers'
import type { SchemaFileFormat } from '@/types/import'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'
import { countLiveQueries, type LiveQueryCounter } from '../test-utils/liveQueryCounter'
import { activeChangeWatches } from '@/browser/db/changeFeed'
import { waitUntilOrThrow } from '../test-utils/waitUntil'

/**
 * In the browser an ItemProperty watches its metadata rows through the change feed (ADR 0020) and
 * its property definition with a liveQuery. Releasing the property for good (last unload, destroy)
 * must close both.
 *
 * Browser only: the Node DB's liveQuery is a stub.
 */

const SCHEMA_NAME = 'Test Schema ItemProperty LiveQuery Teardown'
const MODEL_FILE_ID = generateId()

function schemaFile(): SchemaFileFormat {
  const now = new Date().toISOString()
  return {
    $schema: 'https://seedprotocol.io/schemas/data-model/v1',
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

describe.skipIf(typeof window === 'undefined')('ItemProperty watch teardown', () => {
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

  /** The title property's definition liveQuery. */
  const definitionQuery = { param: [MODEL_FILE_ID, 'title'], sql: /FROM\s+properties\s+p/ }
  /** Feed watches on the title property's metadata rows. */
  const metadataWatches = (seedLocalId: string) =>
    activeChangeWatches().filter(
      (w) => w.seedLocalId === seedLocalId && w.tables.includes('metadata') && w.propertyNames?.includes('title'),
    ).length

  /** Creates an item and waits until its title property watches both its rows and its definition. */
  const createWatchedTitle = async (title: string) => {
    const item = await Item.create({ modelName: 'TeardownPost', schemaName: SCHEMA_NAME, title } as never)
    const seedLocalId = item.seedLocalId
    await waitUntilOrThrow(
      () => metadataWatches(seedLocalId) > 0 && liveQueries.active(definitionQuery) > 0,
      'the title property to watch its metadata and its definition',
    )
    const property = await ItemProperty.find({ propertyName: 'title', seedLocalId })
    expect(property).toBeDefined()
    return { item, property: property!, seedLocalId }
  }

  const expectClosed = (seedLocalId: string) => {
    expect(metadataWatches(seedLocalId), 'metadata watches still registered').toBe(0)
    expect(liveQueries.active(definitionQuery), `still open: ${JSON.stringify(liveQueries.activeSql(definitionQuery))}`).toBe(0)
  }

  it('destroy closes the metadata watch and the definition liveQuery', async () => {
    const { item, property, seedLocalId } = await createWatchedTitle('destroy')

    await property.destroy()

    expect(property.getService().getSnapshot().status).toBe('stopped')
    expectClosed(seedLocalId)
    // The item stays loaded otherwise, and its own new title property would match the next test's
    // definition-query filter (by model and property name, not by item)
    item.unload()
    await new Promise((resolve) => setTimeout(resolve, 300))
    expectClosed(seedLocalId)
  }, 30000)

  it('the last unload closes the metadata watch and the definition liveQuery', async () => {
    const { item, property, seedLocalId } = await createWatchedTitle('unload')

    // The item and this find each hold the property once
    item.unload()
    property.unload()

    expect(property.getService().getSnapshot().status).toBe('stopped')

    expectClosed(seedLocalId)
  }, 30000)
})
