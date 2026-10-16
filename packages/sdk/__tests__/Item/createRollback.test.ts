import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { metadata, seeds, versions } from '@/seedSchema'
import { Item } from '@/Item/Item'
import { ItemCreateValidationError } from '@/Item/errors'
import { importJsonSchema } from '@/imports/json'
import { generateId } from '@/helpers'
import { setGetPublisherForNewSeeds } from '@/helpers/publishConfig'
import type { SchemaFileFormat } from '@/types/import'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'

/**
 * Item.create writes the item's rows, then saves File/Image/Html/ItemStorage values through their
 * property pipelines. A failure there used to leave a draft with the other values, so a retry made
 * a duplicate. Now a rejected create leaves nothing.
 */

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe
const SCHEMA_NAME = 'Test Schema Create Rollback'
const MINE = '0x' + '5'.repeat(40)
const OTHER = '0x' + '6'.repeat(40)

function schemaFile(): SchemaFileFormat {
  const now = new Date().toISOString()
  return {
    $schema: 'https://seedprotocol.org/schemas/data-model/v1',
    version: 1,
    id: generateId(),
    metadata: { name: SCHEMA_NAME, createdAt: now, updatedAt: now },
    models: {
      AtomicPost: {
        id: generateId(),
        properties: {
          title: { id: generateId(), type: 'Text' },
          body: { id: generateId(), type: 'Html', validation: { maxLength: 20 } },
        },
      },
    },
    enums: {},
    migrations: [],
  } as SchemaFileFormat
}

const countRows = async () => {
  const db = BaseDb.getAppDb()!
  const posts = await db.select({ localId: seeds.localId }).from(seeds).where(eq(seeds.type, 'atomic_post'))
  const html = await db.select({ localId: seeds.localId }).from(seeds).where(eq(seeds.type, 'html'))
  const postVersions = await db.select({ localId: versions.localId }).from(versions).where(eq(versions.seedType, 'atomic_post'))
  const postRows = await db.select({ localId: metadata.localId }).from(metadata).where(eq(metadata.modelType, 'atomic_post'))
  return { posts: posts.length, html: html.length, versions: postVersions.length, rows: postRows.length }
}

testDescribe('Item.create leaves nothing when it rejects', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    const file = schemaFile()
    await importJsonSchema({ contents: JSON.stringify(file) }, file.version)
  }, SETUP_HOOK_TIMEOUT_MS)

  afterEach(async () => {
    setGetPublisherForNewSeeds(null)
    const { client } = await import('@/client')
    await client.setAddresses({ owned: [], watched: [] })
  })

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it('an Html value that breaks its rule rejects with ItemCreateValidationError', async () => {
    const before = await countRows()
    const error = await Item.create({
      modelName: 'AtomicPost',
      schemaName: SCHEMA_NAME,
      title: 'Kept?',
      body: '<p>' + 'x'.repeat(40) + '</p>',
    } as never).catch((e) => e)

    expect(error).toBeInstanceOf(ItemCreateValidationError)
    expect((error as ItemCreateValidationError).problems.map((p) => p.property)).toEqual(['body'])
    expect(await countRows()).toEqual(before)
  }, 30000)

  it('a pipeline save refused for ownership rejects and removes the draft', async () => {
    const { client } = await import('@/client')
    // New drafts are stamped OTHER, which isn't owned here, so the Html save is refused.
    await client.setAddresses({ owned: [MINE], watched: [] })
    setGetPublisherForNewSeeds(async () => OTHER)
    const before = await countRows()

    const error = await Item.create({
      modelName: 'AtomicPost',
      schemaName: SCHEMA_NAME,
      title: 'Not mine',
      body: '<p>ok</p>',
    } as never).catch((e) => e)

    expect(error).toBeInstanceOf(Error)
    expect(String(error.message)).toMatch(/read-only/)
    expect(await countRows()).toEqual(before)
  }, 30000)

  it('a create that succeeds keeps its rows and its Html seed', async () => {
    const before = await countRows()
    const item = await Item.create({
      modelName: 'AtomicPost',
      schemaName: SCHEMA_NAME,
      title: 'Kept',
      body: '<p>short</p>',
    } as never)

    expect(item.seedLocalId).toBeTruthy()
    const after = await countRows()
    expect(after.posts).toBe(before.posts + 1)
    expect(after.html).toBe(before.html + 1)
  }, 30000)
})
