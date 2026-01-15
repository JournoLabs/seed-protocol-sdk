import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { BaseDb } from '@/db/Db/BaseDb'
import { BaseEasClient } from '@/helpers/EasClient/BaseEasClient'
import { BaseQueryClient } from '@/helpers/QueryClient/BaseQueryClient'
import { Item } from '@/Item/Item'
import { getPublishPayload } from '@/db/read/getPublishPayload'
import { ZERO_BYTES32 } from '@ethereum-attestation-service/eas-sdk'
import { VERSION_SCHEMA_UID_OPTIMISM_SEPOLIA } from '@/helpers/constants'

// Mock the database operations
vi.mock('@/db/Db/BaseDb', () => ({
  BaseDb: {
    getAppDb: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      execute: vi.fn().mockResolvedValue([]),
      all: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue(null),
    }),
  },
}))

// Mock the schema operations
vi.mock('@/db/read/getSchemaUidForModel', () => ({
  getSchemaUidForModel: vi.fn().mockResolvedValue('mock-schema-uid'),
}))

describe('getPublishPayload', () => {
  let db: ReturnType<typeof BaseDb.getAppDb>

  beforeEach(() => {
    db = BaseDb.getAppDb()
    vi.clearAllMocks()
  })

  it('should generate a publish payload for an item with basic properties', async () => {
    // Mock the item creation
    const mockItem = {
      seedLocalId: 'mock-local-id',
      seedUid: ZERO_BYTES32,
      modelName: 'Post',
      schema: {
        title: { type: 'string' },
        summary: { type: 'string' },
        html: { type: 'string' },
        json: { type: 'string' },
        storageTransactionId: { type: 'string' }
      },
      properties: {
        title: {
          propertyName: 'title',
          propertyDef: { dataType: 'Text' },
          getService: () => ({
            getSnapshot: () => ({
              context: { propertyValue: 'Test Post' }
            })
          }),
          uid: null,
          save: vi.fn().mockResolvedValue(undefined)
        },
        summary: {
          propertyName: 'summary',
          propertyDef: { dataType: 'Text' },
          getService: () => ({
            getSnapshot: () => ({
              context: { propertyValue: 'A test summary' }
            })
          }),
          uid: null,
          save: vi.fn().mockResolvedValue(undefined)
        },
        html: {
          propertyName: 'html',
          propertyDef: { dataType: 'Text' },
          getService: () => ({
            getSnapshot: () => ({
              context: { propertyValue: '<p>Test content</p>' }
            })
          }),
          uid: null,
          save: vi.fn().mockResolvedValue(undefined)
        },
        json: {
          propertyName: 'json',
          propertyDef: { dataType: 'Json' },
          getService: () => ({
            getSnapshot: () => ({
              context: { propertyValue: '{"content": "test"}' }
            })
          }),
          uid: null,
          save: vi.fn().mockResolvedValue(undefined)
        },
        storageTransactionId: {
          propertyName: 'storageTransactionId',
          propertyDef: { dataType: 'Text' },
          getService: () => ({
            getSnapshot: () => ({
              context: { propertyValue: 'tx123' }
            })
          }),
          uid: null,
          save: vi.fn().mockResolvedValue(undefined)
        }
      }
    } as any

    const result = await getPublishPayload(mockItem, [])
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
    const mockItem = {
      seedLocalId: 'mock-local-id',
      seedUid: ZERO_BYTES32,
      modelName: 'Post',
      schema: {
        title: { type: 'string' },
        summary: { type: 'string' },
        html: { type: 'string' },
        json: { type: 'string' },
        storageTransactionId: { type: 'string' },
        featureImage: { type: 'string' }
      },
      properties: {
        title: {
          propertyName: 'title',
          propertyDef: { dataType: 'string' },
          getService: () => ({
            getSnapshot: () => ({
              context: { propertyValue: 'Test Post' }
            })
          }),
          uid: null
        },
        summary: {
          propertyName: 'summary',
          propertyDef: { dataType: 'string' },
          getService: () => ({
            getSnapshot: () => ({
              context: { propertyValue: 'A test summary' }
            })
          }),
          uid: null
        },
        html: {
          propertyName: 'html',
          propertyDef: { dataType: 'string' },
          getService: () => ({
            getSnapshot: () => ({
              context: { propertyValue: '<p>Test content</p>' }
            })
          }),
          uid: null
        },
        json: {
          propertyName: 'json',
          propertyDef: { dataType: 'string' },
          getService: () => ({
            getSnapshot: () => ({
              context: { propertyValue: '{"content": "test"}' }
            })
          }),
          uid: null
        },
        storageTransactionId: {
          propertyName: 'storageTransactionId',
          propertyDef: { dataType: 'Text' },
          getService: () => ({
            getSnapshot: () => ({
              context: { propertyValue: 'tx123' }
            })
          }),
          uid: null,
          save: vi.fn().mockResolvedValue(undefined)
        },
        featureImage: {
          propertyName: 'featureImage',
          propertyDef: { dataType: 'Text' },
          getService: () => ({
            getSnapshot: () => ({
              context: { propertyValue: 'image.jpg' }
            })
          }),
          uid: null,
          save: vi.fn().mockResolvedValue(undefined)
        }
      }
    } as any

    const uploadedTransactions = [{
      txId: 'mockTxId',
      seedLocalId: mockItem.seedLocalId
    }]

    const result = await getPublishPayload(mockItem, uploadedTransactions)
    expect(result).toHaveLength(1)
    expect(result[0].listOfAttestations).toHaveLength(expect.any(Number))
  })

  it('should handle relation properties correctly', async () => {
    const mockAuthor = {
      seedLocalId: 'author-local-id',
      seedUid: ZERO_BYTES32,
      modelName: 'Identity',
      schema: {
        name: { type: 'string' },
        profile: { type: 'string' },
        displayName: { type: 'string' },
        avatarImage: { type: 'string' }
      },
      properties: {
        name: { value: 'John Doe' },
        profile: { value: 'profile123' },
        displayName: { value: 'JD' },
        avatarImage: { value: 'avatar.jpg' }
      }
    } as any

    const mockPost = {
      seedLocalId: 'post-local-id',
      seedUid: ZERO_BYTES32,
      modelName: 'Post',
      schema: {
        title: { type: 'string' },
        summary: { type: 'string' },
        html: { type: 'string' },
        json: { type: 'string' },
        storageTransactionId: { type: 'string' },
        authors: { type: 'array', items: { type: 'string' } }
      },
      properties: {
        title: { value: 'Test Post' },
        summary: { value: 'A test summary' },
        html: { value: '<p>Test content</p>' },
        json: { value: '{"content": "test"}' },
        storageTransactionId: { value: 'tx123' },
        authors: { value: [mockAuthor.seedLocalId] }
      }
    } as any

    // Mock the database to return the author when queried
    db.get.mockResolvedValueOnce(mockAuthor)

    const result = await getPublishPayload(mockPost, [])
    expect(result).toHaveLength(1)
    expect(result[0].listOfAttestations).toHaveLength(expect.any(Number))
  })

  it('should handle list properties correctly', async () => {
    const mockItem = {
      seedLocalId: 'mock-local-id',
      seedUid: ZERO_BYTES32,
      modelName: 'Post',
      schema: {
        title: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        categories: { type: 'array', items: { type: 'string' } }
      },
      properties: {
        title: { value: 'Test Post' },
        tags: { value: ['tag1', 'tag2', 'tag3'] },
        categories: { value: ['tech', 'programming'] }
      }
    } as any

    const result = await getPublishPayload(mockItem, [])
    expect(result).toHaveLength(1)
    expect(result[0].listOfAttestations).toHaveLength(expect.any(Number))
  })

  it('should throw an error when schema UID is missing', async () => {
    const mockItem = {
      seedLocalId: 'mock-local-id',
      seedUid: ZERO_BYTES32,
      modelName: 'Post',
      schema: {},
      properties: {}
    } as any

    // Mock getSchemaUidForModel to return null
    const { getSchemaUidForModel } = await import('@/db/read/getSchemaUidForModel')
    vi.mocked(getSchemaUidForModel).mockResolvedValueOnce(null)

    await expect(getPublishPayload(mockItem, [])).rejects.toThrow('Schema UID not found')
  })

  it('should throw an error when related item is not found', async () => {
    const mockItem = {
      seedLocalId: 'mock-local-id',
      seedUid: ZERO_BYTES32,
      modelName: 'Post',
      schema: {
        author: { type: 'string' }
      },
      properties: {
        author: { value: 'non-existent-author-id' }
      }
    } as any

    // Mock the database to return null for the related item
    db.get.mockResolvedValueOnce(null)

    await expect(getPublishPayload(mockItem, [])).rejects.toThrow('Related item not found')
  })
}) 