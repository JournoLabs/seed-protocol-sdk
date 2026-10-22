import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { waitFor } from 'xstate'
import { eq } from 'drizzle-orm'
import { digestHex, getBagFile, validateBag, type Bag } from '@seedprotocol/archive'
import { writeBagDirectory } from '@seedprotocol/archive/node'
import { getPublicArweaveRawUrl } from '@seedprotocol/arweave'
import { Item } from '@/Item/Item'
import { importJsonSchema } from '@/imports/json'
import { generateId } from '@/helpers'
import { BaseDb } from '@/db/Db/BaseDb'
import { versions } from '@/seedSchema'
import { ArchiveExportError, exportArchive } from '@/archive/exportArchive'
import { rewriteHtmlEmbeddedImagesOnDisk } from '@/helpers/htmlEmbeddedDataUriPublish'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'
import {
  ensureModelUidsForGetPublishPayloadTest,
  ensurePropertySchemaUidsForGetPublishPayloadTest,
  markPublished,
  UNPUBLISH_TEST_PUBLISHER,
  waitForPropertyInstances,
} from '../test-utils/getPublishPayloadIntegrationHelpers'
import { waitForIdle } from '../test-utils/waitForIdle'
import { bagitPyRequired, findBagitPy, runBagitPy } from '../../../archive/__tests__/bagitPy'

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe.sequential

const SCHEMA_NAME = 'Test Schema exportArchive'
const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const PNG_BYTES = Uint8Array.from(atob(TINY_PNG_B64), (c) => c.charCodeAt(0))
const IMAGE_TX = 'exportarchivefeatureimagetx'.padEnd(43, 'x')

