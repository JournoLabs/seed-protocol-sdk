/**
 * Shared test utilities for client and database initialization
 * 
 * This module provides reusable functions for setting up the test environment
 * across multiple test files. It handles:
 * - Client initialization with proper error handling
 * - Database readiness verification
 * - Test project path setup for both Node.js and browser environments
 * 
 * **Browser Environment:**
 * - All browser tests run in the same environment as the react-app
 * - The fs module is automatically aliased to @zenfs/core in browser tests
 * - This is configured in vite.config.js for the browser test project
 * 
 * @example Basic usage in a test file:
 * ```typescript
 * import { setupTestEnvironment } from '../test-utils/client-init'
 * 
 * describe('My Tests', () => {
 *   let testProjectPath: string
 * 
 *   beforeAll(async () => {
 *     testProjectPath = await setupTestEnvironment({
 *       testFileUrl: import.meta.url,
 *       timeout: 90000,
 *     })
 *   }, 90000)
 * })
 * ```
 */

import { BaseDb } from '@/db/Db/BaseDb'
import { schemas } from '@/seedSchema/SchemaSchema'
import type { SeedConstructorOptions } from '@/types'

// Dynamically import client from src/client (same pattern as client.test.ts)
type ClientType = typeof import('@/client')['client']

// Cache for the dynamically imported client
let cachedClient: ClientType | null = null

/**
 * Get the client instance, dynamically importing it if necessary
 * This ensures the client is loaded fresh for each test suite
 */
async function getClient(): Promise<ClientType> {
  if (!cachedClient) {
    console.log('Importing client...')
    const clientModule = await import('@/client')
    console.log('Client imported')
    cachedClient = clientModule.client
  }
  return cachedClient
}

export interface TestClientConfig {
  config: SeedConstructorOptions
  projectPath?: string
  timeout?: number
}

/**
 * Wait for database to be ready
 */
async function waitForDatabase(timeout: number = 30000): Promise<void> {
  const startTime = Date.now()
  
  return new Promise<void>((resolve, reject) => {
    const checkInterval = setInterval(() => {
      try {
        // Use isAppDbReady() for a safer check
        if (BaseDb.isAppDbReady()) {
          // Double-check by trying to get the db
          const db = BaseDb.getAppDb()
          if (db) {
            clearInterval(checkInterval)
            resolve()
            return
          }
        }
        
        // Check timeout
        if (Date.now() - startTime > timeout) {
          clearInterval(checkInterval)
          reject(new Error(`Database not ready after ${timeout}ms`))
        }
      } catch (error) {
        // Database might throw if not ready, continue waiting
        if (Date.now() - startTime > timeout) {
          clearInterval(checkInterval)
          reject(new Error(`Database not ready after ${timeout}ms: ${error instanceof Error ? error.message : String(error)}`))
        }
      }
    }, 100)
  })
}

/**
 * Wait for client and database to be ready
 */
async function waitForClientAndDbReady(timeout: number = 60000): Promise<void> {
  const client = await getClient()
  const startTime = Date.now()
  
  // Wait for client initialization
  if (!client.isInitialized()) {
    // If not initialized, wait for it
    return new Promise<void>((resolve, reject) => {
      const checkInterval = setInterval(() => {
        if (client.isInitialized()) {
          clearInterval(checkInterval)
          // Now wait for database with the same timeout
          waitForDatabase(timeout).then(resolve).catch(reject)
        } else if (Date.now() - startTime > timeout) {
          clearInterval(checkInterval)
          reject(new Error(`Client initialization timeout after ${timeout}ms`))
        }
      }, 100)
    })
  }
  
  // Client is initialized, wait for database with the same timeout
  await waitForDatabase(timeout)
}

/**
 * Initialize the client for testing with proper error handling and database verification
 * 
 * @param options - Configuration options for client initialization
 * @returns Promise that resolves when client and database are ready
 */
