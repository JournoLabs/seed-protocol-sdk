import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { Item } from '@/Item/Item'
import { importJsonSchema } from '@/imports/json'
import { generateId } from '@/helpers'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { BaseArweaveClient } from '@/helpers/ArweaveClient/BaseArweaveClient'
import { getPublishPayload } from '@/db/read/getPublishPayload'
import { getPublishUploads } from '@/db/read/getPublishUploads'
import { RelatedItemUnpublishedError } from '@/db/read/publishErrors'
import { getUnpublishedRelatedItems, summarizePublishWork } from '@/db/read/summarizePublishWork'
import { updateSeedRevokedAt } from '@/db/write/updateSeedRevokedAt'
import {
  clearHtmlEmbeddedImageCoPublishRows,
  prepareHtmlEmbeddedImagesForPublish,
  rewriteHtmlEmbeddedImagesOnDisk,
} from '@/helpers/htmlEmbeddedDataUriPublish'
import { BaseDb } from '@/db/Db/BaseDb'
import { seeds, versions } from '@/seedSchema'
import { htmlEmbeddedImageCoPublish } from '@/seedSchema/HtmlEmbeddedImageCoPublishSchema'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../../test-utils/client-init'
import {
  ensureModelUidsForGetPublishPayloadTest,
  ensurePropertySchemaUidsForGetPublishPayloadTest,
  waitForPropertyInstances,
} from '../../test-utils/getPublishPayloadIntegrationHelpers'
import { waitForIdle } from '../../test-utils/waitForIdle'

/**
 * Images embedded in the Html of a draft item related to the published one are co-published like
 * the published item's own: materialized as Image items, uploaded before the Html (which is then
 * rewritten to point at them), attested with the related item, and checked for revoked seeds.
 */
const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe.sequential

const SCHEMA_NAME = 'Test Schema relatedDraftHtmlEmbed'
const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const DATA_URI = `data:image/png;base64,${TINY_PNG_B64}`

