import { afterAll, beforeAll, beforeEach, vi } from 'vitest'
import { BaseQueryClient } from '@/helpers/QueryClient/BaseQueryClient'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { BaseEasClient } from '@/helpers/EasClient/BaseEasClient'

// Mock platform classes for testing
class MockFileManager extends BaseFileManager {
  static async getFs() {
    return {
      promises: {
        readFile: vi.fn().mockResolvedValue('mock content'),
        writeFile: vi.fn().mockResolvedValue(undefined),
        mkdir: vi.fn().mockResolvedValue(undefined),
        access: vi.fn().mockResolvedValue(undefined),
        rm: vi.fn().mockResolvedValue(undefined),
        unlink: vi.fn().mockResolvedValue(undefined),
      },
      existsSync: vi.fn().mockReturnValue(true),
      readFileSync: vi.fn().mockReturnValue('mock content'),
      writeFileSync: vi.fn().mockReturnValue(undefined),
      mkdirSync: vi.fn().mockReturnValue(undefined),
      copyFileSync: vi.fn().mockReturnValue(undefined),
      cpSync: vi.fn().mockReturnValue(undefined),
      readdirSync: vi.fn().mockReturnValue([]),
      statSync: vi.fn().mockReturnValue({ isFile: () => true, isDirectory: () => false }),
    }
  }

  // Override the instance method to prevent circular reference
  async getFs() {
    return MockFileManager.getFs()
  }
}

class MockQueryClient extends BaseQueryClient {
  static getQueryClient() {
    return {
      query: vi.fn().mockResolvedValue({ data: {} }),
      mutate: vi.fn().mockResolvedValue({ data: {} }),
      fetchQuery: vi.fn().mockImplementation(({ queryKey }) => {
        console.log('Mock fetchQuery called with queryKey:', queryKey)
        return Promise.resolve({ 
          data: { 
            schemas: [
              { id: 'mock-schema-uid', schema: 'some prefix string title' },
              { id: 'mock-schema-uid', schema: 'some prefix string summary' },
              { id: 'mock-schema-uid', schema: 'some prefix string html' },
              { id: 'mock-schema-uid', schema: 'some prefix string json' },
              { id: 'mock-schema-uid', schema: 'some prefix string storage_transaction_id' },
              { id: 'mock-schema-uid', schema: 'some prefix string feature_image' },
              { id: 'mock-schema-uid', schema: 'some prefix string author' },
              { id: 'mock-schema-uid', schema: 'some prefix string tags' },
              { id: 'mock-schema-uid', schema: 'some prefix string categories' }
            ] 
          } 
        })
      }),
      getQueryData: vi.fn().mockReturnValue(null),
    }
  }
}

class MockEasClient extends BaseEasClient {
  static getEasClient() {
    return {
      url: 'mock-url',
      requestConfig: {},
      rawRequest: vi.fn().mockResolvedValue({}),
      request: vi.fn().mockResolvedValue({}),
      setHeader: vi.fn(),
      setHeaders: vi.fn(),
      setEndpoint: vi.fn(),
      batchRequests: vi.fn().mockResolvedValue([]),
      attest: vi.fn().mockResolvedValue({}),
      getAttestation: vi.fn().mockResolvedValue({}),
    }
  }
}

beforeAll(async () => {
  // Set up platform classes
  BaseQueryClient.setPlatformClass(MockQueryClient)
  BaseFileManager.setPlatformClass(MockFileManager)
  BaseEasClient.setPlatformClass(MockEasClient)
  
  // Debug: Check if platform classes are set
  console.log('BaseQueryClient.PlatformClass:', BaseQueryClient.PlatformClass)
  console.log('BaseFileManager.PlatformClass:', BaseFileManager.PlatformClass)
  console.log('BaseEasClient.PlatformClass:', BaseEasClient.PlatformClass)
})

beforeEach(async () => {
  // Reset mocks before each test
  vi.clearAllMocks()
})

afterAll(async () => {
  // Clean up
  vi.restoreAllMocks()
})
