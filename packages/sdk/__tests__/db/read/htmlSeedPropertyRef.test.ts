import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { waitFor } from 'xstate'
import { Item } from '@/Item/Item'
import { importJsonSchema } from '@/imports/json'
import { generateId, getArweaveUrlForTransaction } from '@/helpers'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { BaseArweaveClient } from '@/helpers/ArweaveClient/BaseArweaveClient'
import { getPublishUploads } from '@/db/read/getPublishUploads'
import {
  HtmlSeedPropertyRefError,
  prepareHtmlEmbeddedImagesForPublish,
  rewriteHtmlEmbeddedImagesOnDisk,
} from '@/helpers/htmlEmbeddedDataUriPublish'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../../test-utils/client-init'
import {
  ensureModelUidsForGetPublishPayloadTest,
  ensurePropertySchemaUidsForGetPublishPayloadTest,
  waitForPropertyInstances,
} from '../../test-utils/getPublishPayloadIntegrationHelpers'
import { waitForIdle } from '../../test-utils/waitForIdle'

/**
 * `seed:property/<name>` in an item's Html stands for the Arweave URL of the item's <name> storage
 * property: the Html is held back from phase 1, the property is uploaded there, and the placeholder
 * is rewritten to its gateway URL before the Html is uploaded in phase 2.
 */
const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe.sequential

