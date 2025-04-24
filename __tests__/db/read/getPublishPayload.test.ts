import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { BaseDb } from '@/db/Db/BaseDb'
import { BaseEasClient } from '@/helpers/EasClient/BaseEasClient'
import { BaseQueryClient } from '@/helpers/QueryClient/BaseQueryClient'
import { BaseItem } from '@/Item/BaseItem'
import { getPublishPayload } from '@/db/read/getPublishPayload'
import { ZERO_BYTES32 } from '@ethereum-attestation-service/eas-sdk'
import { VERSION_SCHEMA_UID_OPTIMISM_SEPOLIA } from '@/helpers/constants'

describe('getPublishPayload', () => {
  let db: ReturnType<typeof BaseDb.getAppDb>

  it('should generate a publish payload for an item with basic properties', async () => {
    const item = await BaseItem.create({
      modelName: 'Post',
      schema: {
        title: { type: 'string' },
        summary: { type: 'string' },
        html: { type: 'string' },
        json: { type: 'string' },
        storageTransactionId: { type: 'string' }
      },
      title: 'Test Post',
      summary: 'A test summary',
      html: '<p>Test content</p>',
      json: '{"content": "test"}',
      storageTransactionId: 'tx123'
    })

    const result = await getPublishPayload(item, [])
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      localId: expect.any(String),
      seedUid: ZERO_BYTES32,
      seedIsRevocable: true,
      seedSchemaUid: expect.any(String),
      versionSchemaUid: VERSION_SCHEMA_UID_OPTIMISM_SEPOLIA,
      versionUid: expect.any(String),
      listOfAttestations: expect.any(Array)
    })
  })

  it('should handle upload properties correctly', async () => {
    const item = await BaseItem.create({
      modelName: 'Post',
      schema: {
        title: { type: 'string' },
        summary: { type: 'string' },
        html: { type: 'string' },
        json: { type: 'string' },
        storageTransactionId: { type: 'string' },
        featureImage: { type: 'string' }
      },
      title: 'Test Post',
      summary: 'A test summary',
      html: '<p>Test content</p>',
      json: '{"content": "test"}',
      storageTransactionId: 'tx123',
      featureImage: 'image.jpg'
    })

    const uploadedTransactions = [{
      txId: 'mockTxId',
      seedLocalId: item.seedLocalId
    }]

    const result = await getPublishPayload(item, uploadedTransactions)
    expect(result).toHaveLength(1)
    expect(result[0].listOfAttestations).toHaveLength(expect.any(Number))
  })

  it('should handle relation properties correctly', async () => {
    const author = await BaseItem.create({
      modelName: 'Identity',
      schema: {
        name: { type: 'string' },
        profile: { type: 'string' },
        displayName: { type: 'string' },
        avatarImage: { type: 'string' }
      },
      name: 'John Doe',
      profile: 'profile123',
      displayName: 'JD',
      avatarImage: 'avatar.jpg'
    })

    const post = await BaseItem.create({
      modelName: 'Post',
      schema: {
        title: { type: 'string' },
        summary: { type: 'string' },
        html: { type: 'string' },
        json: { type: 'string' },
        storageTransactionId: { type: 'string' },
        authors: { type: 'array', items: { type: 'string' } }
      },
      title: 'Test Post',
      summary: 'A test summary',
      html: '<p>Test content</p>',
      json: '{"content": "test"}',
      storageTransactionId: 'tx123',
      authors: [author.seedLocalId]
    })

    const result = await getPublishPayload(post, [])
    expect(result.length).toBeGreaterThan(1)
    expect(result.some(payload => payload.localId === author.seedLocalId)).toBe(true)
  })

  it('should handle list properties correctly', async () => {
    const item = await BaseItem.create({
      modelName: 'TestModel',
      schema: {
        name: { type: 'string' },
        birthdate: { type: 'string' },
        age: { type: 'number' },
        isAlive: { type: 'boolean' },
        nicknames: { type: 'array', items: { type: 'string' } }
      },
      name: 'Test Item',
      birthdate: '2000-01-01',
      age: 24,
      isAlive: true,
      nicknames: ['nick1', 'nick2']
    })

    const result = await getPublishPayload(item, [])
    expect(result).toHaveLength(1)
    expect(result[0].listOfAttestations.some(att => 
      att.data[0].data.includes('nicknames')
    )).toBe(true)
  })

  it('should throw an error when schema UID is missing', async () => {
    const item = await BaseItem.create({
      modelName: 'Post',
      schema: {
        title: { type: 'string' },
        summary: { type: 'string' }
      },
      title: 'Test Post',
      summary: 'A test summary'
    })

    // Simulate missing schema UID
    await db.run('DELETE FROM seeds')

    await expect(getPublishPayload(item, [])).rejects.toThrow(/Schema uid not found/)
  })

  it('should throw an error when related item is not found', async () => {
    const post = await BaseItem.create({
      modelName: 'Post',
      schema: {
        title: { type: 'string' },
        summary: { type: 'string' },
        authors: { type: 'array', items: { type: 'string' } }
      },
      title: 'Test Post',
      summary: 'A test summary',
      authors: ['non-existent-id']
    })

    await expect(getPublishPayload(post, [])).rejects.toThrow(/No related item found/)
  })
}) 