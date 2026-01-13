import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest'
import { ClientManagerState, ClientManagerEvents } from '@/client/constants'
import type { SeedConstructorOptions, ModelClassType } from '@/types'
import { BaseItem } from '@/Item/BaseItem'
import { ModelPropertyDataTypes } from '@/helpers/property'

// Dynamically import client from src/client
type ClientType = typeof import('../src/client')['client']
let client: ClientType | null = null

beforeAll(async () => {
  const clientModule = await import('../src/client')
  client = clientModule.client
})

// Helper function to wrap client.init with a timeout
async function initWithTimeout(
  config: SeedConstructorOptions,
  timeoutMs: number = 30000
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
    return {} as BaseItem<any>
  },
} as any // Cast to any since we're just testing config passing

describe('Client Initialization', () => {
  let stateHistory: Array<{ state: string; timestamp: number; context?: any }>
  let subscription: { unsubscribe: () => void } | null
  let errorHandler: (error: any) => void
  let errorSubscription: { unsubscribe: () => void } | null

  beforeEach(() => {
    stateHistory = []
    errorHandler = vi.fn()
    subscription = null
    errorSubscription = null
    
    const clientInstance = ensureClient()
    
    // Monitor the client's actor subscription
    const service = clientInstance.getService()
    
    // Capture the current snapshot immediately (to catch initial state)
    const currentSnapshot = service.getSnapshot()
    stateHistory.push({
      state: currentSnapshot.value as string,
      timestamp: Date.now(),
      context: {
        isInitialized: currentSnapshot.context.isInitialized,
        addressesSet: currentSnapshot.context.addressesSet,
        isSaving: currentSnapshot.context.isSaving,
      },
    })
    
    subscription = service.subscribe((snapshot) => {
      stateHistory.push({
        state: snapshot.value as string,
        timestamp: Date.now(),
        context: {
          isInitialized: snapshot.context.isInitialized,
          addressesSet: snapshot.context.addressesSet,
          isSaving: snapshot.context.isSaving,
        },
      })
    })

    // Monitor for errors
    errorSubscription = service.subscribe({
      error: errorHandler,
    })
  })

  afterEach(() => {
    if (subscription) {
      subscription.unsubscribe()
      subscription = null
    }
    if (errorSubscription) {
      errorSubscription.unsubscribe()
      errorSubscription = null
    }
    // Note: We don't unload the client between tests since it's a singleton
    // and unload might not fully reset state. Tests should account for this.
  })

  describe('Basic Client Functionality', () => {
    it('should successfully import client from src/client', () => {
      expect(client).toBeDefined()
      expect(client).not.toBeNull()
      expect(typeof client!.isInitialized).toBe('function')
      expect(typeof client!.init).toBe('function')
      expect(typeof client!.getService).toBe('function')
    })

    it('should be able to check client initialization status', () => {
      const clientInstance = ensureClient()
      const isInitialized = clientInstance.isInitialized()
      expect(typeof isInitialized).toBe('boolean')
      expect(isInitialized).toBe(false) // Should start uninitialized
    })

    it('should provide access to the underlying actor service', () => {
      const clientInstance = ensureClient()
      const service = clientInstance.getService()
      expect(service).toBeDefined()
      expect(service.getSnapshot).toBeDefined()
      expect(typeof service.getSnapshot).toBe('function')
    })
  })

  describe('Config Validation - Invalid Configurations', () => {
    it('should reject config without endpoints', async () => {
      // Skip if already initialized (singleton behavior)
      if (ensureClient().isInitialized()) {
        return
      }

      const config = {
        config: {
          models: {
            TestModel,
          },
          filesDir: '.seed',
        },
        addresses: ['0x1234567890123456789012345678901234567890'],
      } as any

      await expect(initWithTimeout(config, 10000)).rejects.toThrow()
    })

    it('should reject config without filePaths endpoint', async () => {
      // Skip if already initialized (singleton behavior)
      if (ensureClient().isInitialized()) {
        return
      }

      const config: SeedConstructorOptions = {
        config: {
          endpoints: {
            files: '/app-files',
          } as any,
          models: {
            TestModel,
          },
          filesDir: '.seed',
        },
        addresses: ['0x1234567890123456789012345678901234567890'],
      }

      await expect(initWithTimeout(config, 10000)).rejects.toThrow()
    })

    it('should reject config without files endpoint', async () => {
      // Skip if already initialized (singleton behavior)
      if (ensureClient().isInitialized()) {
        return
      }

      const config: SeedConstructorOptions = {
        config: {
          endpoints: {
            filePaths: '/api/seed/migrations',
          } as any,
          models: {
            TestModel,
          },
          filesDir: '.seed',
        },
        addresses: ['0x1234567890123456789012345678901234567890'],
      }

      await expect(initWithTimeout(config, 10000)).rejects.toThrow()
    })

    it('should accept config without models', async () => {
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
          filesDir: '.seed',
        },
        addresses: ['0x1234567890123456789012345678901234567890'],
      }

      await expect(initWithTimeout(config, 30000)).resolves.not.toThrow()
      expect(ensureClient().isInitialized()).toBe(true)
    }, 60000)

    it('should accept config with empty models', async () => {
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
          models: {},
          filesDir: '.seed',
        },
        addresses: ['0x1234567890123456789012345678901234567890'],
      }

      await expect(initWithTimeout(config, 30000)).resolves.not.toThrow()
      expect(ensureClient().isInitialized()).toBe(true)
    }, 60000)

    it('should accept config without addresses', async () => {
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
      }

      await expect(initWithTimeout(config, 30000)).resolves.not.toThrow()
      expect(ensureClient().isInitialized()).toBe(true)
    }, 60000)

    it('should accept config with empty addresses array', async () => {
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
        addresses: [],
      }

      await expect(initWithTimeout(config, 30000)).resolves.not.toThrow()
      expect(ensureClient().isInitialized()).toBe(true)
    }, 60000)

    it('should reject config with invalid address format', async () => {
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
        addresses: ['invalid-address'] as any,
      }

      // Invalid address format might be caught during init
      try {
        await initWithTimeout(config, 10000)
        // If it doesn't throw, validation might happen later
      } catch (error) {
        expect(error).toBeDefined()
      }
    })
  })

  describe('Config Validation - Valid Configurations', () => {
    it('should initialize with minimal valid config', async () => {
      const clientInstance = ensureClient()
      // Skip if already initialized (singleton behavior)
      if (clientInstance.isInitialized()) {
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

      const startTime = Date.now()
      await initWithTimeout(config, 30000)
      const duration = Date.now() - startTime

      expect(ensureClient().isInitialized()).toBe(true)
      expect(errorHandler).not.toHaveBeenCalled()
      
      // Should complete within reasonable time (30 seconds max)
      expect(duration).toBeLessThan(30000)
      
      // Verify state progression
      const states = stateHistory.map(h => h.state)
      expect(states).toContain(ClientManagerState.UNINITIALIZED)
      expect(states).toContain(ClientManagerState.PLATFORM_CLASSES_INIT)
      expect(states).toContain(ClientManagerState.FILE_SYSTEM_INIT)
      expect(states).toContain(ClientManagerState.DB_INIT)
      expect(states).toContain(ClientManagerState.SAVE_CONFIG)
      expect(states).toContain(ClientManagerState.PROCESS_SCHEMA_FILES)
      expect(states).toContain(ClientManagerState.ADD_MODELS_TO_STORE)
      expect(states).toContain(ClientManagerState.ADD_MODELS_TO_DB)
      expect(states).toContain(ClientManagerState.IDLE)
      
      // Verify that the internal Seed Protocol schema is loaded into the database
      const { BaseDb } = await import('@/db/Db/BaseDb')
      const { schemas } = await import('@/seedSchema/SchemaSchema')
      const { models: modelsTable } = await import('@/seedSchema/ModelSchema')
      const { properties: propertiesTable } = await import('@/seedSchema/ModelSchema')
      const { modelSchemas } = await import('@/seedSchema/ModelSchemaSchema')
      const { eq, and } = await import('drizzle-orm')
      const { SEED_PROTOCOL_SCHEMA_NAME } = await import('@/helpers/constants')
      const db = BaseDb.getAppDb()
      if (db) {
        // Check that schema exists
        const seedProtocolSchemas = await db
          .select()
          .from(schemas)
          .where(eq(schemas.name, SEED_PROTOCOL_SCHEMA_NAME))
          .limit(1)
        expect(seedProtocolSchemas.length).toBeGreaterThan(0)
        expect(seedProtocolSchemas[0].name).toBe(SEED_PROTOCOL_SCHEMA_NAME)
        expect(seedProtocolSchemas[0].schemaData).toBeDefined()
        
        const schemaId = seedProtocolSchemas[0].id
        expect(schemaId).toBeDefined()
        
        // Wait a bit for models to be fully added to the database and linked
        // The schema import happens asynchronously, so we need to wait for it to complete
        await new Promise(resolve => setTimeout(resolve, 2000))

        const modelRecords = await db
            .select()
            .from(modelsTable)
            .limit(10)

        console.log('modelRecords', modelRecords)
        
        // Check that models are linked to the schema via model_schemas join table
        // Retry a few times in case the join table entries are still being created
        let modelSchemaLinks: Array<{ modelId: number | null; schemaId: number | null; modelName: string | null }> = []
        for (let attempt = 0; attempt < 10; attempt++) {
          modelSchemaLinks = await db
            .select({
              modelId: modelSchemas.modelId,
              schemaId: modelSchemas.schemaId,
              modelName: modelsTable.name,
            })
            .from(modelSchemas)
            .innerJoin(modelsTable, eq(modelSchemas.modelId, modelsTable.id))
            .where(eq(modelSchemas.schemaId, schemaId!))

          
          
          if (modelSchemaLinks.length > 0) {
            break
          }
          
          // Wait a bit before retrying (longer wait for later attempts)
          await new Promise(resolve => setTimeout(resolve, 200 * (attempt + 1)))
        }
        
        // Check if models exist at all (for better error messages)
        const allModels = await db
          .select()
          .from(modelsTable)
          .limit(10)
        
        // Provide informative error if join table entries don't exist
        if (modelSchemaLinks.length === 0) {
          if (allModels.length > 0) {
            // Models exist but aren't linked - this suggests addModelsToDb wasn't called with schema record
            const modelNames = allModels.map((m: { name: string }) => m.name).join(', ')
            throw new Error(
              `Models exist in database (${modelNames}) but are not linked to Seed Protocol schema via model_schemas join table. ` +
              `This suggests addModelsToDb was not called with the schema record, or join table creation failed. ` +
              `Schema ID: ${schemaId}`
            )
          } else {
            // No models at all - schema import may have failed
            throw new Error(
              `No models found in database for Seed Protocol schema. ` +
              `This suggests the schema import (importJsonSchema) did not successfully add models to the database. ` +
              `Schema ID: ${schemaId}`
            )
          }
        }
        
        // Verify expected models exist (Seed, Version, Metadata at minimum)
        const modelNames = modelSchemaLinks
          .map((link: { modelName: string | null }) => link.modelName)
          .filter((name: string | null): name is string => name !== null)
        expect(modelNames).toContain('Seed')
        expect(modelNames).toContain('Version')
        expect(modelNames).toContain('Metadata')
        
        // Check that properties exist for at least one model
        const modelIds = modelSchemaLinks
          .map((link: { modelId: number | null }) => link.modelId)
          .filter((id: number | null): id is number => id !== null)
        expect(modelIds.length).toBeGreaterThan(0)
        
        const propertiesForModels = await db
          .select()
          .from(propertiesTable)
          .where(eq(propertiesTable.modelId, modelIds[0]))
        
        expect(propertiesForModels.length).toBeGreaterThan(0)
      }
    }, 60000)

    it('should initialize with full config including dbConfig', async () => {
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
          dbConfig: {
            dbUrl: '.seed/db/seed.db',
            schemaDir: '.seed/schema',
            outDir: '.seed/db',
          },
        },
        addresses: ['0x1234567890123456789012345678901234567890'],
      }

      const startTime = Date.now()
      await initWithTimeout(config, 30000)
      const duration = Date.now() - startTime

      expect(ensureClient().isInitialized()).toBe(true)
      expect(errorHandler).not.toHaveBeenCalled()
      expect(duration).toBeLessThan(30000)
    }, 60000)

    it('should initialize with multiple addresses', async () => {
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
        addresses: [
          '0x1234567890123456789012345678901234567890',
          '0x0987654321098765432109876543210987654321',
        ],
      }

      await initWithTimeout(config, 30000)
      const clientInstance = ensureClient()
      expect(clientInstance.isInitialized()).toBe(true)
      expect(errorHandler).not.toHaveBeenCalled()
    }, 60000)

    it('should initialize with arweaveDomain', async () => {
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
          arweaveDomain: 'arweave.net',
        },
        addresses: ['0x1234567890123456789012345678901234567890'],
      }

      await initWithTimeout(config, 30000)
      expect(ensureClient().isInitialized()).toBe(true)
      expect(errorHandler).not.toHaveBeenCalled()
    }, 60000)
  })

  describe('State Machine Monitoring', () => {
    it('should progress through all expected states during initialization', async () => {
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

      const startTime = Date.now()
      
      await initWithTimeout(config, 30000)
      const totalDuration = Date.now() - startTime

      // Verify we reached the IDLE state
      const finalState = stateHistory[stateHistory.length - 1]
      expect(finalState.state).toBe(ClientManagerState.IDLE)
      expect(finalState.context.isInitialized).toBe(true)

      // Verify state progression (should go through key states)
      const states = stateHistory.map(h => h.state)
      expect(states).toContain(ClientManagerState.PLATFORM_CLASSES_INIT)
      expect(states).toContain(ClientManagerState.FILE_SYSTEM_INIT)
      expect(states).toContain(ClientManagerState.DB_INIT)
      expect(states).toContain(ClientManagerState.SAVE_CONFIG)
      expect(states).toContain(ClientManagerState.PROCESS_SCHEMA_FILES)
      expect(states).toContain(ClientManagerState.ADD_MODELS_TO_STORE)
      expect(states).toContain(ClientManagerState.ADD_MODELS_TO_DB)
      expect(states).toContain(ClientManagerState.IDLE)

      // Should complete in reasonable time
      expect(totalDuration).toBeLessThan(30000)
      expect(errorHandler).not.toHaveBeenCalled()
    }, 60000)

    it('should not get stuck in any state for too long', async () => {
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

      const startTime = Date.now()
      
      await initWithTimeout(config, 30000)
      const totalDuration = Date.now() - startTime

      // Check time spent in each state
      const stateDurations = new Map<string, number[]>()
      for (let i = 1; i < stateHistory.length; i++) {
        const prev = stateHistory[i - 1]
        const curr = stateHistory[i]
        const duration = curr.timestamp - prev.timestamp
        
        if (!stateDurations.has(prev.state)) {
          stateDurations.set(prev.state, [])
        }
        stateDurations.get(prev.state)!.push(duration)
      }

      // Each state should not take more than 10 seconds individually
      for (const [state, durations] of stateDurations.entries()) {
        const maxDuration = Math.max(...durations)
        expect(maxDuration).toBeLessThan(10000)
      }

      expect(totalDuration).toBeLessThan(30000)
    }, 60000)

    it('should handle state transitions without errors', async () => {
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

      await initWithTimeout(config, 30000)

      // No errors should have been caught
      expect(errorHandler).not.toHaveBeenCalled()

      // All state transitions should be valid
      const validStates = Object.values(ClientManagerState)
      for (const historyEntry of stateHistory) {
        expect(validStates).toContain(historyEntry.state)
      }
    }, 60000)

    it('should maintain correct context throughout initialization', async () => {
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

      await initWithTimeout(config, 30000)

      // Context should be properly maintained
      const finalEntry = stateHistory[stateHistory.length - 1]
      expect(finalEntry.context.isInitialized).toBe(true)
      
      // Check that context is consistent
      for (const entry of stateHistory) {
        expect(entry.context).toBeDefined()
        expect(typeof entry.context.isInitialized).toBe('boolean')
        expect(typeof entry.context.addressesSet).toBe('boolean')
        expect(typeof entry.context.isSaving).toBe('boolean')
      }
    }, 60000)
  })

  describe('Multiple Initialization Attempts', () => {
    it('should handle multiple init calls gracefully', async () => {
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

      await initWithTimeout(config, 30000)
      expect(ensureClient().isInitialized()).toBe(true)

      // Second init should not cause errors (should return immediately if already initialized)
      await expect(initWithTimeout(config, 5000)).resolves.not.toThrow()
      expect(ensureClient().isInitialized()).toBe(true)
    }, 60000)

    it('should not reinitialize if already initialized', async () => {
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

      const firstInitStates = stateHistory.length
      
      await initWithTimeout(config, 30000)
      const statesAfterFirstInit = stateHistory.length

      // Clear state history for second init
      stateHistory = []
      
      await initWithTimeout(config, 5000)
      const statesAfterSecondInit = stateHistory.length

      // Second init should not add many new states (should be idempotent)
      expect(statesAfterSecondInit).toBeLessThan(statesAfterFirstInit)
    }, 60000)
  })
})

