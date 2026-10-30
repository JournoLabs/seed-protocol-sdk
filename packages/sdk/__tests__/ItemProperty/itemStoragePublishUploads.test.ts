import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { Item } from '@/Item/Item'
import { importJsonSchema } from '@/imports/json'
import { generateId } from '@/helpers'
import { BaseArweaveClient } from '@seedprotocol/arweave'
import { getPublishUploadData } from '@/db/read/getPublishUploads'
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
 * ItemStorage properties (files whose path derives from the item, e.g. a Post's html) go into the
 * item's composite upload. A save must make them uploadable immediately: in Node there is no
 * metadata live query, and in the browser a publish can run before it fires.
 * Runs in both the NodeJS and browser projects.
 */
const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe.sequential

const SCHEMA_NAME = 'Test Schema itemStoragePublishUploads'

const schemaFile = () => ({
  $schema: 'https://seedprotocol.io/schemas/data-model/v1',
  version: 1,
  id: generateId(),
  metadata: { name: SCHEMA_NAME, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  models: {
    StoragePost: {
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

testDescribe('ItemStorage children in publish uploads', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    const schema = schemaFile()
    await importJsonSchema({ contents: JSON.stringify(schema) }, schema.version)
    await ensureModelUidsForGetPublishPayloadTest(['StoragePost'], SCHEMA_NAME)
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

  const newPost = async (title: string) => {
    const post = await Item.create({ schemaName: SCHEMA_NAME, modelName: 'StoragePost', title } as any)
    await waitForIdle(post, 'Item', 15000)
    await waitForPropertyInstances(post)
    return post
  }

  const saveValue = async (item: Item<any>, propertyName: string, value: string) => {
    const prop = item.allProperties[propertyName]!
    prop.value = value
    await prop.save()
    return prop
  }

  const compositeChildren = async (item: Item<any>) => {
    const uploads = await getPublishUploadData(item as any)
    const composite = uploads.find((u) => u.itemPropertyName === 'storageTransactionId')
    expect(composite?.contentType).toBe('application/octet-stream')
    const children = decodeCompositeUpload(new Uint8Array(await composite!.blob.arrayBuffer()))!
    return Object.fromEntries(children.map((c) => [c.name, c.bytes]))
  }

  it('freshly saved ItemStorage properties are in the composite right away (no reload)', async () => {
    const post = await newPost('fresh')
    const html = '<p>héllo 你好</p>'
    const htmlProp = await saveValue(post, 'html', html)
    const coverProp = await saveValue(post, 'cover', 'cover text')

    // Set by the save itself, not by the browser's metadata live query (Node has none).
    expect(htmlProp.refResolvedValue).toBe(`${post.seedLocalId}.html`)
    expect(htmlProp.localStoragePath).toBe(BaseFileManager.getFilesPath('html', `${post.seedLocalId}.html`))
    expect(coverProp.localStoragePath).toBe(BaseFileManager.getFilesPath('files', `${post.seedLocalId}.bin`))

    const byName = await compositeChildren(post)
    expect(new TextDecoder().decode(byName.html)).toBe(html)
    expect(new TextDecoder().decode(byName.cover)).toBe('cover text')
  }, 90000)

  it('a composite of ItemStorage files keeps a binary child intact', async () => {
    const post = await newPost('composite')
    const html = '<p>héllo 你好</p>'
    await saveValue(post, 'html', html)
    const coverProp = await saveValue(post, 'cover', 'placeholder')
    // Text validation keeps binary out of the property API, so a binary child only happens when the
    // file itself is binary, e.g. one written by other code: overwrite the saved file in place.
    const cover = new Uint8Array(256).map((_, i) => 255 - i) // invalid UTF-8, NUL included
    const fs = await BaseFileManager.getFs()
    await fs.promises.writeFile(coverProp.localStoragePath as string, cover)

    const byName = await compositeChildren(post)
    expect(new TextDecoder().decode(byName.html)).toBe(html)
    expect(Array.from(byName.cover!)).toEqual(Array.from(cover))
  }, 90000)

  it('finds a saved child from its metadata row when the property context lacks the path', async () => {
    const post = await newPost('context-less')
    const htmlProp = await saveValue(post, 'html', '<p>from the row</p>')
    // E.g. an instance whose context predates the save.
    htmlProp.getService().send({ type: 'updateContext', refResolvedValue: undefined })
    expect(htmlProp.localStoragePath).toBeFalsy()

    const byName = await compositeChildren(post)
    expect(new TextDecoder().decode(byName.html)).toBe('<p>from the row</p>')
  }, 90000)

  it('fails loudly when a saved local edit has lost its file, instead of dropping the child', async () => {
    const post = await newPost('lost-file')
    await saveValue(post, 'html', '<p>kept</p>')
    const coverProp = await saveValue(post, 'cover', 'gone soon')
    const fs = await BaseFileManager.getFs()
    await fs.promises.unlink(coverProp.localStoragePath as string)

    await expect(getPublishUploadData(post as any)).rejects.toThrow(/cover/)
  }, 90000)

  it('an ItemStorage property that was never set is skipped, not an error', async () => {
    const post = await newPost('html only')
    await saveValue(post, 'html', '<p>only html</p>')

    const byName = await compositeChildren(post)
    expect(Object.keys(byName)).toEqual(['html'])
  }, 90000)
})
