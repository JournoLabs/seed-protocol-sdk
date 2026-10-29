import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { metadata, pendingWrites, seeds, versions } from '@/seedSchema'
import { Item } from '@/Item/Item'
import { importJsonSchema } from '@/imports/json'
import { generateId } from '@/helpers'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { outboxOpValue, startItemOutbox, waitForOutboxOp, type StorageValueOp } from '@/outbox'
import { outboxIdleForTests, pauseOutboxDrainForTests } from '@/outbox/outbox'
import type { SchemaFileFormat } from '@/types/import'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'
import { waitForIdle } from '../test-utils/waitForIdle'
import { waitForPropertyInstances } from '../test-utils/getPublishPayloadIntegrationHelpers'

/**
 * Html, File and Image values are written through the outbox as `storage` ops (ADR 0019): the
 * setter appends the op with the value (a string in the op, a Blob's bytes in a staged file);
 * preparing it writes the file, named after a new storage seed, and applying it creates that seed,
 * its version and the property row. A value that never applies never gets a file.
 */

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe.sequential
const SCHEMA_NAME = 'Test Schema Outbox Storage Values'

function schemaFile(): SchemaFileFormat {
  const now = new Date().toISOString()
  return {
    $schema: 'https://seedprotocol.io/schemas/data-model/v1',
    version: 1,
    id: generateId(),
    metadata: { name: SCHEMA_NAME, createdAt: now, updatedAt: now },
    models: {
      StoragePost: {
        id: generateId(),
        properties: {
          title: { id: generateId(), type: 'Text' },
          html: { id: generateId(), type: 'Html' },
          attachment: { id: generateId(), type: 'File' },
        },
      },
    },
    enums: {},
    migrations: [],
  } as SchemaFileFormat
}

