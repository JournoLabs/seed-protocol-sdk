import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { Item } from '@/Item/Item'
import { importJsonSchema } from '@/imports/json'
import { generateId } from '@/helpers'
import { BaseArweaveClient } from '@/helpers/ArweaveClient/BaseArweaveClient'
import { getPublishUploadData, getPublishUploads } from '@/db/read/getPublishUploads'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../../test-utils/client-init'
import {
  ensureModelUidsForGetPublishPayloadTest,
  ensurePropertySchemaUidsForGetPublishPayloadTest,
  waitForPropertyInstances,
} from '../../test-utils/getPublishPayloadIntegrationHelpers'
import { waitForIdle } from '../../test-utils/waitForIdle'
import { WAIT_TIMEOUT_MS } from '../../test-utils/timeouts'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { decodeCompositeUpload } from '@/helpers/compositeUpload'

/**
 * Uploads carry a Content-Type for every file type the SDK knows, not just images / html / json:
 * from the file name when it has a known extension, else from the bytes' signature.
 */
const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe.sequential

const SCHEMA_NAME = 'Test Schema publishUploadContentTypes'

const schemaFile = () => ({
  $schema: 'https://seedprotocol.org/schemas/data-model/v1',
  version: 1,
  id: generateId(),
  metadata: { name: SCHEMA_NAME, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  models: {
    UploadTypesDoc: {
      id: generateId(),
      properties: {
        title: { id: generateId(), type: 'Text' },
        report: { id: generateId(), type: 'File' },
        audio: { id: generateId(), type: 'File' },
        untitled: { id: generateId(), type: 'File' },
      },
    },
    UploadTypesPost: {
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

const PDF = new TextEncoder().encode('%PDF-1.4\n%âã\n1 0 obj << >> endobj\n')
const WAV = new Uint8Array([
  ...Array.from('RIFF').map((c) => c.charCodeAt(0)), 36, 0, 0, 0,
  ...Array.from('WAVEfmt ').map((c) => c.charCodeAt(0)), 16, 0, 0, 0, 1, 0, 1, 0,
  0x44, 0xac, 0, 0, 0x88, 0x58, 0x01, 0, 2, 0, 16, 0,
])

const setFile = async (item: Item<any>, propertyName: string, file: File) => {
  const prop = item.allProperties[propertyName]!
  prop.value = file
  await prop.save()
  await vi.waitFor(() => {
    const ctx = (prop.getService().getSnapshot() as any).context
    expect(typeof ctx.propertyValue).toBe('string')
    expect(ctx.refResolvedValue).toBeTruthy()
  }, { timeout: WAIT_TIMEOUT_MS })
}

testDescribe('publish upload Content-Type', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    const schema = schemaFile()
    await importJsonSchema({ contents: JSON.stringify(schema) }, schema.version)
    await ensureModelUidsForGetPublishPayloadTest(['UploadTypesDoc', 'UploadTypesPost', 'File'], SCHEMA_NAME)
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

  it('pdf / wav by extension, and a nameless file by its signature', async () => {
    const item = await Item.create({ schemaName: SCHEMA_NAME, modelName: 'UploadTypesDoc', title: 'types' } as any)
    await waitForIdle(item, 'Item', 15000)
    await waitForPropertyInstances(item)

    await setFile(item, 'report', new File([PDF], `report-${generateId()}.pdf`))
    await setFile(item, 'audio', new File([WAV], `clip-${generateId()}.wav`))
    await setFile(item, 'untitled', new File([PDF], `untitled-${generateId()}`))

    const uploads = await getPublishUploadData(item as any)
    const byProperty = Object.fromEntries(uploads.map((u) => [u.itemPropertyName, u]))
    expect(byProperty.report?.contentType).toBe('application/pdf')
    expect(byProperty.audio?.contentType).toBe('audio/wav')
    expect(byProperty.untitled?.contentType).toBe('application/pdf')
    expect(byProperty.audio?.tags).toContainEqual({ name: 'Content-Type', value: 'audio/wav' })
    // Bytes are uploaded as stored.
    expect(Array.from(byProperty.audio!.data)).toEqual(Array.from(WAV))

    // The L1 transactions carry the same tags, in the same order as the upload data.
    const txs = await getPublishUploads(item as any)
    expect(txs.map((t) => t.itemPropertyLocalId)).toEqual(uploads.map((u) => u.itemPropertyLocalId))
    expect(txs.map((t) => (t.transactionToSign as any).tags)).toEqual(uploads.map((u) => u.tags))
  }, 90000)

  it('a composite of ItemStorage files keeps a binary child intact', async () => {
    const post = await Item.create({ schemaName: SCHEMA_NAME, modelName: 'UploadTypesPost', title: 'composite' } as any)
    await waitForIdle(post, 'Item', 15000)
    await waitForPropertyInstances(post)

    const html = '<p>héllo 你好</p>'
    const cover = new Uint8Array(256).map((_, i) => 255 - i) // invalid UTF-8, NUL included
    // Put the ItemStorage files on disk and point the properties at them (what saveItemStorage plus
    // the browser's metadata live query do). Text validation keeps binary out of the property API,
    // so a binary child only happens when the file itself is binary, e.g. one written by other code.
    const fs = await BaseFileManager.getFs()
    const place = async (propertyName: string, dir: string, fileName: string, bytes: Uint8Array) => {
      await BaseFileManager.createDirIfNotExists(BaseFileManager.getFilesPath(dir))
      await fs.promises.writeFile(BaseFileManager.getFilesPath(dir, fileName), bytes)
      post.allProperties[propertyName]!.getService().send({
        type: 'updateContext',
        refResolvedValue: fileName,
        localStorageDir: `/${dir}`,
      })
    }
    await place('html', 'html', `${post.seedLocalId}.html`, new TextEncoder().encode(html))
    await place('cover', 'files', `${post.seedLocalId}.bin`, cover)
    expect(post.allProperties.cover!.localStoragePath).toBeTruthy()

    const uploads = await getPublishUploadData(post as any)
    const composite = uploads.find((u) => u.itemPropertyName === 'storageTransactionId')
    expect(composite?.contentType).toBe('application/octet-stream')
    const children = decodeCompositeUpload(composite!.data)!
    const byName = Object.fromEntries(children.map((c) => [c.name, c.bytes]))
    expect(new TextDecoder().decode(byName.html)).toBe(html)
    expect(Array.from(byName.cover!)).toEqual(Array.from(cover))
  }, 90000)
})
