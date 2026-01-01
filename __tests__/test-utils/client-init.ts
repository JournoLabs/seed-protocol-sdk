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
          // Now wait for database
          waitForDatabase().then(resolve).catch(reject)
        } else if (Date.now() - startTime > timeout) {
          clearInterval(checkInterval)
          reject(new Error(`Client initialization timeout after ${timeout}ms`))
        }
      }, 100)
    })
  }
  
  // Client is initialized, wait for database
  await waitForDatabase()
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

  // Initialize client with config and wait for it to be ready
  if (!client.isInitialized()) {
    try {
      await client.init(config)
    } catch (error: any) {
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
  } catch (error: any) {
    throw new Error(`Database not ready after initialization: ${error?.message || String(error)}`)
  }
  
  // Small delay to ensure everything is fully settled
  await new Promise(resolve => setTimeout(resolve, 500))
}

/**
 * Get the test project path based on the environment
 * Returns the path to the mock project directory
 */
export function getTestProjectPath(): string {
  const isNodeEnv = typeof window === 'undefined'
  
  if (isNodeEnv) {
    // In Node.js, we'll need to compute this dynamically
    // This will be set by the caller who has access to path module
    return ''
  } else {
    // In browser, use a mock project path
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
  const defaultConfig: SeedConstructorOptions = {
    config: {
      models: {},
      endpoints: {
        filePaths: '/api/seed/migrations',
        files: '/app-files',
      },
      arweaveDomain: 'arweave.net',
    },
  }
  
  // Merge overrides, with config being deeply merged
  return {
    config: {
      ...defaultConfig.config,
      ...(overrides.config || {}),
    },
    ...(overrides.addresses ? { addresses: overrides.addresses } : {}),
  }
}

/**
 * Setup function for beforeAll hook that initializes client and database
 * Use this in your test files' beforeAll hook
 * 
 * @example
 * ```typescript
 * beforeAll(async () => {
 *   const testProjectPath = await setupTestEnvironment({
 *     testFileUrl: import.meta.url
 *   })
 *   // Use testProjectPath if needed
 * })
 * ```
 */
export async function setupTestEnvironment(options: {
  configOverrides?: Partial<SeedConstructorOptions>
  projectPath?: string
  testFileUrl?: string
  timeout?: number
} = {}): Promise<undefined> {
  
  // Create config
  const config = createTestConfig(options.configOverrides)

  console.log('Initializing client...')
  
  // Initialize client
  await initializeTestClient({
    config,
    timeout: options.timeout,
  })
  
  console.log('Client initialized')
  
  return
}