testDescribe('storage values through the outbox', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    const file = schemaFile()
    await importJsonSchema({ contents: JSON.stringify(file) }, file.version)
    startItemOutbox()
  }, SETUP_HOOK_TIMEOUT_MS)

  afterEach(async () => {
    pauseOutboxDrainForTests(false)
    await outboxIdleForTests()
  })

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  const createPost = async () => {
    const post = await Item.create({ modelName: 'StoragePost', schemaName: SCHEMA_NAME, title: 'post' } as never)
    await waitForIdle(post, 'Item', 15000)
    await waitForPropertyInstances(post)
    return post
  }
  const propertyOf = (post: Item<any>, name: string) =>
    post.properties.find((p) => p.propertyName === name || p.propertyName === `${name}Id`)!
  const storageOps = (seedLocalId: string) =>
    BaseDb.getAppDb()
      .select()
      .from(pendingWrites)
      .where(and(eq(pendingWrites.seedLocalId, seedLocalId), eq(pendingWrites.kind, 'storage')))
      .orderBy(asc(pendingWrites.id))
  const seedRows = (localIds: string[]) =>
    BaseDb.getAppDb().select().from(seeds).where(inArray(seeds.localId, localIds))

  it('an Html value applies as a storage op: storage seed, version and property row', async () => {
    const post = await createPost()
    const html = propertyOf(post, 'html')
    html.value = '<p>stored</p>'
    await html.save()

    const [op] = await storageOps(post.seedLocalId)
    expect(op.status).toBe('applied')
    const value = outboxOpValue<StorageValueOp>(op)!
    const htmlSeedId = value.storageSeed.localId
    expect(await seedRows([htmlSeedId])).toHaveLength(1)
    expect(await BaseDb.getAppDb().select().from(versions).where(eq(versions.seedLocalId, htmlSeedId))).toHaveLength(1)
    const [row] = await BaseDb.getAppDb()
      .select()
      .from(metadata)
      .where(and(eq(metadata.seedLocalId, post.seedLocalId), inArray(metadata.propertyName, ['html', 'htmlId'])))
    expect(row.propertyValue).toBe(htmlSeedId)
    expect(await BaseFileManager.readFileAsString(BaseFileManager.getFilesPath('html', row.refResolvedValue!))).toBe(
      '<p>stored</p>',
    )
    post.unload()
  }, 30000)

  it('quick Html edits keep the newest; the superseded value gets no file and no seed', async () => {
    const post = await createPost()
    const html = propertyOf(post, 'html')
    pauseOutboxDrainForTests(true)
    html.value = '<p>older</p>'
    html.value = '<p>newer</p>'
    // Both appended before the setter returned
    await vi.waitFor(async () => expect(await storageOps(post.seedLocalId)).toHaveLength(2), { timeout: 10000 })

    const [older, newer] = await storageOps(post.seedLocalId)
    expect(outboxOpValue<StorageValueOp>(older)!.stage?.source).toBe('<p>older</p>')
    const olderFile = BaseFileManager.getFilesPath('html', outboxOpValue<StorageValueOp>(older)!.row!.refResolvedValue)
    expect(await BaseFileManager.pathExists(olderFile)).toBe(false)

    pauseOutboxDrainForTests(false)
    await Promise.all([waitForOutboxOp(older.opId), waitForOutboxOp(newer.opId)])
    const [olderAfter, newerAfter] = await storageOps(post.seedLocalId)
    expect([olderAfter.status, newerAfter.status]).toEqual(['superseded', 'applied'])

    expect(await BaseFileManager.pathExists(olderFile)).toBe(false)
    const olderSeed = outboxOpValue<StorageValueOp>(older)!.storageSeed.localId
    const newerSeed = outboxOpValue<StorageValueOp>(newer)!.storageSeed.localId
    expect((await seedRows([olderSeed, newerSeed])).map((row: { localId: string }) => row.localId)).toEqual([newerSeed])
    expect(html.value).toBe('<p>newer</p>')
    post.unload()
  }, 30000)

  it('a File value naming a file that was already there is never deleted', async () => {
    const post = await createPost()
    const name = `existing-${generateId()}.txt`
    const existingPath = BaseFileManager.getFilesPath('files', name)
    await BaseFileManager.createDirIfNotExists(BaseFileManager.getFilesPath('files'))
    await BaseFileManager.saveFile(existingPath, 'already here')

    const attachment = propertyOf(post, 'attachment')
    pauseOutboxDrainForTests(true)
    attachment.value = name
    await vi.waitFor(async () => expect(await storageOps(post.seedLocalId)).toHaveLength(1), { timeout: 10000 })
    attachment.value = 'replacing text content'
    await vi.waitFor(async () => expect(await storageOps(post.seedLocalId)).toHaveLength(2), { timeout: 10000 })
    const [byName] = await storageOps(post.seedLocalId)
    expect(outboxOpValue<StorageValueOp>(byName)!.stage?.source).toBe(name)

    pauseOutboxDrainForTests(false)
    await waitForOutboxOp(byName.opId)
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(await BaseFileManager.pathExists(existingPath)).toBe(true)
    post.unload()
  }, 30000)

  it('a newer Html value assigned while the older one’s file is written applies after it', async () => {
    const post = await createPost()
    const html = propertyOf(post, 'html')
    const original = BaseFileManager.saveFile.bind(BaseFileManager)
    let releaseOlder!: () => void
    const olderHeld = new Promise<void>((resolve) => (releaseOlder = resolve))
    let olderReached!: () => void
    const reached = new Promise<void>((resolve) => (olderReached = resolve))
    const spy = vi.spyOn(BaseFileManager, 'saveFile').mockImplementation(async (filePath, content) => {
      if (content === '<p>older, slow</p>') {
        olderReached()
        await olderHeld
      }
      return original(filePath, content)
    })
    try {
      // The drainer is writing the older value's file when the newer value is assigned
      html.value = '<p>older, slow</p>'
      await reached
      html.value = '<p>newer</p>'
      expect(html.value).toBe('<p>newer</p>')
      releaseOlder()
      const ops = await vi.waitFor(
        async () => {
          const all = await storageOps(post.seedLocalId)
          expect(all.map((op: { status: string }) => op.status)).toEqual(['applied', 'applied'])
          return all
        },
        { timeout: 10000 },
      )
      const newerSeed = outboxOpValue<StorageValueOp>(ops[1])!.storageSeed.localId
      const [row] = await BaseDb.getAppDb()
        .select()
        .from(metadata)
        .where(and(eq(metadata.seedLocalId, post.seedLocalId), inArray(metadata.propertyName, ['html', 'htmlId'])))
      expect(row.propertyValue).toBe(newerSeed)
      expect(await BaseFileManager.readFileAsString(BaseFileManager.getFilesPath('html', row.refResolvedValue!))).toBe(
        '<p>newer</p>',
      )
      await html.save()
      expect(html.value).toBe('<p>newer</p>')
    } finally {
      spy.mockRestore()
    }
    post.unload()
  }, 30000)
})
