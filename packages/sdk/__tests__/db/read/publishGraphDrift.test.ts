import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { Item } from '@/Item/Item'
import { importJsonSchema } from '@/imports/json'
import { generateId } from '@/helpers'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { BaseDb } from '@/db/Db/BaseDb'
import { metadata, properties, seeds } from '@/seedSchema'
import { htmlEmbeddedImageCoPublish } from '@/seedSchema/HtmlEmbeddedImageCoPublishSchema'
import { getPublishPayload } from '@/db/read/getPublishPayload'
import { getPublishUploadData } from '@/db/read/getPublishUploads'
import { summarizePublishWork } from '@/db/read/summarizePublishWork'
import { prepareHtmlEmbeddedImagesForPublish } from '@/helpers/htmlEmbeddedDataUriPublish'
import { writeItemStorageFile } from '@/helpers/itemStorageFile'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../../test-utils/client-init'
import {
  ensureModelUidsForGetPublishPayloadTest,
  ensurePropertySchemaUidsForGetPublishPayloadTest,
  waitForPropertyInstances,
} from '../../test-utils/getPublishPayloadIntegrationHelpers'
import { waitForIdle } from '../../test-utils/waitForIdle'
import { embeddedImageBytes, embeddedImageDataUri } from '../../test-utils/embeddedImage'

/**
 * Drift between the publish passes that each walked the draft graph by their own rules (audit
 * G18-2, G18-3, G18-6). They all read one row-based graph now (db/read/publishGraph.ts).
 */
const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe.sequential

const SCHEMA_NAME = 'Test Schema publishGraphDrift'