const schemaFile = () => ({
  $schema: 'https://seedprotocol.org/schemas/data-model/v1',
  version: 1,
  id: generateId(),
  metadata: { name: SCHEMA_NAME, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  models: {
    EmbedNote: {
      id: generateId(),
      properties: {
        label: { id: generateId(), type: 'Text' },
        noteBody: { id: generateId(), type: 'Html' },
      },
    },
    EmbedPage: {
      id: generateId(),
      properties: {
        title: { id: generateId(), type: 'Text' },
        pageBody: { id: generateId(), type: 'Html' },
      },
    },
    EmbedArticle: {
      id: generateId(),
      properties: {
        headline: { id: generateId(), type: 'Text' },
        note: { id: generateId(), type: 'Relation', model: 'EmbedNote' },
      },
    },
  },
  enums: {},
  migrations: [],
})

let uidCounter = 0
const nextUid = (): string => {
  uidCounter += 1
  const tail = `${Date.now().toString(16)}${uidCounter.toString(16).padStart(4, '0')}`
  return '0x' + ('e3bd0c' + tail).padEnd(64, 'd')
}

let txCounter = 0
/** Upload results as the publish flow passes them to getPublishPayload (each upload's Arweave tx id). */
const withTxIds = <U extends { seedLocalId: string }>(uploads: U[]) =>
  uploads.map((u) => ({ ...u, txId: `reldraftembedtx${(++txCounter).toString().padStart(4, '0')}`.padEnd(43, 'x') }))


/**
 * Applies each request's propertiesToUpdate the way multiPublish does (SeedPublishLib.setSeedReference):
 * in request order, the request's new seed uid (here: its localId) is written into data[0] of the one
 * attestation with that schema in the target request. Returns what each (target, schema) ends up holding.
 */
const applySeedReferencesLikeContract = (payload: any[]): Map<string, string> => {
  const indexByLocalId = new Map(payload.map((p, i) => [p.localId, i]))
  const written = new Map<string, string>()
  payload.forEach((request, i) => {
    for (const pu of request.propertiesToUpdate ?? []) {
      const targetIndex = indexByLocalId.get(pu.publishLocalId)
      if (targetIndex === undefined) throw new Error(`UnknownPublishLocalId ${pu.publishLocalId}`)
      if (targetIndex < i) throw new Error(`PublishTargetAlreadyAttested(${i}, ${targetIndex})`)
      const matches = payload[targetIndex].listOfAttestations.filter(
        (a: any) => String(a.schema).toLowerCase() === String(pu.propertySchemaUid).toLowerCase(),
      )
      if (matches.length !== 1 || matches[0].data.length !== 1) {
        throw new Error(`PropertyToUpdateNotFound/Ambiguous ${pu.publishLocalId} ${pu.propertySchemaUid}`)
      }
      written.set(`${pu.publishLocalId}:${String(pu.propertySchemaUid).toLowerCase()}`, request.localId)
    }
  })
  return written
}

const htmlPropertySchemaUid = (payload: any[], localId: string, propertyName: string): string => {
  const att = payload
    .find((p) => p.localId === localId)
    .listOfAttestations.find((a: any) => a._propertyName === propertyName)
  expect(att).toBeDefined()
  return String(att.schema).toLowerCase()
}

const createItem = async (props: Record<string, unknown>) => {
  const item = await Item.create({ schemaName: SCHEMA_NAME, ...props } as any)
  await waitForIdle(item, 'Item', 15000)
  await waitForPropertyInstances(item)
  return item
}

const htmlContext = (item: Item<any>, propertyName: string) =>
  (item.allProperties[propertyName]!.getService().getSnapshot() as any).context as {
    propertyValue?: string
    refResolvedValue?: string
  }

const coPublishRows = (parentSeedLocalId: string) =>
  BaseDb.getAppDb()
    .select()
    .from(htmlEmbeddedImageCoPublish)
    .where(eq(htmlEmbeddedImageCoPublish.parentSeedLocalId, parentSeedLocalId))

testDescribe('Html-embedded images of related draft items', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    const schema = schemaFile()
    await importJsonSchema({ contents: JSON.stringify(schema) }, schema.version)
    await ensureModelUidsForGetPublishPayloadTest(['EmbedNote', 'EmbedPage', 'EmbedArticle', 'Image', 'File', 'Html'], SCHEMA_NAME)
    await ensurePropertySchemaUidsForGetPublishPayloadTest(schema as any)
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const createArticleWithDraftNote = async (label: string) => {
    const note = await createItem({
      modelName: 'EmbedNote',
      label,
      noteBody: `<p>${label} <img src="${DATA_URI}"></p>`,
    })
    const article = await createItem({ modelName: 'EmbedArticle', headline: `About ${label}`, note: note.seedLocalId })
    return { note, article }
  }

  it('are materialized, uploaded before the Html, rewritten and attested with the related item', async () => {
    vi.spyOn(BaseArweaveClient, 'createTransaction').mockImplementation(async () => ({ id: 'unsigned', tags: [] }) as any)
    const { note, article } = await createArticleWithDraftNote('draft note')
    const noteHtmlSeed = htmlContext(note, 'noteBody').propertyValue!
    expect(noteHtmlSeed).toBeTruthy()

    // Preparation: the related draft's Html is deferred and its image gets an Image item + co-publish row.
    const { deferredHtmlSeedLocalIds } = await prepareHtmlEmbeddedImagesForPublish(article as any, 'materialize')
    expect(deferredHtmlSeedLocalIds).toEqual([noteHtmlSeed])
    const rows = await coPublishRows(note.seedLocalId)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.htmlSeedLocalId).toBe(noteHtmlSeed)
    const imageSeedLocalId = rows[0]!.imageSeedLocalId

    // Phase 1 uploads the embedded image, not the Html that still embeds it.
    const phase1 = withTxIds(
      await getPublishUploads(article as any, [], undefined, { deferHtmlStorageSeedLocalIds: deferredHtmlSeedLocalIds }),
    )
    expect(phase1.map((u) => u.seedLocalId)).toContain(imageSeedLocalId)
    expect(phase1.map((u) => u.seedLocalId)).not.toContain(noteHtmlSeed)

    // The Html is rewritten to the image's Arweave URL, then uploaded in phase 2.
    await rewriteHtmlEmbeddedImagesOnDisk(article.seedLocalId, phase1)
    const html = await BaseFileManager.readFileAsString(
      BaseFileManager.getFilesPath('html', htmlContext(note, 'noteBody').refResolvedValue!),
    )
    expect(html).not.toContain('data:image/')
    expect(html).toContain(phase1.find((u) => u.seedLocalId === imageSeedLocalId)!.txId)
    const phase2 = withTxIds(
      await getPublishUploads(article as any, [], undefined, { onlyHtmlStorageSeedLocalIds: deferredHtmlSeedLocalIds }),
    )
    expect(phase2.map((u) => u.seedLocalId)).toEqual([noteHtmlSeed])

    // The payload publishes the note with its Html, the Html seed, and the embedded image, which
    // fills in the note's Html property.
    const payload = await getPublishPayload(article as any, [...phase1, ...phase2] as any)
    const byLocalId = new Map(payload.map((p: any) => [p.localId, p]))
    expect([...byLocalId.keys()].sort()).toEqual(
      [article.seedLocalId, note.seedLocalId, noteHtmlSeed, imageSeedLocalId].sort(),
    )
    const notePayload = byLocalId.get(note.seedLocalId) as any
    expect(notePayload.listOfAttestations.map((a: any) => a._propertyName).sort()).toEqual(['label', 'noteBody'])
    // Only the Html seed fills in the note's Html property; the image is referenced by its Arweave
    // URL inside the Html, so it updates no property (it would overwrite the Html seed reference).
    const imagePayload = byLocalId.get(imageSeedLocalId) as any
    expect(imagePayload.propertiesToUpdate).toEqual([])
    const noteBodySchema = htmlPropertySchemaUid(payload, note.seedLocalId, 'noteBody')
    expect((byLocalId.get(noteHtmlSeed) as any).propertiesToUpdate).toEqual([
      { publishLocalId: note.seedLocalId, propertySchemaUid: expect.any(String) },
    ])
    expect(applySeedReferencesLikeContract(payload).get(`${note.seedLocalId}:${noteBodySchema}`)).toBe(noteHtmlSeed)

    const summary = await summarizePublishWork(article as any)
    expect(summary.unpublishedRelatedItems).toEqual([])

    await clearHtmlEmbeddedImageCoPublishRows(note.seedLocalId)
  }, 90000)

  it("a published item's own embedded image does not overwrite its Html seed reference", async () => {
    vi.spyOn(BaseArweaveClient, 'createTransaction').mockImplementation(async () => ({ id: 'unsigned', tags: [] }) as any)
    const page = await createItem({
      modelName: 'EmbedPage',
      title: 'root page',
      pageBody: `<p>root <img src="${DATA_URI}"></p>`,
    })
    const pageHtmlSeed = htmlContext(page, 'pageBody').propertyValue!
    expect(pageHtmlSeed).toBeTruthy()

    const { deferredHtmlSeedLocalIds } = await prepareHtmlEmbeddedImagesForPublish(page as any, 'materialize')
    expect(deferredHtmlSeedLocalIds).toEqual([pageHtmlSeed])
    const [row] = await coPublishRows(page.seedLocalId)
    const imageSeedLocalId = row!.imageSeedLocalId

    const phase1 = withTxIds(
      await getPublishUploads(page as any, [], undefined, { deferHtmlStorageSeedLocalIds: deferredHtmlSeedLocalIds }),
    )
    await rewriteHtmlEmbeddedImagesOnDisk(page.seedLocalId, phase1)
    const phase2 = withTxIds(
      await getPublishUploads(page as any, [], undefined, { onlyHtmlStorageSeedLocalIds: deferredHtmlSeedLocalIds }),
    )

    const payload = (await getPublishPayload(page as any, [...phase1, ...phase2] as any)) as any[]
    expect(payload.map((p) => p.localId).sort()).toEqual([page.seedLocalId, pageHtmlSeed, imageSeedLocalId].sort())
    const pageBodySchema = htmlPropertySchemaUid(payload, page.seedLocalId, 'pageBody')
    const updaters = payload.flatMap((p) =>
      (p.propertiesToUpdate ?? [])
        .filter((u: any) => u.publishLocalId === page.seedLocalId && String(u.propertySchemaUid).toLowerCase() === pageBodySchema)
        .map(() => p.localId),
    )
    expect(updaters).toEqual([pageHtmlSeed])
    expect(payload.find((p) => p.localId === imageSeedLocalId).propertiesToUpdate).toEqual([])
    expect(applySeedReferencesLikeContract(payload).get(`${page.seedLocalId}:${pageBodySchema}`)).toBe(pageHtmlSeed)

    await clearHtmlEmbeddedImageCoPublishRows(page.seedLocalId)
  }, 90000)

  it("a related draft's embedded image whose seed was revoked blocks the publish, naming its Html property", async () => {
    const { note, article } = await createArticleWithDraftNote('note with gone image')
    await prepareHtmlEmbeddedImagesForPublish(article as any, 'materialize')
    const [row] = await coPublishRows(note.seedLocalId)
    expect(row).toBeDefined()

    // The embedded image was published, then unpublished.
    const imageUid = nextUid()
    const db = BaseDb.getAppDb()
    await db.update(seeds).set({ uid: imageUid }).where(eq(seeds.localId, row!.imageSeedLocalId))
    await db
      .update(versions)
      .set({ uid: nextUid(), seedUid: imageUid, attestationCreatedAt: Date.now() })
      .where(eq(versions.seedLocalId, row!.imageSeedLocalId))
    await updateSeedRevokedAt({ seedLocalId: row!.imageSeedLocalId, revokedAt: Math.floor(Date.now() / 1000) })

    const expected = [
      { propertyName: 'noteBody', modelName: 'Image', seedLocalId: row!.imageSeedLocalId, seedUid: imageUid },
    ]
    const error = await getPublishPayload(article as any, []).catch((e) => e)
    expect(error).toBeInstanceOf(RelatedItemUnpublishedError)
    expect(error.unpublishedRelatedItems).toEqual(expected)
    expect(await getUnpublishedRelatedItems(article as any)).toEqual(expected)
    expect((await summarizePublishWork(article as any)).unpublishedRelatedItems).toEqual(expected)

    await clearHtmlEmbeddedImageCoPublishRows(note.seedLocalId)
  }, 90000)
})