const SCHEMA_NAME = 'Test Schema htmlSeedPropertyRef'
const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const schemaFile = () => ({
  $schema: 'https://seedprotocol.org/schemas/data-model/v1',
  version: 1,
  id: generateId(),
  metadata: { name: SCHEMA_NAME, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  models: {
    ArchivePost: {
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

let txCounter = 0
const withTxIds = <U extends { seedLocalId: string }>(uploads: U[]) =>
  uploads.map((u) => ({ ...u, txId: `seedpropreftx${(++txCounter).toString().padStart(4, '0')}`.padEnd(43, 'x') }))

const pngBlob = () =>
  new Blob([Uint8Array.from(atob(TINY_PNG_B64), (c) => c.charCodeAt(0))], { type: 'image/png' })

const contextOf = (item: Item<any>, propertyName: string) => {
  const property = item.properties.find(
    (p) => p.propertyName === propertyName || p.propertyName === `${propertyName}Id`,
  )!
  return property.getService().getSnapshot().context as { propertyValue?: string; refResolvedValue?: string }
}

const readHtml = (item: Item<any>) =>
  BaseFileManager.readFileAsString(BaseFileManager.getFilesPath('html', contextOf(item, 'html').refResolvedValue!))

const createPost = async (html: string, withImage = true) => {
  const post = await Item.create({ schemaName: SCHEMA_NAME, modelName: 'ArchivePost', title: 'A post', html } as any)
  await waitForIdle(post, 'Item', 15000)
  await waitForPropertyInstances(post)
  if (withImage) {
    const featureImage = post.properties.find(
      (p) => p.propertyName === 'featureImage' || p.propertyName === 'featureImageId',
    )!
    featureImage.value = pngBlob()
    await waitFor(
      featureImage.getService(),
      (s) => {
        const ctx = s.context as Record<string, any>
        return (
          !!ctx.refResolvedValue &&
          ctx.refSeedType === 'image' &&
          typeof ctx.propertyValue === 'string' &&
          !/^(blob|data):/.test(ctx.propertyValue)
        )
      },
      { timeout: 15000 },
    )
  }
  return post
}

const ARCHIVE = (src: string) =>
  `<article class="h-entry">\r\n<header><h1 class="p-name">A post</h1>` +
  `<img class="u-featured" src="${src}"></header>\n<div class="e-content"><pre>\n\ncode</pre></div></article>`

testDescribe('seed:property/ placeholders in Html', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    const schema = schemaFile()
    await importJsonSchema({ contents: JSON.stringify(schema) }, schema.version)
    await ensureModelUidsForGetPublishPayloadTest(['ArchivePost', 'Image', 'File', 'Html'], SCHEMA_NAME)
    await ensurePropertySchemaUidsForGetPublishPayloadTest(schema as any)
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('defer the Html, then become the URL of the property uploaded in phase 1', async () => {
    vi.spyOn(BaseArweaveClient, 'createTransaction').mockImplementation(async () => ({ id: 'unsigned', tags: [] }) as any)
    const post = await createPost(ARCHIVE('seed:property/featureImage'))
    const htmlSeed = contextOf(post, 'html').propertyValue!
    const imageSeed = contextOf(post, 'featureImage').propertyValue!
    expect(htmlSeed).toBeTruthy()
    expect(imageSeed).toBeTruthy()

    // Deferred whatever the data URI policy.
    const { deferredHtmlSeedLocalIds } = await prepareHtmlEmbeddedImagesForPublish(post as any, 'preserve')
    expect(deferredHtmlSeedLocalIds).toEqual([htmlSeed])

    const phase1 = withTxIds(
      await getPublishUploads(post as any, [], undefined, { deferHtmlStorageSeedLocalIds: deferredHtmlSeedLocalIds }),
    )
    expect(phase1.map((u) => u.seedLocalId)).toContain(imageSeed)
    expect(phase1.map((u) => u.seedLocalId)).not.toContain(htmlSeed)

    await rewriteHtmlEmbeddedImagesOnDisk(post.seedLocalId, phase1, deferredHtmlSeedLocalIds)
    const imageUrl = getArweaveUrlForTransaction(phase1.find((u) => u.seedLocalId === imageSeed)!.txId)
    expect(await readHtml(post)).toBe(ARCHIVE(imageUrl))

    const phase2 = await getPublishUploads(post as any, [], undefined, { onlyHtmlStorageSeedLocalIds: deferredHtmlSeedLocalIds })
    expect(phase2.map((u) => u.seedLocalId)).toEqual([htmlSeed])
  }, 90000)

  it('use the published transaction of a property not uploaded in this publish', async () => {
    const post = await createPost(ARCHIVE('seed:property/featureImage'))
    const imageSeed = contextOf(post, 'featureImage').propertyValue!
    const imageItem = (await Item.find({ seedLocalId: imageSeed }))!
    const st = imageItem.internalProperties['storageTransactionId'] ?? imageItem.allProperties['storageTransactionId']
    const publishedTx = 'publishedfeatureimagetx'.padEnd(43, 'p')
    st!.value = publishedTx
    await st!.save()
    await waitForIdle(imageItem, 'Item', 15000)

    await rewriteHtmlEmbeddedImagesOnDisk(post.seedLocalId, [], [contextOf(post, 'html').propertyValue!])
    expect(await readHtml(post)).toBe(ARCHIVE(getArweaveUrlForTransaction(publishedTx)))
  }, 90000)

  it('fail the rewrite when the property was neither uploaded nor published', async () => {
    const post = await createPost(ARCHIVE('seed:property/featureImage'))
    const htmlSeed = contextOf(post, 'html').propertyValue!
    await expect(rewriteHtmlEmbeddedImagesOnDisk(post.seedLocalId, [], [htmlSeed])).rejects.toThrow(
      HtmlSeedPropertyRefError,
    )
    expect(await readHtml(post)).toBe(ARCHIVE('seed:property/featureImage'))
  }, 90000)

  it('leave Html that was not deferred untouched', async () => {
    const post = await createPost(ARCHIVE('seed:property/featureImage'))
    await rewriteHtmlEmbeddedImagesOnDisk(post.seedLocalId, [], [])
    expect(await readHtml(post)).toBe(ARCHIVE('seed:property/featureImage'))
  }, 90000)

  it('fail before upload when they name a missing, non-storage or empty property', async () => {
    for (const [src, withImage] of [
      ['seed:property/missing', true],
      ['seed:property/title', true],
      ['seed:property/html', true],
      ['seed:property/featureImage', false],
    ] as const) {
      const post = await createPost(ARCHIVE(src), withImage)
      await expect(prepareHtmlEmbeddedImagesForPublish(post as any, 'materialize')).rejects.toThrow(
        HtmlSeedPropertyRefError,
      )
    }
  }, 120000)
})
