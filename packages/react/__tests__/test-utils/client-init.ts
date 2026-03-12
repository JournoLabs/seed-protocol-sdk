/**
 * Shared test utilities for client and database initialization
 * Adapted for @seedprotocol/react package - uses @seedprotocol/sdk
 */

import {
  BaseDb,
  DEFAULT_ARWEAVE_HOST,
  schemas,
  SEED_PROTOCOL_SCHEMA_NAME,
  models as modelsTable,
  properties as propertiesTable,
  modelSchemas,
} from '@seedprotocol/sdk'
import type { SeedConstructorOptions } from '@seedprotocol/sdk'
import { and, eq } from 'drizzle-orm'

type ClientType = Awaited<typeof import('@seedprotocol/sdk')>['client']

let cachedClient: ClientType | null = null

async function getClient(): Promise<ClientType> {
  if (!cachedClient) {
    const sdk = await import('@seedprotocol/sdk')
    cachedClient = sdk.client
  }
  return cachedClient
}

export interface TestClientConfig {
  config: SeedConstructorOptions
  projectPath?: string
  timeout?: number
}

async function waitForDatabase(timeout: number = 30000): Promise<void> {
  const startTime = Date.now()
  return new Promise<void>((resolve, reject) => {
    const checkInterval = setInterval(() => {
      try {
        if (BaseDb.isAppDbReady() && BaseDb.getAppDb()) {
          clearInterval(checkInterval)
          resolve()
          return
        }
        if (Date.now() - startTime > timeout) {
          clearInterval(checkInterval)
          reject(new Error(`Database not ready after ${timeout}ms`))
        }
      } catch {
        if (Date.now() - startTime > timeout) {
          clearInterval(checkInterval)
          reject(new Error(`Database not ready after ${timeout}ms`))
        }
      }
    }, 100)
  })
}

async function waitForClientAndDbReady(timeout: number = 60000): Promise<void> {
  const client = await getClient()
  const startTime = Date.now()
  if (!client.isInitialized()) {
    return new Promise<void>((resolve, reject) => {
      const checkInterval = setInterval(() => {
        if (client.isInitialized()) {
          clearInterval(checkInterval)
          waitForDatabase(timeout).then(resolve).catch(reject)
        } else if (Date.now() - startTime > timeout) {
          clearInterval(checkInterval)
          reject(new Error(`Client initialization timeout after ${timeout}ms`))
        }
      }, 100)
    })
  }
  await waitForDatabase(timeout)
}

export async function initializeTestClient(options: TestClientConfig): Promise<void> {
  const { config, timeout = 90000 } = options
  const client = await getClient()

  if (!client.isInitialized()) {
    try {
      await client.init(config)
    } catch (error: unknown) {
      const snapshot = client.getService().getSnapshot()
      throw new Error(
        `Client initialization failed: ${error instanceof Error ? error.message : String(error)}. ` +
          `State: ${snapshot.value}, isInitialized: ${(snapshot.context as { isInitialized?: boolean }).isInitialized}`
      )
    }
  }

  await waitForClientAndDbReady(timeout)

  try {
    const db = BaseDb.getAppDb()
    if (!db) throw new Error('Database not available after initialization')
    await db.select().from(schemas).limit(1)

    const seedProtocolSchemas = await db
      .select()
      .from(schemas)
      .where(eq(schemas.name, SEED_PROTOCOL_SCHEMA_NAME))
      .limit(1)

    if (seedProtocolSchemas.length === 0) {
      throw new Error(`Seed Protocol schema (${SEED_PROTOCOL_SCHEMA_NAME}) not found`)
    }
    if (!seedProtocolSchemas[0].schemaData) {
      throw new Error('Seed Protocol schema missing schemaData')
    }

    const schemaId = seedProtocolSchemas[0].id
    if (!schemaId) throw new Error('Seed Protocol schema missing id')

    type ModelSchemaLink = { modelId: number | null; schemaId: number | null; modelName: string | null }
    let modelSchemaLinks: ModelSchemaLink[] = []
    const maxRetries = 30
    const retryDelay = 200
    const expectedModels = ['Seed', 'Version', 'Metadata']

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      modelSchemaLinks = await db
        .select({
          modelId: modelSchemas.modelId,
          schemaId: modelSchemas.schemaId,
          modelName: modelsTable.name,
        })
        .from(modelSchemas)
        .innerJoin(modelsTable, eq(modelSchemas.modelId, modelsTable.id))
        .where(eq(modelSchemas.schemaId, schemaId))

      const modelNames = modelSchemaLinks
        .map((link: ModelSchemaLink) => link.modelName)
        .filter((name: string | null): name is string => name !== null)
      if (expectedModels.every((m) => modelNames.includes(m))) break
      if (attempt < maxRetries - 1) await new Promise((r) => setTimeout(r, retryDelay))
    }

    if (modelSchemaLinks.length === 0) {
      throw new Error('No models found for Seed Protocol schema')
    }

    const seedModelLink = modelSchemaLinks.find((l: ModelSchemaLink) => l.modelName === 'Seed')
    if (seedModelLink?.modelId) {
      let propertiesForSeed: unknown[] = []
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        propertiesForSeed = await db
          .select()
          .from(propertiesTable)
          .where(eq(propertiesTable.modelId, seedModelLink.modelId))
        if (propertiesForSeed.length > 0) break
        if (attempt < maxRetries - 1) await new Promise((r) => setTimeout(r, retryDelay))
      }
      if (propertiesForSeed.length === 0) {
        throw new Error('No properties found for Seed model')
      }
    }
  } catch (error: unknown) {
    throw new Error(
      `Database not ready: ${error instanceof Error ? error.message : String(error)}`
    )
  }

  await new Promise((r) => setTimeout(r, 500))
}

