import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { Item } from '@/Item/Item'
import { importJsonSchema } from '@/imports/json'
import { generateId } from '@/helpers'
import { BaseArweaveClient } from '@/helpers/ArweaveClient/BaseArweaveClient'
import { getPublishUploadData } from '@/db/read/getPublishUploads'
import { createNewItem } from '@/db/write/createNewItem'
import { BaseDb } from '@/db/Db/BaseDb'
import { metadata } from '@/seedSchema'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'
import {
  ensureModelUidsForGetPublishPayloadTest,
  ensurePropertySchemaUidsForGetPublishPayloadTest,
  waitForPropertyInstances,
} from '../test-utils/getPublishPayloadIntegrationHelpers'
import { waitForIdle } from '../test-utils/waitForIdle'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { decodeCompositeUpload } from '@/helpers/compositeUpload'

/**
 * ItemStorage values given at creation (`Item.create({ html })`, `createNewItem`) are written to the
 * property's file like a `prop.save()`, so publish puts them in the composite upload. Rows made
 * before that fix (content stored verbatim in property_value, no file) are written out on publish.
 * Runs in both the NodeJS and browser projects.
 */
const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe.sequential

const SCHEMA_NAME = 'Test Schema itemStorageCreateValues'

const schemaFile = () => ({
  $schema: 'https://seedprotocol.org/schemas/data-model/v1',
  version: 1,
  id: generateId(),
  metadata: { name: SCHEMA_NAME, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  models: {
    CreatePost: {
      id: generateId(),
      properties: {
        title: { id: generateId(), type: 'Text' },
        storageTransactionId: { id: generateId(), type: 'Text' },
        html: { id: generateId(), type: 'Text', storage: { type: 'ItemStorage', path: '/html', extension: '.html' } },
        cover: { id: generateId(), type: 'Text', storage: { type: 'ItemStorage', path: '/files', extension: '.bin' } },
      },
    },
  },
  enums: {},
  migrations: [],
})

const metadataRow = async (seedLocalId: string, propertyName: string) => {
  const rows = await BaseDb.getAppDb()
    .select()
    .from(metadata)
    .where(and(eq(metadata.seedLocalId, seedLocalId), eq(metadata.propertyName, propertyName)))
  expect(rows).toHaveLength(1)
  return rows[0]!
}

testDescribe('ItemStorage values given at creation', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    const schema = schemaFile()
    await importJsonSchema({ contents: JSON.stringify(schema) }, schema.version)
    await ensureModelUidsForGetPublishPayloadTest(['CreatePost'], SCHEMA_NAME)
    await ensurePropertySchemaUidsForGetPublishPayloadTest(schema as any)
    vi.spyOn(BaseArweaveClient, 'createTransaction').mockImplementation(
      async (_data: unknown, options?: { tags?: { name: string; value: string }[] }) =>
        ({ id: 'unsigned', tags: options?.tags ?? [] }) as any,
    )
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    vi.restoreAllMocks()
    await teardownTestEnvironment()
  })

  const compositeChildren = async (item: Item<any>) => {
    const uploads = await getPublishUploadData(item as any)
    const composite = uploads.find((u) => u.itemPropertyName === 'storageTransactionId')
    expect(composite?.contentType).toBe('application/octet-stream')
    const children = decodeCompositeUpload(composite!.data)!
    return Object.fromEntries(children.map((c) => [c.name, new TextDecoder().decode(c.bytes)]))
  }

  it('Item.create writes ItemStorage values to their files; an immediate publish includes them', async () => {
    const html = '<p>created with héllo 你好</p>'
    const post = await Item.create({
      schemaName: SCHEMA_NAME,
      modelName: 'CreatePost',
      title: 'created',
      html,
      cover: 'cover at create',
    } as any)

    // Context is populated by the save itself, before Item.create returns.
    const htmlProp = post.allProperties['html']!
    expect(htmlProp.value).toBe(html)
    expect(htmlProp.refResolvedValue).toBe(`${post.seedLocalId}.html`)
    expect(htmlProp.localStoragePath).toBe(BaseFileManager.getFilesPath('html', `${post.seedLocalId}.html`))
    expect(await BaseFileManager.readFileAsString(htmlProp.localStoragePath as string)).toBe(html)

    // The row holds the file reference, not the content.
    const row = await metadataRow(post.seedLocalId, 'html')
    expect(row.refResolvedValue).toBe(`${post.seedLocalId}.html`)
    expect(row.localStorageDir).toBe('/html')
    expect(row.propertyValue).not.toBe(html)

    const byName = await compositeChildren(post)
    expect(byName.html).toBe(html)
    expect(byName.cover).toBe('cover at create')
    expect((post as any).title).toBe('created')
  }, 90000)

  it('reading the value back from a fresh load returns the content', async () => {
    const html = '<p>read me back</p>'
    const post = await Item.create({ schemaName: SCHEMA_NAME, modelName: 'CreatePost', title: 'reload', html } as any)
    const seedLocalId = post.seedLocalId
    post.unload()

    const reloaded = await Item.find({ seedLocalId, modelName: 'CreatePost' })
    expect(reloaded).toBeTruthy()
    await waitForIdle(reloaded as any, 'Item', 15000)
    await waitForPropertyInstances(reloaded as any)
    await vi.waitFor(() => expect(reloaded!.allProperties['html']?.value).toBe(html), { timeout: 15000 })
  }, 90000)

  it('createNewItem writes ItemStorage values to their files instead of the metadata row', async () => {
    const html = '<p>low-level create</p>'
    const { seedLocalId } = await createNewItem({ modelName: 'CreatePost', title: 'low level', html } as any)
    const row = await metadataRow(seedLocalId, 'html')
    expect(row.refResolvedValue).toBe(`${seedLocalId}.html`)
    expect(row.localStorageDir).toBe('/html')
    expect(row.propertyValue ?? null).toBeNull()
    const filePath = BaseFileManager.getFilesPath('html', `${seedLocalId}.html`)
    expect(await BaseFileManager.readFileAsString(filePath)).toBe(html)

    const post = await Item.find({ seedLocalId, modelName: 'CreatePost' })
    await waitForIdle(post as any, 'Item', 15000)
    await waitForPropertyInstances(post as any)
    await vi.waitFor(() => expect(post!.allProperties['html']?.value).toBe(html), { timeout: 15000 })
    const byName = await compositeChildren(post as any)
    expect(byName.html).toBe(html)
  }, 90000)

  it('a legacy row with the content stored verbatim (no file) is written out and uploaded on publish', async () => {
    const html = '<p>legacy verbatim</p>'
    // No instance loaded yet, as for data from an earlier session.
    const { seedLocalId } = await createNewItem({ modelName: 'CreatePost', title: 'legacy' } as any)
    // What Item.create / createNewItem stored before the fix: the content in property_value, no file.
    const before = await metadataRow(seedLocalId, 'html')
    await BaseDb.getAppDb()
      .update(metadata)
      .set({ propertyValue: html, refResolvedValue: null, localStorageDir: null })
      .where(eq(metadata.localId, before.localId!))
    const filePath = BaseFileManager.getFilesPath('html', `${seedLocalId}.html`)
    expect(await BaseFileManager.pathExists(filePath)).toBe(false)

    const legacy = await Item.find({ seedLocalId, modelName: 'CreatePost' })
    await waitForIdle(legacy as any, 'Item', 15000)
    await waitForPropertyInstances(legacy as any)
    await vi.waitFor(() => expect(legacy!.allProperties['html']?.value).toBe(html), { timeout: 15000 })

    const byName = await compositeChildren(legacy as any)
    expect(byName.html).toBe(html)
    expect(Object.keys(byName)).toEqual(['html'])

    // Migrated in place: the file exists and the row points at it; the value still reads the same.
    expect(await BaseFileManager.readFileAsString(filePath)).toBe(html)
    const after = await metadataRow(seedLocalId, 'html')
    expect(after.refResolvedValue).toBe(`${seedLocalId}.html`)
    expect(after.localStorageDir).toBe('/html')
    expect(legacy!.allProperties['html']?.value).toBe(html)
  }, 90000)
})