export async function initializeTestClient(options: TestClientConfig): Promise<void> {
  const { config, timeout = 90000 } = options

  // Dynamically import client (same pattern as client.test.ts)
  const client = await getClient()

  console.log('Client obtained', config)

  client.getService().subscribe((snapshot) => {
    console.log('client snapshot.value', snapshot.value)
    console.log('client snapshot.context', snapshot.context)
  })

  // Initialize client with config and wait for it to be ready
  if (!client.isInitialized()) {
    try {
      await client.init(config)
    } catch (error: any) {
      console.log('Error in initializeTestClient:', error)
      const snapshot = client.getService().getSnapshot()
      throw new Error(
        `Client initialization failed: ${error?.message || String(error)}. ` +
        `State: ${snapshot.value}, isInitialized: ${snapshot.context.isInitialized}`
      )
    }
  }
  
  // Wait for both client and database to be ready
  await waitForClientAndDbReady(timeout)
  
  // Verify database is accessible with a simple query
  try {
    const db = BaseDb.getAppDb()
    if (!db) {
      throw new Error('Database not available after initialization')
    }
    // Try a simple query to ensure database is actually ready
    await db.select().from(schemas).limit(1)
    
    // Verify that the internal Seed Protocol schema is loaded into the database
    const { eq } = await import('drizzle-orm')
    const { SEED_PROTOCOL_SCHEMA_NAME } = await import('@/helpers/constants')
    const { models: modelsTable } = await import('@/seedSchema/ModelSchema')
    const { properties: propertiesTable } = await import('@/seedSchema/ModelSchema')
    const { modelSchemas } = await import('@/seedSchema/ModelSchemaSchema')
    
    const seedProtocolSchemas = await db
      .select()
      .from(schemas)
      .where(eq(schemas.name, SEED_PROTOCOL_SCHEMA_NAME))
      .limit(1)
    
    if (seedProtocolSchemas.length === 0) {
      throw new Error(`Seed Protocol schema (${SEED_PROTOCOL_SCHEMA_NAME}) not found in database after initialization`)
    }
    
    if (!seedProtocolSchemas[0].schemaData) {
      throw new Error(`Seed Protocol schema found but missing schemaData in database`)
    }
    
    const schemaId = seedProtocolSchemas[0].id
    if (!schemaId) {
      throw new Error(`Seed Protocol schema found but missing id`)
    }
    
    // Check that models are linked to the schema via model_schemas join table
    type ModelSchemaLink = { modelId: number | null; schemaId: number | null; modelName: string | null }
    const modelSchemaLinks = await db
      .select({
        modelId: modelSchemas.modelId,
        schemaId: modelSchemas.schemaId,
        modelName: modelsTable.name,
      })
      .from(modelSchemas)
      .innerJoin(modelsTable, eq(modelSchemas.modelId, modelsTable.id))
      .where(eq(modelSchemas.schemaId, schemaId))
    
    if (modelSchemaLinks.length === 0) {
      throw new Error(`No models found linked to Seed Protocol schema via model_schemas join table`)
    }
    
    // Verify expected models exist (Seed, Version, Metadata at minimum)
    const modelNames = modelSchemaLinks
      .map((link: ModelSchemaLink) => link.modelName)
      .filter((name: string | null): name is string => name !== null)
    const expectedModels = ['Seed', 'Version', 'Metadata']
    for (const expectedModel of expectedModels) {
      if (!modelNames.includes(expectedModel)) {
        throw new Error(`Expected model "${expectedModel}" not found in Seed Protocol schema. Found models: ${modelNames.join(', ')}`)
      }
    }
    
    // Check that properties exist for at least one model
    const modelIds = modelSchemaLinks
      .map((link: ModelSchemaLink) => link.modelId)
      .filter((id: number | null): id is number => id !== null)
    if (modelIds.length === 0) {
      throw new Error(`No valid model IDs found in model_schemas join table`)
    }

    // CRITICAL: Check that properties exist in the database
    // Schema can be in 'idle' state (meaning schema data is loaded in memory) 
    // but models/properties may not yet be persisted to the database.
    // 
    // With the fix in loadOrCreateSchema, models and properties are now added
    // synchronously during schema loading, so by the time Schema reaches 'idle',
    // the database should have all records. However, we verify this here to ensure
    // the client is truly ready to use.
    //
    // Alternative signal: We could also check Schema's writeProcess status:
    //   const schema = Schema.create(SEED_PROTOCOL_SCHEMA_NAME)
    //   const writeProcess = schema.getService().getSnapshot().context.writeProcess
    //   if (writeProcess) {
    //     const writeStatus = writeProcess.getSnapshot().context.writeStatus
    //     // writeStatus should be 'success' or 'idle' (if no writes needed)
    //   }
    // But checking the database directly is more reliable.
    
    const allProperties = await db
      .select()
      .from(propertiesTable)
      .limit(100)

    console.log('allProperties', allProperties)

    const allModels = await db
      .select()
      .from(modelsTable)
      .limit(100)

    console.log('allModels', allModels)

    const allSchemas = await db
      .select()
      .from(schemas)
      .limit(100)

    console.log('allSchemas', allSchemas)

    const allModelSchemas = await db
      .select()
      .from(modelSchemas)
      .limit(100)

    console.log('allModelSchemas', allModelSchemas)
    
    // Check properties for the first model (Seed should have properties)
    const seedModelLink = modelSchemaLinks.find((link: ModelSchemaLink) => link.modelName === 'Seed')
    if (seedModelLink && seedModelLink.modelId) {
      const propertiesForSeed = await db
        .select()
        .from(propertiesTable)
        .where(eq(propertiesTable.modelId, seedModelLink.modelId))
      
      if (propertiesForSeed.length === 0) {
        throw new Error(`No properties found for Seed model in Seed Protocol schema. ` +
          `This indicates Schema reached 'idle' state before models/properties were persisted to the database. ` +
          `Schema 'idle' state means schema data is loaded in memory, but does not guarantee database persistence.`)
      }
    }
  } catch (error: any) {
    throw new Error(`Database not ready after initialization: ${error?.message || String(error)}`)
  }
  
  // Small delay to ensure everything is fully settled
  await new Promise(resolve => setTimeout(resolve, 500))
}

