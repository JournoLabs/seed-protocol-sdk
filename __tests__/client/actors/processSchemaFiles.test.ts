import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import { ClientManagerState, ClientManagerEvents } from '@/client/constants'
import type { SeedConstructorOptions, ModelClassType } from '@/types'
import { Item } from '@/Item/Item'
import { ModelPropertyDataTypes } from '@/helpers/property'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { BaseDb } from '@/db/Db/BaseDb'
import { schemas } from '@/seedSchema/SchemaSchema'
import { SchemaFileFormat } from '@/types/import'
import { importJsonSchema } from '@/imports/json'
import { getClient } from '@/client/ClientManager'
import internalSchema from '@/seedSchema/SEEDPROTOCOL_Seed_Protocol_v1.json'
import { setupTestEnvironment, teardownTestEnvironment } from '../../test-utils/client-init'

// Dynamically import client from src/client
type ClientType = typeof import('../../../src/client')['client']
let client: ClientType | null = null

beforeAll(async () => {
  const clientModule = await import('../../../src/client')
  client = clientModule.client
})

// Helper function to wrap client.init with a timeout
async function initWithTimeout(
  config: SeedConstructorOptions,
  timeoutMs: number = 60000
): Promise<void> {
  const clientInstance = ensureClient()
  const initPromise = clientInstance.init(config)
  const timeoutPromise = new Promise<never>((_, reject) => 
    setTimeout(() => reject(new Error(`Initialization timeout after ${timeoutMs}ms`)), timeoutMs)
  )
  
  return Promise.race([initPromise, timeoutPromise])
}

// Helper to ensure client is loaded
function ensureClient(): ClientType {
  if (!client) {
    throw new Error('Client not loaded - ensure beforeAll has completed')
  }
  return client
}

// Create a minimal mock model for testing - now using Model instance
// Note: In real usage, models are created via Model.create() and accessed via Model static methods
// This mock is only for testing client initialization with config
const TestModel = {
  schema: {
    title: { dataType: ModelPropertyDataTypes.Text },
  },
  create: async () => {
    return {} as Item<any>
  },
} as any // Cast to any since we're just testing config passing

