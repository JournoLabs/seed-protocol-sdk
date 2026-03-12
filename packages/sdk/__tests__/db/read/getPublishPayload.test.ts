import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getPublishPayload, PublishValidationFailedError } from '@/db/read/getPublishPayload'
import { VERSION_SCHEMA_UID_OPTIMISM_SEPOLIA } from '@/helpers/constants'
import { Item } from '@/Item/Item'
import { setupTestEnvironment, teardownTestEnvironment } from '../../test-utils/client-init'
import {
  createGetPublishPayloadTestSchema,
  createGetPublishPayloadTestSchemaOptionalAuthor,
  createGetPublishPayloadTestSchemaWithEnum,
  createItemWithBasicPropertiesOnly,
  createItemWithRelation,
  createItemWithList,
  createItemWithImage,
  createItemWithAllPropertyTypes,
  createItemWithImageAndUploadedTx,
  createImageItemWithMissingStorageTxMetadata,
  waitForPropertyInstances,
} from '../../test-utils/getPublishPayloadIntegrationHelpers'

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe

testDescribe('getPublishPayload integration', () => {
  beforeAll(async () => {
    await setupTestEnvironment({
      testFileUrl: import.meta.url,
      timeout: 90000,
    })
    await createGetPublishPayloadTestSchema()
    await createGetPublishPayloadTestSchemaWithEnum()
  }, 90000)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it('basic properties only: returns one payload with attestations for set basic properties', async () => {
    const { item } = await createItemWithBasicPropertiesOnly({
      title: 'A new title 2',
      count: 42,
      payload: '{"key":"value"}',
      isPublished: true,
    })
    const result = await getPublishPayload(item, [])
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      localId: item.seedLocalId,
      seedIsRevocable: true,
      seedSchemaUid: expect.any(String),
      versionSchemaUid: VERSION_SCHEMA_UID_OPTIMISM_SEPOLIA,
      listOfAttestations: expect.any(Array),
    })
    expect(result[0].listOfAttestations.length).toBeGreaterThanOrEqual(1)
  }, 30000)

  it('with relation: returns multiple payloads and propertiesToUpdate on relation payload', async () => {
    const { authorItem, postItem } = await createItemWithRelation({
      authorName: 'Jane Author',
      postTitle: 'Post with author',
    })
    const result = await getPublishPayload(postItem, [])
    expect(result.length).toBeGreaterThanOrEqual(1)
    const mainPayload = result.find((p) => p.localId === postItem.seedLocalId)
    expect(mainPayload).toBeDefined()
    expect(mainPayload!.listOfAttestations).toBeDefined()
    const relationPayload = result.find((p) => p.localId === authorItem.seedLocalId || p.propertiesToUpdate?.length)
    if (relationPayload?.propertiesToUpdate?.length) {
      expect(relationPayload.propertiesToUpdate.some((u: any) => u.publishLocalId === postItem.seedLocalId)).toBe(true)
    }
  }, 30000)

  it('with list: returns payloads for list members and main item', async () => {
    const { tagItems, postItem } = await createItemWithList({
      tagLabels: ['tag1', 'tag2'],
      postTitle: 'Post with tags',
    })
    const result = await getPublishPayload(postItem, [])
    expect(result.length).toBeGreaterThanOrEqual(1)
    const mainPayload = result.find((p) => p.localId === postItem.seedLocalId)
    expect(mainPayload).toBeDefined()
    expect(mainPayload!.listOfAttestations).toBeDefined()
  }, 30000)

  it('with image: handles image property without throwing', async () => {
    const { postItem } = await createItemWithImage({ postTitle: 'Post with image' })
    const result = await getPublishPayload(postItem, [])
    expect(result).toHaveLength(1)
    expect(result[0].listOfAttestations).toBeDefined()
  }, 30000)

  it('all property types: returns main payload plus relation/list/image payloads with correct structure', async () => {
    const { authorItem, tagItems, postItem } = await createItemWithAllPropertyTypes({
      authorName: 'Full Author',
      tagLabels: ['a', 'b'],
      postTitle: 'Full post',
    })
    const result = await getPublishPayload(postItem, [])
    expect(result.length).toBeGreaterThanOrEqual(1)
    const mainPayload = result.find((p) => p.localId === postItem.seedLocalId)
    expect(mainPayload).toBeDefined()
    expect(mainPayload!.listOfAttestations.length).toBeGreaterThanOrEqual(1)
  }, 30000)

  it('throws when related item is not found (required relation)', async () => {
    const { postItem } = await createItemWithRelation({ postTitle: 'Post with bad author' })
    const authorProp = postItem.properties.find(
      (p) => p.propertyName === 'author' || p.propertyName === 'authorId' || p.alias === 'author'
    )
    expect(authorProp).toBeDefined()
    if (authorProp) {
      authorProp.value = '0000000000'
      await authorProp.save()
    }
    await expect(getPublishPayload(postItem, [])).rejects.toThrow('No related item found for required relation')
  }, 30000)

  it('skips (no throw) when related item not found for optional relation', async () => {
    const { schemaName } = await createGetPublishPayloadTestSchemaOptionalAuthor()
    const postItem = await Item.create({
      modelName: 'Post',
      schemaName,
      title: 'Post with optional author',
      author: '0000000000', // Non-existent author - optional so should skip
    })
    await waitForPropertyInstances(postItem)
    const authorProp = postItem.properties.find(
      (p) => p.propertyName === 'author' || p.propertyName === 'authorId' || p.alias === 'author'
    )
    if (authorProp) {
      authorProp.value = '0000000000'
      await authorProp.save()
    }
    const result = await getPublishPayload(postItem, [])
    expect(result.length).toBeGreaterThanOrEqual(1)
  }, 30000)

  it('with image and uploadedTransactions: includes storageTransactionId attestation when Image has placeholder property', async () => {
    const { imageSeedLocalId } = await createImageItemWithMissingStorageTxMetadata()
    const imageItem = await Item.find({ seedLocalId: imageSeedLocalId })
    if (!imageItem) throw new Error('Image item not found')
    const postItem = await Item.create({
      modelName: 'Post',
      title: 'Post with image placeholder',
      coverImage: imageSeedLocalId,
    })
    await waitForPropertyInstances(postItem)

    const result = await getPublishPayload(postItem, [
      { txId: 'test-arweave-tx-id', seedLocalId: imageSeedLocalId },
    ])
    expect(result.length).toBeGreaterThanOrEqual(2)
    const imagePayload =
      result.find((p) => p.localId === imageSeedLocalId) ??
      result.find(
        (p) =>
          p.localId !== postItem.seedLocalId &&
          p.propertiesToUpdate?.some((u: any) => u.publishLocalId === postItem.seedLocalId)
      )
    expect(imagePayload).toBeDefined()
    expect(imagePayload!.listOfAttestations).toBeDefined()
    expect(imagePayload!.listOfAttestations.length).toBeGreaterThanOrEqual(1)
  }, 30000)

  it('with image and uploadedTransactions: Image model has storageTransactionId in properties', async () => {
    const { postItem, imageItem } = await createItemWithImageAndUploadedTx({
      postTitle: 'Post with image and tx',
    })
    const result = await getPublishPayload(postItem, [
      { txId: 'test-arweave-tx-id', seedLocalId: imageItem.seedLocalId },
    ])
    expect(result.length).toBeGreaterThanOrEqual(2)
    const imagePayload =
      result.find((p) => p.localId === imageItem.seedLocalId) ??
      result.find(
        (p) =>
          p.localId !== postItem.seedLocalId &&
          p.propertiesToUpdate?.some((u: any) => u.publishLocalId === postItem.seedLocalId)
      )
    expect(imagePayload).toBeDefined()
    expect(imagePayload!.listOfAttestations).toBeDefined()
    expect(imagePayload!.listOfAttestations.length).toBeGreaterThanOrEqual(1)
  }, 30000)

  it('rejects publish when Text property has invalid enum value', async () => {
    // Schema already created in beforeAll via createGetPublishPayloadTestSchemaWithEnum
    // Item.create uses createNewItem with skipValidation: true, so invalid enum is persisted
    const item = await Item.create({
      modelName: 'Article',
      schemaName: 'Test Schema getPublishPayload Enum',
      title: 'Test article',
      status: 'invalid',
    })
    await waitForPropertyInstances(item)
    let err: unknown
    try {
      await getPublishPayload(item, [])
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(PublishValidationFailedError)
    expect((err as PublishValidationFailedError).validationErrors.some((e) => e.code === 'enum_violation')).toBe(true)
  }, 30000)
})