export async function getTestProjectPath(): Promise<string> {
  if (typeof window === 'undefined') {
    const os = await import('os')
    const path = await import('path')
    const fs = await import('fs')
    const tmpDir = os.tmpdir()
    const testDirName = `seed-test-${Date.now()}-${Math.random().toString(36).substring(7)}`
    const testProjectPath = path.join(tmpDir, testDirName)
    if (!fs.existsSync(testProjectPath)) {
      fs.mkdirSync(testProjectPath, { recursive: true })
    }
    return testProjectPath
  }
  return '/test-project'
}

export function createTestConfig(
  overrides: Partial<SeedConstructorOptions> = {}
): SeedConstructorOptions {
  const isNodeEnv = typeof window === 'undefined'
  const defaultFilesDir = isNodeEnv ? '.seed' : '/app-files'
  const defaultConfig: SeedConstructorOptions = {
    config: {
      models: {},
      endpoints: {
        filePaths: '/api/seed/migrations',
        files: defaultFilesDir,
      },
      arweaveDomain: DEFAULT_ARWEAVE_HOST,
      filesDir: defaultFilesDir,
    },
  }
  const mergedConfig = {
    ...defaultConfig.config,
    ...(overrides.config || {}),
  }
  if (overrides.config?.endpoints?.files) {
    mergedConfig.filesDir = overrides.config.endpoints.files
  } else if (!mergedConfig.filesDir) {
    mergedConfig.filesDir = mergedConfig.endpoints.files
  }
  return {
    config: mergedConfig,
    ...(overrides.addresses ? { addresses: overrides.addresses } : {}),
  }
}

let originalCwd: string | undefined
let testProjectPathForCleanup: string | undefined

export async function setupTestEnvironment(options: {
  configOverrides?: Partial<SeedConstructorOptions>
  projectPath?: string
  testFileUrl?: string
  timeout?: number
  beforeInit?: () => Promise<void> | void
} = {}): Promise<string | undefined> {
  const isNodeEnv = typeof window === 'undefined'
  let testProjectPath: string | undefined

  if (isNodeEnv) {
    originalCwd = process.cwd()
    testProjectPath = options.projectPath || (await getTestProjectPath())
    const fs = await import('fs')
    if (!fs.existsSync(testProjectPath)) {
      fs.mkdirSync(testProjectPath, { recursive: true })
    }
    process.chdir(testProjectPath)
  }

  const config = createTestConfig(options.configOverrides)

  if (isNodeEnv && config.config.filesDir) {
    const fs = await import('fs')
    const path = await import('path')
    const resolvedFilesDir = path.resolve(config.config.filesDir)
    if (!fs.existsSync(resolvedFilesDir)) {
      fs.mkdirSync(resolvedFilesDir, { recursive: true })
    }
  }

  if (isNodeEnv && options.beforeInit) {
    await options.beforeInit()
  }

  await initializeTestClient({ config, timeout: options.timeout })

  if (isNodeEnv && testProjectPath && !options.projectPath) {
    const os = await import('os')
    const tmpDir = os.tmpdir()
    if (testProjectPath.startsWith(tmpDir)) {
      testProjectPathForCleanup = testProjectPath
    }
  }

  return testProjectPath
}

export async function teardownTestEnvironment(): Promise<void> {
  if (typeof window === 'undefined') {
    if (originalCwd) {
      process.chdir(originalCwd)
      originalCwd = undefined
    }
    if (testProjectPathForCleanup) {
      const fs = await import('fs')
      const os = await import('os')
      const tmpDir = os.tmpdir()
      if (testProjectPathForCleanup.startsWith(tmpDir)) {
        try {
          if (fs.existsSync(testProjectPathForCleanup)) {
            fs.rmSync(testProjectPathForCleanup, { recursive: true, force: true })
          }
        } catch {
          // ignore
        }
      }
      testProjectPathForCleanup = undefined
    }
  }
}