/**
 * Get the test project path based on the environment
 * Returns a temporary directory path for isolated test environments
 */
export async function getTestProjectPath(): Promise<string> {
  const isNodeEnv = typeof window === 'undefined'
  
  if (isNodeEnv) {
    // In Node.js, create a temporary directory for each test run
    const os = await import('os')
    const path = await import('path')
    const fs = await import('fs')
    
    // Create a unique temporary directory
    const tmpDir = os.tmpdir()
    const testDirName = `seed-test-${Date.now()}-${Math.random().toString(36).substring(7)}`
    const testProjectPath = path.join(tmpDir, testDirName)
    
    // Ensure the directory exists
    if (!fs.existsSync(testProjectPath)) {
      fs.mkdirSync(testProjectPath, { recursive: true })
    }
    
    return testProjectPath
  } else {
    // In browser, use OPFS path (browser tests handle their own isolation)
    return '/test-project'
  }
}

/**
 * Create a minimal test config
 * 
 * @param overrides - Partial config to override defaults
 * @returns A complete SeedConstructorOptions object
 */
export function createTestConfig(overrides: Partial<SeedConstructorOptions> = {}): SeedConstructorOptions {
  const isNodeEnv = typeof window === 'undefined'
  
  // Use environment-appropriate default for filesDir
  // Browser: Use OPFS path /app-files
  // Node.js: Use relative path .seed (will be resolved relative to process.cwd())
  const defaultFilesDir = isNodeEnv ? '.seed' : '/app-files'
  
  const defaultConfig: SeedConstructorOptions = {
    config: {
      models: {},
      endpoints: {
        filePaths: '/api/seed/migrations',
        files: defaultFilesDir,
      },
      arweaveDomain: 'arweave.net',
      // Explicitly set filesDir in config to ensure it's used
      filesDir: defaultFilesDir,
    },
  }
  
  // Merge overrides, with config being deeply merged
  // If overrides.config.endpoints.files is set, also update filesDir to match
  const mergedConfig = {
    ...defaultConfig.config,
    ...(overrides.config || {}),
  }
  
  // Ensure filesDir matches endpoints.files if endpoints.files was overridden
  if (overrides.config?.endpoints?.files) {
    mergedConfig.filesDir = overrides.config.endpoints.files
  } else if (!mergedConfig.filesDir) {
    // Fallback: use endpoints.files if filesDir wasn't set
    mergedConfig.filesDir = mergedConfig.endpoints.files
  }
  
  return {
    config: mergedConfig,
    ...(overrides.addresses ? { addresses: overrides.addresses } : {}),
  }
}

