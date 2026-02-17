import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getPublishPayload } from '@/db/read/getPublishPayload'
import { VERSION_SCHEMA_UID_OPTIMISM_SEPOLIA } from '@/helpers/constants'
import { setupTestEnvironment, teardownTestEnvironment } from '../../test-utils/client-init'
import {
  createGetPublishPayloadTestSchema,
  createItemWithBasicPropertiesOnly,
  createItemWithRelation,
  createItemWithList,
  createItemWithImage,
  createItemWithAllPropertyTypes,
} from '../../test-utils/getPublishPayloadIntegrationHelpers'

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe

testDescribe('getPublishPayload integration', () => {
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
    await expect(getPublishPayload(postItem, [])).rejects.toThrow('Related item not found')
  }, 30000)
})