const schemaFile = () => ({
  $schema: 'https://seedprotocol.org/schemas/data-model/v1',
  version: 1,
  id: generateId(),
  metadata: { name: SCHEMA_NAME, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  models: {
    DriftPost: {
      id: generateId(),
      properties: {
        title: { id: generateId(), type: 'Text' },
        photo: { id: generateId(), type: 'Relation', refValueType: 'Image', model: 'Image' },
        storageTransactionId: { id: generateId(), type: 'Text' },
        body: { id: generateId(), type: 'Text', storage: { type: 'ItemStorage', path: '/html', extension: '.html' } },
        page: { id: generateId(), type: 'Html' },
      },
    },
  },
  enums: {},
  migrations: [],
})

const createPost = async (props: Record<string, unknown>) => {
  const item = await Item.create({ schemaName: SCHEMA_NAME, modelName: 'DriftPost', ...props } as any)
  await waitForIdle(item, 'Item', 15000)
  await waitForPropertyInstances(item)
  return item
}

/** The newest row of a property, stored under one of `names`. */
const rowOf = async (seedLocalId: string, names: string[]) =>
  (await BaseDb.getAppDb().select().from(metadata).where(eq(metadata.seedLocalId, seedLocalId)))
    .filter((r: { propertyName: string | null }) => names.includes(r.propertyName ?? ''))
    .sort((a: { createdAt: number | null }, b: { createdAt: number | null }) => (b.createdAt ?? 0) - (a.createdAt ?? 0))[0]

let txCounter = 0
const withTxIds = <U extends { seedLocalId: string }>(uploads: U[]) =>
  uploads.map((u) => ({ ...u, txId: `driftgraphtx${(++txCounter).toString().padStart(4, '0')}`.padEnd(43, 'x') }))

const attestationCount = (payload: { listOfAttestations: unknown[] }[]) =>
  payload.reduce((n, request) => n + request.listOfAttestations.length, 0)

testDescribe('publish passes agree on what a publish does', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    const schema = schemaFile()
    await importJsonSchema({ contents: JSON.stringify(schema) }, schema.version)
    await ensureModelUidsForGetPublishPayloadTest(['DriftPost', 'Image', 'File', 'Html'], SCHEMA_NAME)
    await ensurePropertySchemaUidsForGetPublishPayloadTest(schema as any)
    // A schema file's single Relation keeps no refValueType (schemaApply); a code-defined
    // Relation('Image', 'Image') stores it on the row.
    await BaseDb.getAppDb()
      .update(properties)
      .set({ refValueType: 'Image' })
      .where(eq(properties.schemaFileId, schema.models.DriftPost.properties.photo.id))
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it('a Relation→Image holding a saved file is uploaded once (G18-2)', async () => {
    const post = await createPost({ title: 'with photo' })
    // What saving a file to the property leaves (saveImage): a draft Image seed, its file in the
    // images folder, and the property's row naming both.
    const image = await Item.create({ modelName: 'Image' } as any)
    await waitForPropertyInstances(image as any)
    const imageSeed = image.seedLocalId
    const fileName = `${imageSeed}.png`
    await BaseFileManager.createDirIfNotExists(BaseFileManager.getFilesPath('images'))
    await BaseFileManager.saveFile(BaseFileManager.getFilesPath('images', fileName), embeddedImageBytes().buffer as ArrayBuffer)
    const photoRow = await rowOf(post.seedLocalId, ['photo', 'photoId'])
    expect(photoRow).toBeDefined()
    await BaseDb.getAppDb()
      .update(metadata)
      .set({ propertyValue: imageSeed, refResolvedValue: fileName, localStorageDir: '/images', refSeedType: 'image' })
      .where(eq(metadata.localId, photoRow!.localId!))

    const uploads = await getPublishUploadData(post)
    expect(uploads.map((u) => u.seedLocalId)).toEqual([imageSeed])

    // The image's request attests that one upload, and the estimate counts it once.
    const payload = await getPublishPayload(post, withTxIds(uploads))
    const imageRequest = payload.find((p) => p.localId === imageSeed)!
    expect(imageRequest.listOfAttestations.map((a) => a._propertyName)).toContain('storageTransactionId')
    const summary = await summarizePublishWork(post)
    expect(summary.uploadCount).toBe(1)
    expect(summary.attestationCount).toBe(attestationCount(payload))
  }, 90_000)

  it('the estimate counts ItemStorage files that only their rows name (G18-3)', async () => {
    const post = await createPost({ title: 'with body' })
    // Saved where no instance sees it (another tab; Node has no change feed): the file and its row.
    const html = '<p>from another tab</p>'
    const { fileName, localStorageDir } = await writeItemStorageFile(
      { seedId: post.seedLocalId, localStorageDir: '/html', filenameSuffix: '.html' },
      html,
    )
    const bodyRow = await rowOf(post.seedLocalId, ['body'])
    expect(bodyRow).toBeDefined()
    await BaseDb.getAppDb()
      .update(metadata)
      .set({ refResolvedValue: fileName, localStorageDir })
      .where(eq(metadata.localId, bodyRow!.localId!))
    expect(post.allProperties.body!.localStoragePath).toBeFalsy()

    const uploads = await getPublishUploadData(post)
    expect(uploads.map((u) => u.seedLocalId)).toEqual([post.seedLocalId])
    const summary = await summarizePublishWork(post)
    expect(summary.uploadCount).toBe(1)
    expect(summary.uploadBytes).toBe(new TextEncoder().encode(html).byteLength)
    // Its storage transaction attestation is counted too.
    const payload = await getPublishPayload(post, withTxIds(uploads))
    expect(payload[0]!.listOfAttestations.map((a) => a._propertyName)).toContain('storageTransactionId')
    expect(summary.attestationCount).toBe(attestationCount(payload))
  }, 90_000)

  it('a second attempt reuses the Image items of embedded images (G18-6)', async () => {
    const post = await createPost({ title: 'with embeds', page: `<p><img src="${embeddedImageDataUri()}"></p>` })
    const db = BaseDb.getAppDb()
    const coPublishRows = () =>
      db.select().from(htmlEmbeddedImageCoPublish).where(eq(htmlEmbeddedImageCoPublish.parentSeedLocalId, post.seedLocalId))
    const imageSeedCount = async () => (await db.select().from(seeds).where(and(eq(seeds.type, 'image')))).length

    await prepareHtmlEmbeddedImagesForPublish(post, 'materialize')
    const first = await coPublishRows()
    expect(first).toHaveLength(1)
    const imagesAfterFirst = await imageSeedCount()

    // The attempt failed before attesting (rows are cleared only after a successful attestation).
    await prepareHtmlEmbeddedImagesForPublish(post, 'materialize')
    const second = await coPublishRows()
    expect(second.map((r) => r.imageSeedLocalId)).toEqual(first.map((r) => r.imageSeedLocalId))
    expect(await imageSeedCount()).toBe(imagesAfterFirst)
  }, 90_000)
})