// Store original working directory for restoration
let originalCwd: string | undefined

/**
 * Setup function for beforeAll hook that initializes client and database
 * Use this in your test files' beforeAll hook
 * 
 * In Node.js, this creates a temporary directory and changes the working directory to it
 * to simulate running in a user's project directory with isolated state.
 * 
 * @example
 * ```typescript
 * beforeAll(async () => {
 *   await setupTestEnvironment({
 *     testFileUrl: import.meta.url
 *   })
 * })
 * ```
 */
export async function setupTestEnvironment(options: {
  configOverrides?: Partial<SeedConstructorOptions>
  projectPath?: string
  testFileUrl?: string
  timeout?: number
} = {}): Promise<string | undefined> {
  const isNodeEnv = typeof window === 'undefined'
  let testProjectPath: string | undefined
  
  // In Node.js, change to the test project directory
  if (isNodeEnv) {
    // Store original working directory for restoration
    originalCwd = process.cwd()
    testProjectPath = options.projectPath || await getTestProjectPath()
    
    // Ensure the directory exists
    const fs = await import('fs')
    if (!fs.existsSync(testProjectPath)) {
      fs.mkdirSync(testProjectPath, { recursive: true })
    }
    
    // Change to the test project directory
    process.chdir(testProjectPath)
    console.log(`[setupTestEnvironment] Changed working directory to: ${testProjectPath}`)
  }
  
  // Create config
  const config = createTestConfig(options.configOverrides)
  
  // In Node.js, ensure the filesDir directory exists before client initialization
  if (isNodeEnv && config.config.filesDir) {
    const fs = await import('fs')
    const path = await import('path')
    // Resolve the filesDir path relative to current working directory
    const resolvedFilesDir = path.resolve(config.config.filesDir)
    if (!fs.existsSync(resolvedFilesDir)) {
      fs.mkdirSync(resolvedFilesDir, { recursive: true })
      console.log(`[setupTestEnvironment] Created filesDir directory: ${resolvedFilesDir}`)
    }
  }

  console.log('Initializing client...')
  
  // Initialize client
  await initializeTestClient({
    config,
    timeout: options.timeout,
  })
  
  console.log('Client initialized')
  
  // Store test project path for cleanup if it's a temporary directory
  if (isNodeEnv && testProjectPath && !options.projectPath) {
    const os = await import('os')
    const tmpDir = os.tmpdir()
    // Only track for cleanup if it's in the temp directory
    if (testProjectPath.startsWith(tmpDir)) {
      testProjectPathForCleanup = testProjectPath
    }
  }
  
  // Return the test project path so tests can use it
  return testProjectPath
}

// Store test project path for cleanup
let testProjectPathForCleanup: string | undefined

/**
 * Restore the original working directory and clean up temporary test directories
 * Call this in afterAll hook
 */
export async function teardownTestEnvironment(): Promise<void> {
  const isNodeEnv = typeof window === 'undefined'
  
  if (isNodeEnv) {
    // Restore original working directory
    if (originalCwd) {
      process.chdir(originalCwd)
      console.log(`[teardownTestEnvironment] Restored working directory to: ${originalCwd}`)
      originalCwd = undefined
    }
    
    // Clean up temporary test project directory if it was created
    if (testProjectPathForCleanup) {
      const fs = await import('fs')
      const path = await import('path')
      const os = await import('os')
      
      // Only clean up if it's in the temp directory (safety check)
      const tmpDir = os.tmpdir()
      if (testProjectPathForCleanup.startsWith(tmpDir)) {
        try {
          // Remove the entire test directory
          if (fs.existsSync(testProjectPathForCleanup)) {
            fs.rmSync(testProjectPathForCleanup, { recursive: true, force: true })
            console.log(`[teardownTestEnvironment] Cleaned up temporary directory: ${testProjectPathForCleanup}`)
          }
        } catch (error) {
          console.warn(`[teardownTestEnvironment] Failed to clean up directory ${testProjectPathForCleanup}:`, error)
        }
      }
      testProjectPathForCleanup = undefined
    }
  }
}

