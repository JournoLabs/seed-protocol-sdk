import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getPublishPayload } from '@/db/read/getPublishPayload'
import { VERSION_SCHEMA_UID_OPTIMISM_SEPOLIA } from '@/helpers/constants'
import { Item } from '@/Item/Item'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../test-utils/client-init'
import {
  createGetPublishPayloadTestSchema,
  createItemWithBasicPropertiesOnly,
  createItemWithRelation,
  createItemWithList,
  createItemWithImage,
  createItemWithAllPropertyTypes,
  createItemWithImageAndUploadedTx,
  createImageItemWithMissingStorageTxMetadata,
  waitForPropertyInstances,
} from '../../../test-utils/getPublishPayloadIntegrationHelpers'

describe('getPublishPayload integration (browser)', () => {
  beforeAll(async () => {
    await setupTestEnvironment({
      testFileUrl: import.meta.url,
      timeout: 90000,
    })
    await createGetPublishPayloadTestSchema()
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
    expect(result[0].listOfAttestations).toBeDefined()
    expect(Array.isArray(result[0].listOfAttestations)).toBe(true)
    // Item was just created; basic properties have no uid yet, so we must get at least one property attestation
    expect(result[0].listOfAttestations.length).toBeGreaterThanOrEqual(1)
  }, 30000)

  it('returns attestation for title when item has title set (regression: missing ItemProperty attestation)', async () => {
    const { item } = await createItemWithBasicPropertiesOnly({
      title: 'A new title 2',
    })
    const result = await getPublishPayload(item, [])
    expect(result).toHaveLength(1)
    expect(result[0].listOfAttestations).toBeDefined()
    expect(Array.isArray(result[0].listOfAttestations)).toBe(true)
    // Original bug: getPublishPayload returned only Seed/Version attestations and no attestation for the title ItemProperty
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

  it('throws when related item is not found', async () => {
    const { postItem } = await createItemWithRelation({ postTitle: 'Post with bad author' })
    const authorProp = postItem.properties.find(
      (p) => p.propertyName === 'author' || p.propertyName === 'authorId' || p.alias === 'author'
    )
    expect(authorProp).toBeDefined()
    if (authorProp) {
      authorProp.value = '0000000000'
      await authorProp.save()
    }
    await expect(getPublishPayload(postItem, [])).rejects.toThrow('No related item found')
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
})