const schemaFile = () => ({
  $schema: 'https://seedprotocol.org/schemas/data-model/v1',
  version: 1,
  id: generateId(),
  metadata: { name: SCHEMA_NAME, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  models: {
    ArchivedPost: {
      id: generateId(),
      properties: {
        title: { id: generateId(), type: 'Text' },
        featureImage: { id: generateId(), type: 'Image' },
        html: { id: generateId(), type: 'Html' },
      },
    },
  },
  enums: {},
  migrations: [],
})

const ARCHIVE = (src: string) =>
  `<article class="h-entry">\r\n<header><h1 class="p-name">An archived post</h1>` +
  `<p class="p-summary">What it is about</p>` +
  `<p>By <span class="p-author h-card"><span class="p-name">Jane Doe</span></span>` +
  ` <time class="dt-published" datetime="2026-10-08">Oct 8</time></p>` +
  `<img class="u-featured" src="${src}"></header>\n<div class="e-content"><pre>\n\ncode</pre></div></article>`

const contextOf = (item: Item<any>, propertyName: string) => {
  const property = item.properties.find(
    (p) => p.propertyName === propertyName || p.propertyName === `${propertyName}Id`,
  )!
  return property.getService().getSnapshot().context as { propertyValue?: string; refResolvedValue?: string }
}

const text = (bag: Bag, p: string) => new TextDecoder().decode(getBagFile(bag, p)?.bytes)

/** A post whose feature image is published as IMAGE_TX and whose Html points at it, marked published. */
async function createPublishedPost(): Promise<Item<any>> {
  const post = await Item.create({
    schemaName: SCHEMA_NAME,
    modelName: 'ArchivedPost',
    title: 'An archived post',
    html: ARCHIVE('seed:property/featureImage'),
  } as any)
  await waitForIdle(post, 'Item', 15000)
  await waitForPropertyInstances(post)
  const featureImage = post.properties.find((p) => p.propertyName === 'featureImage' || p.propertyName === 'featureImageId')!
  featureImage.value = new Blob([PNG_BYTES], { type: 'image/png' })
  await waitFor(
    featureImage.getService(),
    (s) => {
      const ctx = s.context as Record<string, any>
      return !!ctx.refResolvedValue && typeof ctx.propertyValue === 'string' && !/^(blob|data):/.test(ctx.propertyValue)
    },
    { timeout: 15000 },
  )

  // What publish leaves behind: the image's transaction id, and the placeholder rewritten to its URL.
  const imageItem = (await Item.find({ seedLocalId: contextOf(post, 'featureImage').propertyValue! }))!
  const st = imageItem.internalProperties['storageTransactionId'] ?? imageItem.allProperties['storageTransactionId']
  st!.value = IMAGE_TX
  await st!.save()
  await waitForIdle(imageItem, 'Item', 15000)
  await rewriteHtmlEmbeddedImagesOnDisk(post.seedLocalId, [], [contextOf(post, 'html').propertyValue!])

  await markPublished(post)
  await BaseDb.getAppDb()
    .update(versions)
    .set({ attestationCreatedAt: Date.parse('2026-10-08T21:00:00Z') })
    .where(eq(versions.seedLocalId, post.seedLocalId))
  return post
}

testDescribe('exportArchive', () => {
  const dirs: string[] = []

  beforeAll(async () => {
    // markPublished attests as this address; owning it keeps the published post editable.
    await setupTestEnvironment({
      testFileUrl: import.meta.url,
      timeout: SETUP_HOOK_TIMEOUT_MS,
      configOverrides: { addresses: [UNPUBLISH_TEST_PUBLISHER] },
    })
    const schema = schemaFile()
    await importJsonSchema({ contents: JSON.stringify(schema) }, schema.version)
    await ensureModelUidsForGetPublishPayloadTest(['ArchivedPost', 'Image', 'File', 'Html'], SCHEMA_NAME)
    await ensurePropertySchemaUidsForGetPublishPayloadTest(schema as any)
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    for (const dir of dirs) await rm(dir, { recursive: true, force: true })
    await teardownTestEnvironment()
  })

  it('writes a valid bag with relative asset paths, the published Html, and metadata', async () => {
    const post = await createPublishedPost()
    const { bag, omitted } = await exportArchive(post, {
      fetch: false,
      sourceOrganization: 'Test Desk',
      baggingDate: new Date('2026-10-22T12:00:00Z'),
    })
    expect(omitted).toEqual([])
    expect(validateBag(bag)).toEqual({ valid: true, errors: [] })

    const asset = `assets/${digestHex('sha256', PNG_BYTES)}.png`
    expect(bag.files.map((f) => f.path)).toEqual(
      expect.arrayContaining([
        'metadata/dc.xml',
        'metadata/premis.xml',
        'data/index.html',
        'data/source/html.html',
        `data/${asset}`,
        'data/item.json',
      ]),
    )
    // The view copy points into the bag; the source is the Html exactly as published.
    const imageUrl = getPublicArweaveRawUrl(IMAGE_TX)
    expect(text(bag, 'data/index.html')).toBe(ARCHIVE(asset))
    expect(text(bag, 'data/source/html.html')).toBe(ARCHIVE(imageUrl))

    const item = JSON.parse(text(bag, 'data/item.json'))
    expect(item).toMatchObject({ seedUid: post.seedUid, modelName: 'ArchivedPost', schemaName: SCHEMA_NAME })
    expect(item.properties.title).toMatchObject({ dataType: 'Text', value: 'An archived post' })
    expect(item.properties.featureImage).toMatchObject({ file: asset, arweaveTransactionId: IMAGE_TX })

    const dc = text(bag, 'metadata/dc.xml')
    expect(dc).toContain('<dc:title>An archived post</dc:title>')
    expect(dc).toContain('<dc:creator>Jane Doe</dc:creator>')
    expect(dc).toContain('<dc:date>2026-10-08</dc:date>')
    const premis = text(bag, 'metadata/premis.xml')
    expect(premis).toContain('<premis:eventDateTime>2026-10-08T21:00:00.000Z</premis:eventDateTime>')
    expect(premis).toContain(`<premis:originalName>${imageUrl}</premis:originalName>`)
    const info = text(bag, 'bag-info.txt')
    expect(info).toContain('Source-Organization: Test Desk\n')
    expect(info).toContain(`Seed-Uid: ${post.seedUid}\n`)

    const bagitPy = findBagitPy()
    if (bagitPy || bagitPyRequired()) {
      expect(bagitPy, 'bagit.py is not installed (pipx install bagit==1.9.0)').toBeDefined()
      const dir = await mkdtemp(path.join(tmpdir(), 'seed-export-archive-'))
      dirs.push(dir)
      await writeBagDirectory(bag, path.join(dir, 'bag'))
      const result = runBagitPy(bagitPy!, path.join(dir, 'bag'))
      expect(result.output).toContain('is valid')
    }
  }, 120000)

  it('refuses an item that was never published', async () => {
    const draft = await Item.create({ schemaName: SCHEMA_NAME, modelName: 'ArchivedPost', title: 'Draft' } as any)
    await waitForIdle(draft, 'Item', 15000)
    await expect(exportArchive(draft, { fetch: false })).rejects.toMatchObject({
      name: 'ArchiveExportError',
      code: 'not_published',
    })
  }, 60000)

  it('refuses an item with unpublished edits', async () => {
    const post = await createPublishedPost()
    const title = post.properties.find((p) => p.propertyName === 'title')!
    title.value = 'Edited after publish'
    await title.save()
    await waitForIdle(post, 'Item', 15000)
    const error = await exportArchive(post, { fetch: false }).catch((e) => e)
    expect(error).toBeInstanceOf(ArchiveExportError)
    expect(error.code).toBe('unpublished_changes')
    expect(error.message).toContain('title')
  }, 120000)
})
