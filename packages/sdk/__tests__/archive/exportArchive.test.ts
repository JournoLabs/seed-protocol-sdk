import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { mkdtemp, rm, unlink } from 'node:fs/promises'
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
import { metadata, seeds, versions } from '@/seedSchema'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { ArchiveExportError, exportArchive } from '@/archive/exportArchive'
import { rewriteHtmlEmbeddedImagesOnDisk } from '@/helpers/htmlEmbeddedDataUriPublish'
import { waitForPendingOutboxOps } from '@/outbox'
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

// EAS reads for reproducible bags; each test that needs them sets a fake chain.
const chainMocks = vi.hoisted(() => ({
  seeds: vi.fn(),
  versions: vi.fn(),
  properties: vi.fn(),
}))
vi.mock('@seedprotocol/eas', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getSeedsByUidsFromEas: (...args: unknown[]) => chainMocks.seeds(...args),
  getItemVersionsFromEas: (...args: unknown[]) => chainMocks.versions(...args),
  getCanonicalItemPropertiesFromEas: (...args: unknown[]) => chainMocks.properties(...args),
}))

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe.sequential

const SCHEMA_NAME = 'Test Schema exportArchive'
const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const PNG_BYTES = Uint8Array.from(atob(TINY_PNG_B64), (c) => c.charCodeAt(0))
const IMAGE_TX = 'exportarchivefeatureimagetx'.padEnd(43, 'x')