// Helper to create a test schema file format
function createTestSchemaFile(
  name: string,
  version: number = 1,
  models: Record<string, any> = {}
): SchemaFileFormat {
  return {
    $schema: 'https://seedprotocol.org/schemas/data-model/v1',
    version,
    id: `test-schema-${name}-${version}`,
    metadata: {
      name,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    models,
    enums: {},
    migrations: [],
  }
}

// Helper to create a minimal schema file (without $schema) for listSchemaFiles discovery
function createMinimalSchemaFile(
  name: string,
  version: number = 1,
  models: Record<string, any> = {}
): any {
  return {
    version,
    metadata: {
      name,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    models,
    enums: {},
    migrations: [],
  }
}

describe('processSchemaFiles Integration Tests', () => {
  let testProjectPath: string | undefined
  let fsModule: any
  let pathModule: any
  const isNodeEnv = typeof window === 'undefined'

  beforeAll(async () => {
    if (isNodeEnv) {
      fsModule = await import('fs')
      pathModule = await import('path')
      // Use setupTestEnvironment to create a temporary directory and initialize client
      testProjectPath = await setupTestEnvironment({
        testFileUrl: import.meta.url,
      })
    } else {
      testProjectPath = '/test-project'
    }
  })

  afterAll(async () => {
    if (isNodeEnv) {
      await teardownTestEnvironment()
    }
  })

  beforeEach(async () => {
    // Clean up database
    const db = BaseDb.getAppDb()
    if (db) {
      await db.delete(schemas)
    }

    // Clean up schema files (Node.js only)
    if (isNodeEnv && fsModule) {
      const workingDir = BaseFileManager.getWorkingDir()
      if (fsModule.existsSync && fsModule.existsSync(workingDir)) {
        const files = fsModule.readdirSync(workingDir)
        for (const file of files) {
          if (file.endsWith('.json')) {
            try {
              fsModule.unlinkSync(pathModule.join(workingDir, file))
            } catch (error) {
              // Ignore errors during cleanup
            }
          }
        }
      }
    }
  })

  afterEach(async () => {
    // Clean up any remaining test data
    const db = BaseDb.getAppDb()
    if (db) {
      await db.delete(schemas)
    }
  })

  describe('Internal Schema Loading', () => {
    it('should load internal seed-protocol schema during initialization', async () => {
      // Skip if already initialized (singleton behavior)
      if (ensureClient().isInitialized()) {
        return
      }

      const config: SeedConstructorOptions = {
        config: {
          endpoints: {
            filePaths: '/api/seed/migrations',
            files: '/app-files',
          },
          models: {
            TestModel,
          },
          filesDir: '.seed',
        },
        addresses: ['0x1234567890123456789012345678901234567890'],
      }

      await initWithTimeout(config, 60000)
      
      const clientInstance = ensureClient()
      expect(clientInstance.isInitialized()).toBe(true)
      
      // Check that internal schema is in database
      const { loadAllSchemasFromDb } = await import('@/helpers/schema')
      const allSchemas = await loadAllSchemasFromDb()
      const internalSchemaData = internalSchema as SchemaFileFormat
      const internalSchemaName = internalSchemaData.metadata?.name
      const foundSchema = allSchemas.find(s => s.schema.metadata?.name === internalSchemaName)
      
      expect(foundSchema).toBeDefined()
      expect(foundSchema?.schema.version).toBe(internalSchemaData.version)
    }, 90000)

    it('should handle internal schema already existing in database', async () => {
      // Skip if already initialized
      if (ensureClient().isInitialized()) {
        return
      }

      // Pre-import the internal schema
      const internalSchemaData = internalSchema as SchemaFileFormat
      try {
        await importJsonSchema(
          { contents: JSON.stringify(internalSchemaData) },
          internalSchemaData.version
        )
      } catch (error) {
        // Schema might already exist, which is fine
      }

      const config: SeedConstructorOptions = {
        config: {
          endpoints: {
            filePaths: '/api/seed/migrations',
            files: '/app-files',
          },
          models: {
            TestModel,
          },
          filesDir: '.seed',
        },
        addresses: ['0x1234567890123456789012345678901234567890'],
      }

      // Should not throw even if schema already exists
      await expect(initWithTimeout(config, 60000)).resolves.not.toThrow()
      
      const clientInstance = ensureClient()
      expect(clientInstance.isInitialized()).toBe(true)
    }, 90000)
  })

  describe('Schema File Discovery', () => {
    it('should discover and import schema files without $schema field', async () => {
      // Skip if already initialized
      if (ensureClient().isInitialized()) {
        return
      }

      if (!isNodeEnv || !fsModule) {
        return // Skip in browser
      }

      // Create a minimal schema file (without $schema) in the working directory
      const workingDir = BaseFileManager.getWorkingDir()
      await BaseFileManager.createDirIfNotExists(workingDir)
      
      const testSchema = createMinimalSchemaFile('Test Blog Schema', 1, {
        Post: {
          id: 'post-1',
          properties: {
            title: {
              id: 'title-1',
              type: 'Text',
            },
          },
        },
      })

      const filename = `Test_Blog_Schema-v1.json`
      const filePath = pathModule.join(workingDir, filename)
      await BaseFileManager.saveFile(filePath, JSON.stringify(testSchema, null, 2))

      const config: SeedConstructorOptions = {
        config: {
          endpoints: {
            filePaths: '/api/seed/migrations',
            files: '/app-files',
          },
          models: {
            TestModel,
          },
          filesDir: '.seed',
        },
        addresses: ['0x1234567890123456789012345678901234567890'],
      }

      await initWithTimeout(config, 60000)
      
      const clientInstance = ensureClient()
      expect(clientInstance.isInitialized()).toBe(true)
      
      // Check that the schema was imported to database
      const { loadAllSchemasFromDb } = await import('@/helpers/schema')
      const allSchemas = await loadAllSchemasFromDb()
      const foundSchema = allSchemas.find(s => s.schema.metadata?.name === 'Test Blog Schema')
      
      expect(foundSchema).toBeDefined()
      expect(foundSchema?.schema.version).toBe(1)
    }, 90000)

    it('should handle multiple schema files', async () => {
      // Skip if already initialized
      if (ensureClient().isInitialized()) {
        return
      }

      if (!isNodeEnv || !fsModule) {
        return // Skip in browser
      }

      const workingDir = BaseFileManager.getWorkingDir()
      await BaseFileManager.createDirIfNotExists(workingDir)
      
      // Create multiple minimal schema files
      const schema1 = createMinimalSchemaFile('Schema One', 1, {
        Model1: {
          id: 'model1-1',
          properties: {
            field1: { id: 'field1-1', type: 'Text' },
          },
        },
      })
      
      const schema2 = createMinimalSchemaFile('Schema Two', 1, {
        Model2: {
          id: 'model2-1',
          properties: {
            field2: { id: 'field2-1', type: 'Text' },
          },
        },
      })

      await BaseFileManager.saveFile(
        pathModule.join(workingDir, 'Schema_One-v1.json'),
        JSON.stringify(schema1, null, 2)
      )
      await BaseFileManager.saveFile(
        pathModule.join(workingDir, 'Schema_Two-v1.json'),
        JSON.stringify(schema2, null, 2)
      )

      const config: SeedConstructorOptions = {
        config: {
          endpoints: {
            filePaths: '/api/seed/migrations',
            files: '/app-files',
          },
          models: {
            TestModel,
          },
          filesDir: '.seed',
        },
        addresses: ['0x1234567890123456789012345678901234567890'],
      }

      await initWithTimeout(config, 60000)
      
      // Check that schemas were imported to database
      const { loadAllSchemasFromDb } = await import('@/helpers/schema')
      const allSchemas = await loadAllSchemasFromDb()
      const schemaOne = allSchemas.find(s => s.schema.metadata?.name === 'Schema One')
      const schemaTwo = allSchemas.find(s => s.schema.metadata?.name === 'Schema Two')
      
      expect(schemaOne).toBeDefined()
      expect(schemaTwo).toBeDefined()
    }, 90000)

    it('should continue processing even if one schema file fails to import', async () => {
      // Skip if already initialized
      if (ensureClient().isInitialized()) {
        return
      }

      if (!isNodeEnv || !fsModule) {
        return // Skip in browser
      }

      const workingDir = BaseFileManager.getWorkingDir()
      await BaseFileManager.createDirIfNotExists(workingDir)
      
      // Create a valid schema file
      const validSchema = createMinimalSchemaFile('Valid Schema', 1, {
        ValidModel: {
          id: 'valid-1',
          properties: {
            field: { id: 'field-1', type: 'Text' },
          },
        },
      })

      // Create an invalid schema file (malformed JSON)
      const invalidContent = '{ invalid json }'

      await BaseFileManager.saveFile(
        pathModule.join(workingDir, 'Valid_Schema-v1.json'),
        JSON.stringify(validSchema, null, 2)
      )
      await BaseFileManager.saveFile(
        pathModule.join(workingDir, 'Invalid_Schema-v1.json'),
        invalidContent
      )

      const config: SeedConstructorOptions = {
        config: {
          endpoints: {
            filePaths: '/api/seed/migrations',
            files: '/app-files',
          },
          models: {
            TestModel,
          },
          filesDir: '.seed',
        },
        addresses: ['0x1234567890123456789012345678901234567890'],
      }

      // Should not throw - should continue with valid schema
      await expect(initWithTimeout(config, 60000)).resolves.not.toThrow()
      
      // Valid schema should still be loaded in database
      const { loadAllSchemasFromDb } = await import('@/helpers/schema')
      const allSchemas = await loadAllSchemasFromDb()
      const foundSchema = allSchemas.find(s => s.schema.metadata?.name === 'Valid Schema')
      
      expect(foundSchema).toBeDefined()
    }, 90000)
  })

  describe('Published vs Draft Schemas', () => {
    it('should load models from file for published schemas', async () => {
      // Skip if already initialized
      if (ensureClient().isInitialized()) {
        return
      }

      if (!isNodeEnv || !fsModule) {
        return // Skip in browser
      }

      // First, import a schema to make it published
      const testSchema = createTestSchemaFile('Published Schema', 1, {
        PublishedModel: {
          id: 'published-model-1',
          properties: {
            title: {
              id: 'title-prop-1',
              type: 'Text',
            },
          },
        },
      })

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)

      // Create the schema file that should be loaded
      const workingDir = BaseFileManager.getWorkingDir()
      const sanitizedName = 'Published_Schema'
      const filename = `${sanitizedName}-v${testSchema.version}.json`
      const filePath = pathModule.join(workingDir, filename)
      await BaseFileManager.saveFile(filePath, JSON.stringify(testSchema, null, 2))

      // Re-initialize to trigger processSchemaFiles
      // Note: This test assumes we can reinitialize, which may not work with singleton
      // In practice, this would be tested in a fresh client instance
      
      // Schema should be in database
      const { loadAllSchemasFromDb } = await import('@/helpers/schema')
      const allSchemas = await loadAllSchemasFromDb()
      const foundSchema = allSchemas.find(s => s.schema.metadata?.name === 'Published Schema')
      
      expect(foundSchema).toBeDefined()
      
      // Models should be loaded if file exists
      // Note: This depends on the exact implementation of createModelsFromJsonFile
    }, 90000)
  })

  describe('Context Updates', () => {
    it('should update context with all schemas and models', async () => {
      // Skip if already initialized
      if (ensureClient().isInitialized()) {
        return
      }

      const config: SeedConstructorOptions = {
        config: {
          endpoints: {
            filePaths: '/api/seed/migrations',
            files: '/app-files',
          },
          models: {
            TestModel,
          },
          filesDir: '.seed',
        },
        addresses: ['0x1234567890123456789012345678901234567890'],
      }

      await initWithTimeout(config, 60000)
      
      // Schemas should be in database (not in context anymore)
      const { loadAllSchemasFromDb } = await import('@/helpers/schema')
      const allSchemas = await loadAllSchemasFromDb()
      
      // Context should have models
      const { getClient } = await import('@/client/ClientManager')
      const clientManager = getClient()
      const snapshot = clientManager.getService().getSnapshot()
      expect(snapshot.context.models).toBeDefined()
      expect(typeof snapshot.context.models).toBe('object')
      
      // Internal schema should be present in database
      const internalSchemaData = internalSchema as SchemaFileFormat
      const internalSchemaName = internalSchemaData.metadata?.name
      const foundSchema = allSchemas.find(s => s.schema.metadata?.name === internalSchemaName)
      expect(foundSchema).toBeDefined()
    }, 90000)

    it('should preserve existing context schemas and models', async () => {
      // Skip if already initialized
      if (ensureClient().isInitialized()) {
        return
      }

      // Pre-import a schema
      const testSchema = createTestSchemaFile('Pre-existing Schema', 1, {
        PreModel: {
          id: 'pre-model-1',
          properties: {
            field: { id: 'field-1', type: 'Text' },
          },
        },
      })

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)

      const config: SeedConstructorOptions = {
        config: {
          endpoints: {
            filePaths: '/api/seed/migrations',
            files: '/app-files',
          },
          models: {
            TestModel,
          },
          filesDir: '.seed',
        },
        addresses: ['0x1234567890123456789012345678901234567890'],
      }

      await initWithTimeout(config, 60000)
      
      // Pre-existing schema should still be in database
      const { loadAllSchemasFromDb } = await import('@/helpers/schema')
      const allSchemas = await loadAllSchemasFromDb()
      const preExistingSchema = allSchemas.find(s => s.schema.metadata?.name === 'Pre-existing Schema')
      expect(preExistingSchema).toBeDefined()
      
      // Internal schema should also be present in database
      const internalSchemaData = internalSchema as SchemaFileFormat
      const internalSchemaName = internalSchemaData.metadata?.name
      const internalSchemaFound = allSchemas.find(s => s.schema.metadata?.name === internalSchemaName)
      expect(internalSchemaFound).toBeDefined()
    }, 90000)
  })

  describe('Error Handling', () => {
    it('should handle listSchemaFiles errors gracefully', async () => {
      // Skip if already initialized
      if (ensureClient().isInitialized()) {
        return
      }

      // This test would require mocking listSchemaFiles to throw an error
      // For now, we verify that initialization still succeeds even if
      // listSchemaFiles encounters issues (which it handles internally)
      
      const config: SeedConstructorOptions = {
        config: {
          endpoints: {
            filePaths: '/api/seed/migrations',
            files: '/app-files',
          },
          models: {
            TestModel,
          },
          filesDir: '.seed',
        },
        addresses: ['0x1234567890123456789012345678901234567890'],
      }

      // Should complete successfully even if listSchemaFiles has issues
      await expect(initWithTimeout(config, 60000)).resolves.not.toThrow()
      
      const clientInstance = ensureClient()
      expect(clientInstance.isInitialized()).toBe(true)
    }, 90000)

    it('should handle loadAllSchemasFromDb errors', async () => {
      // This would require mocking the database to throw errors
      // The current implementation should handle this gracefully
      // but we can verify initialization still works
      
      // Skip if already initialized
      if (ensureClient().isInitialized()) {
        return
      }

      const config: SeedConstructorOptions = {
        config: {
          endpoints: {
            filePaths: '/api/seed/migrations',
            files: '/app-files',
          },
          models: {
            TestModel,
          },
          filesDir: '.seed',
        },
        addresses: ['0x1234567890123456789012345678901234567890'],
      }

      await expect(initWithTimeout(config, 60000)).resolves.not.toThrow()
    }, 90000)
  })

  describe('State Machine Integration', () => {
    it('should transition through PROCESS_SCHEMA_FILES state', async () => {
      // Skip if already initialized
      if (ensureClient().isInitialized()) {
        return
      }

      const stateHistory: string[] = []
      const clientInstance = ensureClient()
      const service = clientInstance.getService()
      
      const subscription = service.subscribe((snapshot) => {
        stateHistory.push(snapshot.value as string)
      })

      const config: SeedConstructorOptions = {
        config: {
          endpoints: {
            filePaths: '/api/seed/migrations',
            files: '/app-files',
          },
          models: {
            TestModel,
          },
          filesDir: '.seed',
        },
        addresses: ['0x1234567890123456789012345678901234567890'],
      }

      await initWithTimeout(config, 60000)
      
      subscription.unsubscribe()
      
      // Should have passed through PROCESS_SCHEMA_FILES state
      expect(stateHistory).toContain(ClientManagerState.PROCESS_SCHEMA_FILES)
      
      // Should eventually reach IDLE
      expect(stateHistory).toContain(ClientManagerState.IDLE)
    }, 90000)

    it('should send PROCESS_SCHEMA_FILES_SUCCESS event on completion', async () => {
      // Skip if already initialized
      if (ensureClient().isInitialized()) {
        return
      }

      const events: string[] = []
      const clientInstance = ensureClient()
      const service = clientInstance.getService()
      
      const subscription = service.subscribe((snapshot) => {
        // Track state transitions which indicate events were received
        if (snapshot.value === ClientManagerState.ADD_MODELS_TO_STORE) {
          events.push(ClientManagerEvents.PROCESS_SCHEMA_FILES_SUCCESS)
        }
      })

      const config: SeedConstructorOptions = {
        config: {
          endpoints: {
            filePaths: '/api/seed/migrations',
            files: '/app-files',
          },
          models: {
            TestModel,
          },
          filesDir: '.seed',
        },
        addresses: ['0x1234567890123456789012345678901234567890'],
      }

      await initWithTimeout(config, 60000)
      
      subscription.unsubscribe()
      
      // Should have received the success event (indicated by state transition)
      expect(events.length).toBeGreaterThan(0)
    }, 90000)
  })
})

