import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { BaseFileManager } from '@/helpers'
import { BaseDb } from '@/db/Db/BaseDb'
import { metadata } from '@/seedSchema'
import { Item } from '@/Item/Item'
import {
  estimateDataUriByteLength,
  summarizePublishWork,
} from '@/db/read/summarizePublishWork'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../../test-utils/client-init'
import {
  createGetPublishPayloadTestSchema,
  createItemWithBasicPropertiesOnly,
  createItemWithRelation,
  waitForPropertyInstances,
} from '../../test-utils/getPublishPayloadIntegrationHelpers'

/** Sets fields on a seed's row of a property (stored under one of `names`), as a save or sync would. */
const setRow = async (seedLocalId: string, names: string[], fields: Record<string, unknown>) => {
  const db = BaseDb.getAppDb()
  const rows = await db.select().from(metadata).where(eq(metadata.seedLocalId, seedLocalId))
  const row = rows.find((r: { propertyName: string | null }) => names.includes(r.propertyName ?? ''))
  expect(row, names.join('/')).toBeDefined()
  await db.update(metadata).set(fields).where(eq(metadata.localId, row!.localId!))
}

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe

testDescribe('estimateDataUriByteLength', () => {
  it('returns decoded size for a base64 data URI', () => {
    const bytes = new Uint8Array([1, 2, 3, 4])
    const b64 = Buffer.from(bytes).toString('base64')
    expect(estimateDataUriByteLength(`data:image/png;base64,${b64}`)).toBe(4)
  })

  it('returns null for non-data URIs', () => {
    expect(estimateDataUriByteLength('https://example.com/x.png')).toBeNull()
  })
})

testDescribe('summarizePublishWork integration', () => {
  beforeAll(async () => {
    await setupTestEnvironment({
      testFileUrl: import.meta.url,
      timeout: SETUP_HOOK_TIMEOUT_MS,
    })
    await createGetPublishPayloadTestSchema()
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it('counts attestations for basic properties on a new item', async () => {
    const { item } = await createItemWithBasicPropertiesOnly({
      title: 'Cost estimate title',
      count: 7,
      payload: '{"k":1}',
      isPublished: true,
    })
    const work = await summarizePublishWork(item)
    expect(work.publishMode).toBe('patch')
    expect(work.seedCount).toBe(1)
    expect(work.newSeedCount).toBe(1)
    expect(work.newVersionCount).toBe(1)
    expect(work.attestationCount).toBeGreaterThanOrEqual(3)
  }, 30000)

  it('includes unpublished related items in seed and attestation counts', async () => {
    const { authorItem, postItem } = await createItemWithRelation({
      authorName: 'Cost Author',
      postTitle: 'Post for cost',
    })
    const work = await summarizePublishWork(postItem)
    expect(work.seedCount).toBeGreaterThanOrEqual(2)
    expect(work.newSeedCount).toBeGreaterThanOrEqual(2)
    expect(work.attestationCount).toBeGreaterThanOrEqual(2)
    expect(authorItem.seedLocalId).toBeTruthy()
  }, 30000)

  it('patch skips properties that already have a UID; new_version counts them', async () => {
    const { item } = await createItemWithBasicPropertiesOnly({
      title: 'Has uid title',
    })
    await setRow(item.seedLocalId!, ['title'], { uid: `0x${'ab'.repeat(32)}` })
    const patch = await summarizePublishWork(item, { publishMode: 'patch' })
    const full = await summarizePublishWork(item, { publishMode: 'new_version' })
    expect(full.attestationCount).toBeGreaterThan(patch.attestationCount)
    expect(full.newVersionCount).toBeGreaterThanOrEqual(1)
  }, 30000)

  it('counts upload bytes from a storage-seed file path', async () => {
    const { item } = await createItemWithBasicPropertiesOnly({
      title: 'File bytes',
    })
    const dir = BaseFileManager.getFilesPath('images')
    await BaseFileManager.createDirIfNotExists(dir)
    const payload = new Uint8Array(2048).fill(7)
    const fileName = `summarize-work-${item.seedLocalId}.bin`
    const filePath = `${dir}/${fileName}`
    await BaseFileManager.saveFile(filePath, payload.buffer)
    expect(await BaseFileManager.getFileSize(filePath)).toBe(2048)

    const image = await Item.create({ modelName: 'Image' } as any)
    await waitForPropertyInstances(image as any)
    await setRow(item.seedLocalId!, ['coverImage', 'coverImageId'], {
      propertyValue: image.seedLocalId,
      refResolvedValue: fileName,
      localStorageDir: 'images',
    })

    const work = await summarizePublishWork(item)
    expect(work.uploadCount).toBeGreaterThanOrEqual(1)
    expect(work.uploadBytes).toBeGreaterThanOrEqual(2048)
  }, 30000)
})
