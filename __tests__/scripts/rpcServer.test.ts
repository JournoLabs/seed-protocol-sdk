import { describe, test, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import grpc from '@grpc/grpc-js'
import protoLoader from '@grpc/proto-loader'
import path from 'path'
import { fileURLToPath } from 'url'
import { BaseItem } from '@/Item/BaseItem'
import { getModel } from '@/stores/modelClass'
import { ClientManager } from '@/client/ClientManager'
import { client as sdkClient }                              from "@/client"
import { commandExists } from '@/helpers/scripts'
import { execSync } from 'child_process'
import config                                  from '@/test/__mocks__/node/project/schema'
import { CLIENT_NOT_INITIALIZED }        from '@/helpers/constants'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

interface SeedService {
  GetModels: Function;
  GetModel: Function;
  CreateItem: Function;
  GetItem: Function;
  UpdateItem: Function;
  DeleteItem: Function;
  QueryItems: Function;
  PublishItem: Function;
}

interface ModelResponse {
  models: Array<{
    name: string;
    properties: Array<{
      name: string;
      type: string;
      relation_model?: string;
      is_list?: boolean;
    }>;
  }>;
}

interface SingleModelResponse {
  model: {
    name: string;
    properties: Array<{
      name: string;
      type: string;
      relation_model?: string;
      is_list?: boolean;
    }>;
  };
}

interface ItemResponse {
  id: string;
  model_name: string;
  properties: Record<string, string>;
}

interface QueryResponse {
  items: Array<{
    id: string;
    model_name: string;
    properties: Record<string, string>;
  }>;
}

interface PublishResponse {
  success: boolean;
  message?: string;
}

describe('RPC Server', () => {
  let testConfig = Object.assign({}, config)
  let rpcClient: SeedService
  let server: grpc.Server
  let sdkTestClient: typeof ClientManager | undefined
  const PROTO_PATH = path.resolve(__dirname, '../../scripts/protos/seed.proto')

  testConfig.endpoints = {
    files: './__tests__/__mocks__/node/project/.seed',
    filePaths: 'api/seed/migrations',
  }

  // Helper function to create a gRPC client
  const createClient = () => {
    const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true
    })
    const seedProto = grpc.loadPackageDefinition(packageDefinition) as any
    return new seedProto.seed.SeedService('localhost:50051', grpc.credentials.createInsecure())
  }

  beforeAll(async () => {
    console.log('Starting rpc server')

    sdkTestClient = Object.assign({}, sdkClient)
    await sdkTestClient!.init({
      config: testConfig,
      addresses: [
        '0x1234567890123456789012345678901234567890',
      ],
    })

    const tsxExists = commandExists('tsx')

    if (!tsxExists) {
      execSync(`npm install -g tsx`, {stdio: 'inherit'})
    }

    // Create client
    rpcClient = createClient()
  })

  afterAll(() => {
    // No need to close the client since it's not part of the service interface
    // The server will be closed when the process ends
  })

  describe('Model Operations', () => {
    test('should get all models', async () => {
      const response = await new Promise<ModelResponse>((resolve, reject) => {
        rpcClient.GetModels({}, (error: any, response: ModelResponse) => {
          if (error) reject(error)
          else resolve(response)
        })
      })

      expect(response.models).toBeDefined()
      expect(Array.isArray(response.models)).toBe(true)
    }, 10000)

    test('should get a specific model', async () => {
      const response = await new Promise<SingleModelResponse>((resolve, reject) => {
        rpcClient.GetModel({ model_name: 'Post' }, (error: any, response: SingleModelResponse) => {
          if (error) reject(error)
          else resolve(response)
        })
      })

      expect(response.model).toBeDefined()
      expect(response.model.name).toBe('Post')
      expect(response.model.properties).toBeDefined()
    })

    test('should handle non-existent model', async () => {
      try {
        await new Promise<SingleModelResponse>((resolve, reject) => {
          rpcClient.GetModel({ model_name: 'NonExistentModel' }, (error: any) => {
            if (error) reject(error)
            else resolve({ model: { name: '', properties: [] } })
          })
        })
        throw new Error('Expected error was not thrown')
      } catch (error: any) {
        expect(error).toBeDefined()
        expect(error.code).toBe(grpc.status.NOT_FOUND)
      }
    })
  })

  describe('Item Operations', () => {
    let testItemId: string

    beforeEach(async () => {
      // Clear any existing items
      // This would depend on your actual implementation
    })

    test('should create an item', async () => {
      const testItem = {
        model_name: 'Post',
        properties: {
          title: 'Test Post',
          summary: 'Test Summary',
          html: '<p>Test content</p>',
          json: '{"content": "test"}',
          storageTransactionId: 'tx123'
        }
      }

      const response = await new Promise<ItemResponse>((resolve, reject) => {
        rpcClient.CreateItem(testItem, (error: any, response: ItemResponse) => {
          if (error) reject(error)
          else resolve(response)
        })
      })

      expect(response.id).toBeDefined()
      expect(response.model_name).toBe('Post')
      testItemId = response.id
    })

    test('should get an item', async () => {
      const response = await new Promise<ItemResponse>((resolve, reject) => {
        rpcClient.GetItem({ id: testItemId, model_name: 'Post' }, (error: any, response: ItemResponse) => {
          if (error) reject(error)
          else resolve(response)
        })
      })

      expect(response.id).toBe(testItemId)
      expect(response.model_name).toBe('Post')
      expect(response.properties).toBeDefined()
    })

    test('should update an item', async () => {
      const updateData = {
        id: testItemId,
        model_name: 'Post',
        properties: {
          title: 'Updated Title',
          summary: 'Updated Summary'
        }
      }

      const response = await new Promise<ItemResponse>((resolve, reject) => {
        rpcClient.UpdateItem(updateData, (error: any, response: ItemResponse) => {
          if (error) reject(error)
          else resolve(response)
        })
      })

      expect(response.id).toBe(testItemId)
      expect(response.properties.title).toBe('Updated Title')
    })

    test('should delete an item', async () => {
      const response = await new Promise<{ success: boolean }>((resolve, reject) => {
        rpcClient.DeleteItem({ id: testItemId, model_name: 'Post' }, (error: any, response: { success: boolean }) => {
          if (error) reject(error)
          else resolve(response)
        })
      })

      expect(response.success).toBe(true)
    })

    test('should handle non-existent item', async () => {
      try {
        await new Promise<ItemResponse>((resolve, reject) => {
          rpcClient.GetItem({ id: 'non-existent-id', model_name: 'Post' }, (error: any) => {
            if (error) reject(error)
            else resolve({ id: '', model_name: '', properties: {} })
          })
        })
        throw new Error('Expected error was not thrown')
      } catch (error: any) {
        expect(error).toBeDefined()
        expect(error.code).toBe(grpc.status.NOT_FOUND)
      }
    })
  })

  describe('Query Operations', () => {
    beforeEach(async () => {
      // Create some test items for querying
      await BaseItem.create({
        modelName: 'Post',
        title: 'Test Post 1',
        summary: 'Summary 1'
      } as any)
      await BaseItem.create({
        modelName: 'Post',
        title: 'Test Post 2',
        summary: 'Summary 2'
      } as any)
    })

    test('should query items with filters', async () => {
      const queryParams = {
        model_name: 'Post',
        filters: {
          title: 'Test Post 1'
        }
      }

      const response = await new Promise<QueryResponse>((resolve, reject) => {
        rpcClient.QueryItems(queryParams, (error: any, response: QueryResponse) => {
          if (error) reject(error)
          else resolve(response)
        })
      })

      expect(response.items).toBeDefined()
      expect(response.items).toHaveLength(1)
      expect(response.items[0].properties.title).toBe('Test Post 1')
    })

    test('should handle pagination in queries', async () => {
      const queryParams = {
        model_name: 'Post',
        limit: 1,
        offset: 1
      }

      const response = await new Promise<QueryResponse>((resolve, reject) => {
        rpcClient.QueryItems(queryParams, (error: any, response: QueryResponse) => {
          if (error) reject(error)
          else resolve(response)
        })
      })

      expect(response.items).toBeDefined()
      expect(response.items).toHaveLength(1)
      expect(response.items[0].properties.title).toBe('Test Post 2')
    })
  })

  describe('Publish Operations', () => {
    let publishItemId: string

    beforeEach(async () => {
      const item = await BaseItem.create({
        modelName: 'Post',
        title: 'Test Publish Post',
        summary: 'Test Summary'
      } as any)
      publishItemId = item.seedLocalId
    })

    test('should publish an item', async () => {
      const response = await new Promise<PublishResponse>((resolve, reject) => {
        rpcClient.PublishItem({ id: publishItemId, model_name: 'Post' }, (error: any, response: PublishResponse) => {
          if (error) reject(error)
          else resolve(response)
        })
      })

      expect(response.success).toBe(true)
    })

    test('should handle publish errors for non-existent items', async () => {
      try {
        await new Promise<PublishResponse>((resolve, reject) => {
          rpcClient.PublishItem({ id: 'non-existent-id', model_name: 'Post' }, (error: any) => {
            if (error) reject(error)
            else resolve({ success: false })
          })
        })
        throw new Error('Expected error was not thrown')
      } catch (error: any) {
        expect(error).toBeDefined()
        expect(error.code).toBe(grpc.status.NOT_FOUND)
      }
    })
  })
}) 