const schemaFile = () => ({
  $schema: 'https://seedprotocol.io/schemas/data-model/v1',
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
        author: { id: generateId(), type: 'Relation', model: 'ArchivedAuthor' },
        reviewerIds: { id: generateId(), type: 'List', refValueType: 'Relation', ref: 'ArchivedAuthor' },
      },
    },
    ArchivedAuthor: {
      id: generateId(),
      properties: {
        name: { id: generateId(), type: 'Text' },
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
  // The image seed's row is written by the outbox; under load it can land after the waitFor above.
  await waitForPendingOutboxOps()
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

const createAuthor = async (name: string): Promise<Item<any>> => {
  const author = await Item.create({ schemaName: SCHEMA_NAME, modelName: 'ArchivedAuthor', name } as any)
  await waitForIdle(author, 'Item', 15000)
  return author
}

/** A post with a Relation and a List of authors, as the publishing device stores them: by local id. */
async function createPostWithRelations(published: 'all' | 'post only' = 'all') {
  const [author, firstReviewer, secondReviewer] = await Promise.all(['Ann', 'Bo', 'Cy'].map(createAuthor))
  const post = await Item.create({
    schemaName: SCHEMA_NAME,
    modelName: 'ArchivedPost',
    title: 'A post with authors',
    author: author!.seedLocalId,
    reviewerIds: [firstReviewer!.seedLocalId, secondReviewer!.seedLocalId],
  } as any)
  await waitForIdle(post, 'Item', 15000)
  await waitForPendingOutboxOps()
  await markPublished(post, published === 'all' ? [author!, firstReviewer!, secondReviewer!] : [])
  return { post, author: author!, reviewers: [firstReviewer!, secondReviewer!] }
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
    await ensureModelUidsForGetPublishPayloadTest(['ArchivedPost', 'ArchivedAuthor', 'Image', 'File', 'Html'], SCHEMA_NAME)
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
    expect(premis).toContain(`<premis:originalName>ar://${IMAGE_TX}</premis:originalName>`)
    expect(premis).toContain('Time: attestation time recorded on the exporting device')
    expect(item.properties.title.attestedAtClock).toBe('local-record')
    const info = text(bag, 'bag-info.txt')
    expect(info).toContain('Source-Organization: Test Desk\n')
    expect(info).toContain(`Seed-Uid: ${post.seedUid}\n`)
    expect(info).toContain('Seed-Bag-Times: local-record\n')

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

  it('keeps a published relation and lists one it has no uid for', async () => {
    const { post, author } = await createPostWithRelations()
    const { bag, omitted } = await exportArchive(post, { fetch: false })
    expect(JSON.parse(text(bag, 'data/item.json')).properties.author.value).toBe(author.seedUid)
    expect(omitted).toEqual([])

    const { post: draftRelations } = await createPostWithRelations('post only')
    const { omitted: unnamed } = await exportArchive(draftRelations, { fetch: false })
    expect(unnamed.map((o) => o.property).sort()).toEqual(['author', 'reviewerIds'])
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

  describe('reproducible', () => {
    const T0 = 1791500000 // Version attested, unix seconds
    const ATTESTER = '0xDdDdDdDdDdDdDdDdDdDdDdDdDdDdDdDdDdDdDdDd'

    /** A chain that agrees with the post's rows; the title was patched a minute after the Version. */
    async function fakeChain(post: Item<any>, change: { newerVersion?: boolean; extraProperty?: boolean } = {}) {
      const db = BaseDb.getAppDb()
      const [version] = await db.select().from(versions).where(eq(versions.seedLocalId, post.seedLocalId))
      const rows = await db.select().from(metadata).where(eq(metadata.seedLocalId, post.seedLocalId))
      const att = (id: string, timeCreated: number, extra: Record<string, unknown> = {}) => ({
        id, attester: ATTESTER, timeCreated, revoked: false, revocationTime: 0, schemaId: `0x${'5'.repeat(64)}`, ...extra,
      })
      chainMocks.seeds.mockResolvedValue([att(post.seedUid!, T0)])
      chainMocks.versions.mockResolvedValue([
        att(version.uid, T0, { refUID: post.seedUid }),
        ...(change.newerVersion ? [att(`0x${'7'.repeat(64)}`, T0 + 600, { refUID: post.seedUid })] : []),
      ])
      chainMocks.properties.mockResolvedValue([
        ...rows
          .filter((r: any) => r.uid && r.versionUid === version.uid)
          .map((r: any) => att(r.uid, r.propertyName === 'title' ? T0 + 60 : T0, { refUID: version.uid })),
        ...(change.extraProperty ? [att(`0x${'8'.repeat(64)}`, T0 + 120, { refUID: version.uid })] : []),
      ])
    }

    /** What differs between two clients holding the same Version: recorded times and address case. */
    async function actLikeAnotherClient(post: Item<any>) {
      const db = BaseDb.getAppDb()
      await db.update(versions).set({ attestationCreatedAt: Date.now() }).where(eq(versions.seedLocalId, post.seedLocalId))
      await db.update(metadata).set({ attestationCreatedAt: Date.now() }).where(eq(metadata.seedLocalId, post.seedLocalId))
      await db.update(seeds).set({ publisher: ATTESTER.toLowerCase() }).where(eq(seeds.localId, post.seedLocalId))
    }

    afterEach(() => {
      chainMocks.seeds.mockReset()
      chainMocks.versions.mockReset()
      chainMocks.properties.mockReset()
    })

    it('gives the same bytes from two clients, with every time from the chain', async () => {
      const post = await createPublishedPost()
      await fakeChain(post)
      const first = await exportArchive(post, { fetch: false, reproducible: true })
      await actLikeAnotherClient(post)
      const second = await exportArchive(post, { fetch: false, reproducible: true })

      expect(validateBag(first.bag)).toEqual({ valid: true, errors: [] })
      expect(text(second.bag, 'tagmanifest-sha256.txt')).toBe(text(first.bag, 'tagmanifest-sha256.txt'))
      expect(second.bag.files.map((f) => [f.path, digestHex('sha256', f.bytes)])).toEqual(
        first.bag.files.map((f) => [f.path, digestHex('sha256', f.bytes)]),
      )

      const versionIso = new Date(T0 * 1000).toISOString()
      expect(text(first.bag, 'bag-info.txt')).toContain(`Bagging-Date: ${versionIso.slice(0, 10)}\n`)
      expect(text(first.bag, 'bag-info.txt')).toContain(`EAS-Attester: ${ATTESTER}\n`)
      expect(text(first.bag, 'bag-info.txt')).toContain('Seed-Bag-Times: chain-block\n')
      const premis = text(first.bag, 'metadata/premis.xml')
      expect(premis).toContain(`<premis:eventDateTime>${versionIso}</premis:eventDateTime>`)
      expect(premis).toContain(`<premis:eventDateTime>${new Date((T0 + 60) * 1000).toISOString()}</premis:eventDateTime>`)
      expect(premis).toContain('Time: EAS timeCreated, the block time on chain')
      expect(premis).not.toContain('exporting device')
      const item = JSON.parse(text(first.bag, 'data/item.json'))
      expect(item.reproducible).toBe(true)
      expect(item.properties.title).toMatchObject({ attestedAtClock: 'chain-block', attestedAt: new Date((T0 + 60) * 1000).toISOString() })

      // The same changes do show in an ordinary export.
      const local = await exportArchive(post, { fetch: false, baggingDate: new Date(T0 * 1000) })
      expect(text(local.bag, 'tagmanifest-sha256.txt')).not.toBe(text(first.bag, 'tagmanifest-sha256.txt'))
    }, 120000)

    it('records relations as seed uids, so a publisher and a syncing client get the same bag', async () => {
      const { post, author, reviewers } = await createPostWithRelations()
      await fakeChain(post)
      const publisher = await exportArchive(post, { fetch: false, reproducible: true })

      const item = JSON.parse(text(publisher.bag, 'data/item.json'))
      expect(item.properties.author.value).toBe(author.seedUid)
      expect(Object.values(item.properties).map((p: any) => p.value).flat()).toEqual(
        expect.arrayContaining(reviewers.map((r) => r.seedUid)),
      )

      // A client that synced the post holds the uids the chain has, not the publisher's local ids.
      const db = BaseDb.getAppDb()
      const rows = await db.select().from(metadata).where(eq(metadata.seedLocalId, post.seedLocalId))
      for (const row of rows) {
        const synced = [author, ...reviewers].reduce(
          (value: string | null, other) => value?.replaceAll(other.seedLocalId, other.seedUid!) ?? value,
          row.propertyValue,
        )
        await db.update(metadata).set({ propertyValue: synced }).where(eq(metadata.localId, row.localId!))
      }
      const syncing = await exportArchive(post, { fetch: false, reproducible: true })
      expect(text(syncing.bag, 'tagmanifest-sha256.txt')).toBe(text(publisher.bag, 'tagmanifest-sha256.txt'))
    }, 120000)

    it('refuses a relation it can only name by a local id', async () => {
      const { post } = await createPostWithRelations('post only')
      await fakeChain(post)
      await expect(exportArchive(post, { fetch: false, reproducible: true })).rejects.toMatchObject({ code: 'incomplete' })
    }, 120000)

    it('refuses a copy that is behind the chain', async () => {
      const post = await createPublishedPost()
      await fakeChain(post, { newerVersion: true })
      await expect(exportArchive(post, { fetch: false, reproducible: true })).rejects.toMatchObject({ code: 'not_synced' })
      await fakeChain(post, { extraProperty: true })
      await expect(exportArchive(post, { fetch: false, reproducible: true })).rejects.toMatchObject({ code: 'not_synced' })
    }, 120000)

    it('refuses when EAS is unreachable, with local-only options, or when a file is missing', async () => {
      const post = await createPublishedPost()
      chainMocks.seeds.mockRejectedValue(new Error('indexer down'))
      await expect(exportArchive(post, { fetch: false, reproducible: true })).rejects.toMatchObject({ code: 'chain_unavailable' })
      await expect(
        exportArchive(post, { fetch: false, reproducible: true, sourceOrganization: 'Desk' }),
      ).rejects.toMatchObject({ code: 'invalid_options' })

      await fakeChain(post)
      const image = contextOf(post, 'featureImage').refResolvedValue!
      await unlink(BaseFileManager.getFilesPath('images', image))
      await expect(exportArchive(post, { fetch: false, reproducible: true })).rejects.toMatchObject({ code: 'incomplete' })
    }, 120000)
  })
})
