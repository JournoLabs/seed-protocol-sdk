import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { BaseDb } from '@/db/Db/BaseDb'
import { versions } from '@/seedSchema'
import { desc, eq } from 'drizzle-orm'
import { updateVersionUid } from '@/db/write/updateVersionUid'
import { createVersion } from '@/db/write/createVersion'
import { createMetadata, MetadataValidationError } from '@/db/write/createMetadata'
import { createSeed } from '@/db/write/createSeed'
import { setGetPublisherForNewSeeds, getGetPublisherForNewSeeds } from '@/helpers/publishConfig'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'
import {
  createGetPublishPayloadTestSchema,
  createItemWithBasicPropertiesOnly,
} from '../test-utils/getPublishPayloadIntegrationHelpers'

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe

const TEST_VERSION_UID = '0x' + 'd'.repeat(64)

testDescribe('updateVersionUid, createVersion, createMetadata publisher', () => {
  // Model names are only unique per schema: scope createMetadata to this schema's Post.
  let postModelFileId: string

  beforeAll(async () => {
    await setupTestEnvironment({
      testFileUrl: import.meta.url,
      timeout: SETUP_HOOK_TIMEOUT_MS,
    })
    const { models } = await createGetPublishPayloadTestSchema()
    postModelFileId = models.Post.id!
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it('updateVersionUid gives the draft version the attester as publisher', async () => {
    const { item } = await createItemWithBasicPropertiesOnly({
      title: 'Version publisher test',
      count: 1,
    })
    const seedLocalId = item.seedLocalId!
    const db = BaseDb.getAppDb()

    const versionRows = await db
      .select({ localId: versions.localId, uid: versions.uid })
      .from(versions)
      .where(eq(versions.seedLocalId, seedLocalId))
      .orderBy(desc(versions.createdAt))
    const versionLocalId = versionRows[versionRows.length - 1]?.localId
    expect(versionLocalId).toBeTruthy()

    // Stamped with the EOA while a draft; attested by the smart account.
    await db
      .update(versions)
      .set({ publisher: '0x' + '1'.repeat(40) })
      .where(eq(versions.localId, versionLocalId!))

    const smartAccount = '0x' + '2'.repeat(40)
    await updateVersionUid({ seedLocalId, versionUid: TEST_VERSION_UID, publisher: smartAccount })

    const [row] = await db
      .select({ publisher: versions.publisher })
      .from(versions)
      .where(eq(versions.localId, versionLocalId!))
    expect(row?.publisher).toBe(smartAccount)
  })

  it('ignores a version uid the seed already has (patch publish via the modular executor)', async () => {
    // The executor's SeedPublished event reports the version a patch publish attached to: an
    // existing version. A local draft version must not take that uid.
    const { item } = await createItemWithBasicPropertiesOnly({ title: 'Existing version uid', count: 1 })
    const seedLocalId = item.seedLocalId!
    const db = BaseDb.getAppDb()
    const publishedVersionUid = '0x' + '4c7e0a'.padEnd(64, '9')
    await db
      .update(versions)
      .set({ uid: publishedVersionUid, attestationCreatedAt: Date.now() - 60_000 })
      .where(eq(versions.seedLocalId, seedLocalId))
    const draftLocalId = await createVersion({ seedLocalId, seedType: 'post' })
    const rowsFor = () =>
      db
        .select({ localId: versions.localId, uid: versions.uid })
        .from(versions)
        .where(eq(versions.seedLocalId, seedLocalId))
    const before = await rowsFor()

    await updateVersionUid({ seedLocalId, versionUid: publishedVersionUid, publisher: '0x' + 'd'.repeat(40) })
    // Same uid in another case (event decoding) is the same version.
    await updateVersionUid({ seedLocalId, versionUid: publishedVersionUid.toUpperCase().replace('0X', '0x') })

    const after = await rowsFor()
    expect(after).toEqual(before)
    expect(after.find((r: any) => r.localId === draftLocalId)?.uid ?? null).toBeNull()
    expect(after.filter((r: any) => r.uid?.toLowerCase() === publishedVersionUid)).toHaveLength(1)

    // A new version uid still goes onto the draft.
    const newVersionUid = '0x' + '4c7e0b'.padEnd(64, '9')
    await updateVersionUid({ seedLocalId, versionUid: newVersionUid })
    const final = await rowsFor()
    expect(final.find((r: any) => r.localId === draftLocalId)?.uid).toBe(newVersionUid)
    expect(final).toHaveLength(before.length)
  })

  it("createVersion takes the seed's publisher, not the getter's current address", async () => {
    const seedPublisher = '0x' + 'a'.repeat(40)
    const laterSession = '0x' + 'b'.repeat(40)
    setGetPublisherForNewSeeds(async () => seedPublisher)
    try {
      const seedLocalId = await createSeed({ type: 'test_post', seedUid: '0x' + 'e'.repeat(64) })
      setGetPublisherForNewSeeds(async () => laterSession)
      const versionLocalId = await createVersion({
        seedLocalId,
        seedType: 'test_post',
      })
      const db = BaseDb.getAppDb()
      const [row] = await db
        .select({ publisher: versions.publisher })
        .from(versions)
        .where(eq(versions.localId, versionLocalId))
      expect(row?.publisher).toBe(seedPublisher)
    } finally {
      setGetPublisherForNewSeeds(null)
    }
  })

  it('createVersion leaves publisher null when getter is not configured', async () => {
    const prev = getGetPublisherForNewSeeds()
    setGetPublisherForNewSeeds(null)
    try {
      const seedLocalId = await createSeed({ type: 'test_post', seedUid: '0x' + 'f'.repeat(64) })
      const versionLocalId = await createVersion({
        seedLocalId,
        seedType: 'test_post',
      })
      const db = BaseDb.getAppDb()
      const [row] = await db
        .select({ publisher: versions.publisher })
        .from(versions)
        .where(eq(versions.localId, versionLocalId))
      expect(row?.publisher).toBeNull()
    } finally {
      setGetPublisherForNewSeeds(prev)
    }
  })

  it("createMetadata takes the seed's publisher, not the getter's current address", async () => {
    const seedPublisher = '0x' + 'c'.repeat(40)
    const laterSession = '0x' + 'd'.repeat(40)
    setGetPublisherForNewSeeds(async () => seedPublisher)
    try {
      const seedLocalId = await createSeed({ type: 'test_post', seedUid: '0x' + '1'.repeat(64) })
      const versionLocalId = await createVersion({
        seedLocalId,
        seedType: 'test_post',
      })
      setGetPublisherForNewSeeds(async () => laterSession)
      const result = await createMetadata({
        seedLocalId,
        versionLocalId,
        propertyName: 'title',
        propertyValue: 'Test metadata publisher',
        modelName: 'Post',
      }, undefined, { modelFileId: postModelFileId })
      const db = BaseDb.getAppDb()
      const { metadata } = await import('@/seedSchema')
      const [row] = await db
        .select({ publisher: metadata.publisher })
        .from(metadata)
        .where(eq(metadata.localId, result.localId!))
      expect(row?.publisher).toBe(seedPublisher)
    } finally {
      setGetPublisherForNewSeeds(null)
    }
  })

  it('createMetadata throws MetadataValidationError when value violates enum validation', async () => {
    const seedLocalId = await createSeed({ type: 'test_post', seedUid: '0x' + '2'.repeat(64) })
    const versionLocalId = await createVersion({
      seedLocalId,
      seedType: 'test_post',
    })
    let err: unknown
    try {
      await createMetadata(
        {
          seedLocalId,
          versionLocalId,
          propertyName: 'status',
          propertyValue: 'invalid',
          modelName: 'Article',
        },
        {
          dataType: 'Text',
          validation: { enum: ['draft', 'published', 'archived'] },
        },
      )
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(MetadataValidationError)
    expect((err as MetadataValidationError).validationErrors.some((e) => e.code === 'enum_violation')).toBe(true)
  })

  it('createMetadata with skipValidation: true does not throw for invalid enum', async () => {
    const seedLocalId = await createSeed({ type: 'test_post', seedUid: '0x' + '3'.repeat(64) })
    const versionLocalId = await createVersion({
      seedLocalId,
      seedType: 'test_post',
    })
    const result = await createMetadata(
      {
        seedLocalId,
        versionLocalId,
        propertyName: 'status',
        propertyValue: 'invalid',
        modelName: 'Article',
      },
      {
        dataType: 'Text',
        validation: { enum: ['draft', 'published', 'archived'] },
      },
      { skipValidation: true },
    )
    expect(result).toBeDefined()
    expect(result.localId).toBeTruthy()
  })
})
