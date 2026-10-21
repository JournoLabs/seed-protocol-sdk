import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { Item } from '@/Item/Item'
import { BaseDb } from '@/db/Db/BaseDb'
import { metadata } from '@/seedSchema/MetadataSchema'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { waitForEntityIdle } from '@/helpers/waitForEntityIdle'
import { getEasSchemaUidForModel } from '@/db/read/getSchemaUidForModel'
import { stageStorageContent, storageFileName } from '@/storageValue/content'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'
import {
  createGetPublishPayloadTestSchema,
  createPublishedTestAuthor,
  waitForPropertyInstances,
} from '../test-utils/getPublishPayloadIntegrationHelpers'
import { WAIT_TIMEOUT_MS } from '../test-utils/timeouts'

// EAS has no schema for the test properties' definitions; a fixed uid stands in for the lookup
const { PROPERTY_SCHEMA_UID } = vi.hoisted(() => ({ PROPERTY_SCHEMA_UID: `0x${'ab'.repeat(32)}` }))
vi.mock('@/helpers/propertySchemaUid', () => ({
  lookupPropertySchemaUid: vi.fn(async () => PROPERTY_SCHEMA_UID),
}))

// 1x1 transparent PNG
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'

const pngBytes = () => Uint8Array.from(atob(PNG_BASE64), (c) => c.charCodeAt(0))
const text = (bytes: ArrayBuffer) => new TextDecoder().decode(bytes)

// Image, File and Html saves share one pipeline (storageValue/save.ts); these cover where the three
// copies it replaced had drifted apart (sdk-audit G10-1, G10-2).
const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe.skip

testDescribe('storage value saves', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    await createGetPublishPayloadTestSchema()
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  const createPost = async () => {
    const author = await createPublishedTestAuthor()
    const item = await Item.create({ modelName: 'Post', title: 'Storage values', author: author.seedLocalId } as any)
    await waitForEntityIdle(item, { timeout: WAIT_TIMEOUT_MS })
    await waitForPropertyInstances(item)
    return item
  }

  const storedRow = async (seedLocalId: string, propertyName: string) => {
    const [row] = await BaseDb.getAppDb()!
      .select()
      .from(metadata)
      .where(and(eq(metadata.seedLocalId, seedLocalId), eq(metadata.propertyName, propertyName)))
    return row
  }

  // saveFile and saveHtml stored the File/Html model's EAS uid as the property's schema uid on a
  // property's first row; saveImage refused exactly that.
  it.each([
    ['File', 'attachment', 'attachmentId', 'notes for the attachment'],
    ['Html', 'bodyHtml', 'bodyHtmlId', '<p>first row</p>'],
  ])('stores a %s property\'s own schema uid on its first row, not the storage model\'s', async (modelName, key, storageName, value) => {
    const item = await createPost()
    const property = item.allProperties[key]!
    const modelUid = await getEasSchemaUidForModel(modelName)
    expect(modelUid).toBeTruthy()
    // Item.create gives every property an empty row; without one the save writes the first row
    await BaseDb.getAppDb()!
      .delete(metadata)
      .where(and(eq(metadata.seedLocalId, item.seedLocalId!), eq(metadata.propertyName, storageName)))

    property.value = value
    await property.save()

    const row = await storedRow(item.seedLocalId!, storageName)
    expect(row.schemaUid).toBe(PROPERTY_SCHEMA_UID)
    expect(row.refModelUid).toBe(modelUid)
  }, 30000)

  describe('strings assigned to an Image property', () => {
    const saveImage = async (value: string) => {
      const item = await createPost()
      const image = item.allProperties['coverImage']!
      image.value = value
      await image.save()
      const ctx = (image.getService().getSnapshot() as any).context
      const filePath = BaseFileManager.getFilesPath('images', ctx.refResolvedValue)
      return { ctx, bytes: await BaseFileManager.readFile(filePath).then((f: Blob) => f.arrayBuffer()) }
    }

    it('saves an svg data URL under a .svg name', async () => {
      const { ctx, bytes } = await saveImage(`data:image/svg+xml;base64,${btoa(SVG)}`)
      expect(ctx.refResolvedValue).toMatch(/\.svg$/)
      expect(text(bytes)).toBe(SVG)
    }, 30000)

    it('saves a data URL with parameters', async () => {
      const { ctx, bytes } = await saveImage(`data:image/png;name=dot.png;base64,${PNG_BASE64}`)
      expect(ctx.refResolvedValue).toMatch(/\.png$/)
      expect(new Uint8Array(bytes)).toEqual(pngBytes())
    }, 30000)

    it('saves raw base64 image bytes', async () => {
      const { ctx, bytes } = await saveImage(PNG_BASE64)
      expect(ctx.refResolvedValue).toMatch(/\.png$/)
      expect(new Uint8Array(bytes)).toEqual(pngBytes())
    }, 30000)

    it('fetches a URL without a scheme over https', async () => {
      const fetchMock = vi.fn(async () => new Response(pngBytes(), { headers: { 'Content-Type': 'image/png' } }))
      vi.stubGlobal('fetch', fetchMock)
      const { bytes } = await saveImage('cdn.example.com/images/dot.png')
      expect(fetchMock).toHaveBeenCalledWith('https://cdn.example.com/images/dot.png')
      expect(new Uint8Array(bytes)).toEqual(pngBytes())
    }, 30000)
  })

  describe('stageStorageContent', () => {
    it('decodes base64 and percent-encoded data URLs for a File', async () => {
      const base64 = await stageStorageContent('file', 'data:text/plain;base64,aGVsbG8=')
      expect(base64.kind).toBe('bytes')
      expect(text((base64 as { data: ArrayBuffer }).data)).toBe('hello')

      const plain = await stageStorageContent('file', 'data:application/json,%7B%22a%22%3A1%7D')
      expect(text((plain as { data: ArrayBuffer }).data)).toBe('{"a":1}')
    })

    it('treats other strings as a File\'s text, even ones that look like base64 or file names', async () => {
      for (const value of ['hello', 'photo.jpg', 'some notes, with punctuation.', '', '  ']) {
        expect(await stageStorageContent('file', value)).toEqual({ kind: 'text', data: value })
      }
    })

    it('refuses an Image string that is no image', async () => {
      await expect(stageStorageContent('image', 'hello')).rejects.toThrow('No file data found')
      await expect(stageStorageContent('image', 'photo.png')).rejects.toThrow('No file data found')
    })

    it('takes the name of a file in the folder as a reference to it', async () => {
      const name = `existing-${Date.now()}.png`
      await BaseFileManager.saveFile(BaseFileManager.getFilesPath('images', name), pngBytes().buffer as ArrayBuffer)
      expect(await stageStorageContent('image', name)).toEqual({ kind: 'existing', fileName: name })
    })

    it('names files after the seed with the MIME type\'s extension or the source name', () => {
      const bytes = new ArrayBuffer(0)
      expect(storageFileName('image', 'abc', { kind: 'bytes', data: bytes, mimeType: 'image/svg+xml' })).toBe('abc.svg')
      expect(storageFileName('file', 'abc', { kind: 'bytes', data: bytes, sourceName: 'a.pdf' })).toBe('abc-a.pdf')
      expect(storageFileName('file', 'abc', { kind: 'text', data: 'x' })).toBe('abc')
      expect(storageFileName('html', 'abc', { kind: 'text', data: '<p/>', mimeType: 'text/html' })).toBe('abc.html')
    })
  })
})
