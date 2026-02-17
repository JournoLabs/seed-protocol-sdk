// @vitest-environment node
import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest'
import { BaseDb } from '@/db/Db/BaseDb'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { setupTestEnvironment, teardownTestEnvironment } from '../test-utils/client-init'
import { setupFixtureFiles, cleanupFixtureFiles, getFixturePath } from '../test-utils/setupFixtureFiles'
import { loadSchemaFromFile, importJsonSchema } from '@/imports/json'
import { models, properties, schemas, modelSchemas, modelUids, propertyUids, PropertyType } from '@/seedSchema'
import { eq, and } from 'drizzle-orm'


// Handle path resolution for both Node.js and browser environments
let pathModule: any
let __dirname: string

// This test should only run in Node.js environment (file system operations)
// Use sequential execution to avoid database locking issues
const testDescribe = typeof window === 'undefined' 
  ? (describe.sequential || describe)
  : describe

testDescribe('Schema ID Generation Integration Tests', () => {
  const isNodeEnv = typeof window === 'undefined'
  const fixtureNames = [
    'schema-with-ids.json',
    'schema-without-ids.json',
    'schema-partial-ids.json'
  ]

  beforeAll(async () => {
    // Set up Node.js-specific modules if needed
    if (isNodeEnv) {
      const path = await import('path')
      const { fileURLToPath } = await import('url')
      pathModule = path
      const __filename = fileURLToPath(import.meta.url)
      __dirname = path.dirname(__filename)
    } else {
      // In browser, use a relative path approach
      __dirname = new URL('.', import.meta.url).pathname
    }

    await setupTestEnvironment({
      testFileUrl: import.meta.url,
      timeout: 120000, // Increased timeout for database initialization
      configOverrides: {
        // Ensure we have a proper working directory for file operations
      },
    })

    // Make fixture files available in the test environment
    await setupFixtureFiles(fixtureNames)
  }, 120000)

  afterEach(async () => {
    // Clean up database after each test
    // Delete in order to respect foreign key constraints:
    // 1. Join tables and tables that reference both models and schemas
    // 2. Tables that reference models
    // 3. Models (no dependencies after above)
    // 4. Schemas (no dependencies after modelSchemas is deleted)
    const db = BaseDb.getAppDb()
    if (db) {
      await db.delete(modelSchemas)
      await db.delete(propertyUids)
      await db.delete(modelUids)
      await db.delete(properties)
      await db.delete(models)
      await db.delete(schemas)
    }

    // Clean up schema files (Node.js only)
    if (isNodeEnv && pathModule) {
      try {
        const fs = await import('fs')
        const workingDir = BaseFileManager.getWorkingDir()
        if (fs.existsSync && fs.existsSync(workingDir)) {
          const files = fs.readdirSync(workingDir)
          for (const file of files) {
            // Delete schema files that match our test schema names
            if (file.endsWith('.json') && (
              file.includes('Test_Schema_With_IDs') ||
              file.includes('Test_Schema_Without_IDs') ||
              file.includes('Test_Schema_With_Partial_IDs')
            )) {
              try {
                fs.unlinkSync(pathModule.join(workingDir, file))
              } catch (error) {
                // Ignore errors during cleanup
              }
            }
          }
        }
      } catch (error) {
        // Ignore errors if fs module is not available or cleanup fails
      }
    }
  })

  afterAll(async () => {
    // Clean up fixture files after all tests
    await cleanupFixtureFiles(fixtureNames)
    
    // Restore original working directory in Node.js
    if (isNodeEnv) {
      await teardownTestEnvironment()
    }
  })

  describe('loadSchemaFromFile - ID generation', () => {
    it('should preserve existing IDs when schema file has all IDs', async () => {
      // In Node.js, files are in the current working directory (__mocks__/node/project)
      // In browser, files are in /app-files
      const fixturePath = isNodeEnv && pathModule
        ? pathModule.join(process.cwd(), 'schema-with-ids.json')
        : '/app-files/schema-with-ids.json'
      
      await loadSchemaFromFile(fixturePath)

      const db = BaseDb.getAppDb()
      if (!db) throw new Error('Database not available')

      // Small delay to ensure database update is committed (especially in browser/OPFS)
      await new Promise(resolve => setTimeout(resolve, 50))

      // Check schema - query by schemaFileId first (most reliable), then fallback to name
      let schemaRecords = await db
        .select()
        .from(schemas)
        .where(eq(schemas.schemaFileId, 'TEST_SCHEMA_WITH_IDS'))
        .limit(1)
      
      // If not found by schemaFileId, try by name (non-draft)
      if (schemaRecords.length === 0) {
        schemaRecords = await db
          .select()
          .from(schemas)
          .where(and(eq(schemas.name, 'Test Schema With IDs'), eq(schemas.isDraft, false)))
          .limit(1)
      }
      
      expect(schemaRecords.length).toBe(1)
      expect(schemaRecords[0].schemaFileId).toBe('TEST_SCHEMA_WITH_IDS')

      // Check models
      const userModel = await db
        .select()
        .from(models)
        .where(eq(models.name, 'User'))
        .limit(1)
      
      expect(userModel.length).toBe(1)
      expect(userModel[0].schemaFileId).toBe('TEST_USER_MODEL')

      const postModel = await db
        .select()
        .from(models)
        .where(eq(models.name, 'Post'))
        .limit(1)
      
      expect(postModel.length).toBe(1)
      expect(postModel[0].schemaFileId).toBe('TEST_POST_MODEL')

      // Check properties
      const userProperties = await db
        .select()
        .from(properties)
        .where(eq(properties.modelId, userModel[0].id!))
      
      const nameProp = userProperties.find((p: PropertyType) => p.name === 'name')
      expect(nameProp).toBeDefined()
      expect(nameProp?.schemaFileId).toBe('TEST_USER_NAME_PROP')

      const emailProp = userProperties.find((p: PropertyType) => p.name === 'email')
      expect(emailProp).toBeDefined()
      expect(emailProp?.schemaFileId).toBe('TEST_USER_EMAIL_PROP')
    })

    it('should generate IDs when schema file has no IDs', async () => {
      const fixturePath = isNodeEnv && pathModule
        ? pathModule.join(process.cwd(), 'schema-without-ids.json')
        : '/app-files/schema-without-ids.json'
      
      await loadSchemaFromFile(fixturePath)

      const db = BaseDb.getAppDb()
      if (!db) throw new Error('Database not available')

      // Check schema - should have generated ID
      const schemaRecords = await db
        .select()
        .from(schemas)
        .where(eq(schemas.name, 'Test Schema Without IDs'))
        .limit(1)
      
      expect(schemaRecords.length).toBe(1)
      expect(schemaRecords[0].schemaFileId).toBeTruthy()
      expect(schemaRecords[0].schemaFileId).not.toBeNull()

      // Check models - should have generated IDs
      const productModel = await db
        .select()
        .from(models)
        .where(eq(models.name, 'Product'))
        .limit(1)
      
      expect(productModel.length).toBe(1)
      expect(productModel[0].schemaFileId).toBeTruthy()
      expect(productModel[0].schemaFileId).not.toBeNull()

      const categoryModel = await db
        .select()
        .from(models)
        .where(eq(models.name, 'Category'))
        .limit(1)
      
      expect(categoryModel.length).toBe(1)
      expect(categoryModel[0].schemaFileId).toBeTruthy()
      expect(categoryModel[0].schemaFileId).not.toBeNull()

      // Check properties - should have generated IDs
      const productProperties = await db
        .select()
        .from(properties)
        .where(eq(properties.modelId, productModel[0].id!))
      
      expect(productProperties.length).toBe(3) // name, price, description
      productProperties.forEach((prop: PropertyType) => {
        expect(prop.schemaFileId).toBeTruthy()
        expect(prop.schemaFileId).not.toBeNull()
      })
    })

    it('should generate missing IDs while preserving existing ones', async () => {
      const fixturePath = isNodeEnv && pathModule
        ? pathModule.join(process.cwd(), 'schema-partial-ids.json')
        : '/app-files/schema-partial-ids.json'
      
      await loadSchemaFromFile(fixturePath)

      const db = BaseDb.getAppDb()
      if (!db) throw new Error('Database not available')

      // Small delay to ensure database update is committed (especially in browser/OPFS)
      await new Promise(resolve => setTimeout(resolve, 50))

      // Check schema - should preserve existing ID - query by schemaFileId first (most reliable)
      let schemaRecords = await db
        .select()
        .from(schemas)
        .where(eq(schemas.schemaFileId, 'TEST_SCHEMA_PARTIAL'))
        .limit(1)
      
      // If not found by schemaFileId, try by name (non-draft)
      if (schemaRecords.length === 0) {
        schemaRecords = await db
          .select()
          .from(schemas)
          .where(and(eq(schemas.name, 'Test Schema With Partial IDs'), eq(schemas.isDraft, false)))
          .limit(1)
      }
      
      expect(schemaRecords.length).toBe(1)
      expect(schemaRecords[0].schemaFileId).toBe('TEST_SCHEMA_PARTIAL')

      // Check Order model - should preserve existing ID
      const orderModel = await db
        .select()
        .from(models)
        .where(eq(models.name, 'Order'))
        .limit(1)
      
      expect(orderModel.length).toBe(1)
      expect(orderModel[0].schemaFileId).toBe('TEST_ORDER_MODEL')

      // Check Item model - should have generated ID
      const itemModel = await db
        .select()
        .from(models)
        .where(eq(models.name, 'Item'))
        .limit(1)
      
      expect(itemModel.length).toBe(1)
      expect(itemModel[0].schemaFileId).toBeTruthy()
      expect(itemModel[0].schemaFileId).not.toBeNull()
      expect(itemModel[0].schemaFileId).not.toBe('TEST_ORDER_MODEL') // Should be different

      // Check Order properties
      const orderProperties = await db
        .select()
        .from(properties)
        .where(eq(properties.modelId, orderModel[0].id!))
      
      const orderNumberProp = orderProperties.find((p: PropertyType) => p.name === 'orderNumber')
      expect(orderNumberProp).toBeDefined()
      expect(orderNumberProp?.schemaFileId).toBe('TEST_ORDER_NUMBER_PROP')

      const totalProp = orderProperties.find((p: PropertyType) => p.name === 'total')
      expect(totalProp).toBeDefined()
      expect(totalProp?.schemaFileId).toBeTruthy() // Should be generated
      expect(totalProp?.schemaFileId).not.toBeNull()

      // Check Item properties
      const itemProperties = await db
        .select()
        .from(properties)
        .where(eq(properties.modelId, itemModel[0].id!))
      
      const itemNameProp = itemProperties.find((p: PropertyType) => p.name === 'name')
      expect(itemNameProp).toBeDefined()
      expect(itemNameProp?.schemaFileId).toBe('TEST_ITEM_NAME_PROP')

      const quantityProp = itemProperties.find((p: PropertyType) => p.name === 'quantity')
      expect(quantityProp).toBeDefined()
      expect(quantityProp?.schemaFileId).toBeTruthy() // Should be generated
      expect(quantityProp?.schemaFileId).not.toBeNull()
    })
  })

  describe('importJsonSchema - ID generation for complete schemas', () => {
    it('should generate IDs when importing complete schema without IDs', async () => {
      const fixturePath = isNodeEnv && pathModule
        ? pathModule.join(process.cwd(), 'schema-without-ids.json')
        : '/app-files/schema-without-ids.json'
      const content = await BaseFileManager.readFileAsString(fixturePath)
      
      await importJsonSchema({ contents: content }, 1)

      const db = BaseDb.getAppDb()
      if (!db) throw new Error('Database not available')

      // Check schema - should have generated ID
      const schemaRecords = await db
        .select()
        .from(schemas)
        .where(eq(schemas.name, 'Test Schema Without IDs'))
        .limit(1)
      
      expect(schemaRecords.length).toBe(1)
      expect(schemaRecords[0].schemaFileId).toBeTruthy()
      expect(schemaRecords[0].schemaFileId).not.toBeNull()

      // Check models - should have generated IDs
      const productModel = await db
        .select()
        .from(models)
        .where(eq(models.name, 'Product'))
        .limit(1)
      
      expect(productModel.length).toBe(1)
      expect(productModel[0].schemaFileId).toBeTruthy()
      expect(productModel[0].schemaFileId).not.toBeNull()
    })

    it('should preserve existing IDs when importing complete schema with IDs', async () => {
      const fixturePath = isNodeEnv && pathModule
        ? pathModule.join(process.cwd(), 'schema-with-ids.json')
        : '/app-files/schema-with-ids.json'
      const content = await BaseFileManager.readFileAsString(fixturePath)
      
      await importJsonSchema({ contents: content }, 1)

      const db = BaseDb.getAppDb()
      if (!db) throw new Error('Database not available')

      // Check schema - should preserve ID
      const schemaRecords = await db
        .select()
        .from(schemas)
        .where(eq(schemas.name, 'Test Schema With IDs'))
        .limit(1)
      
      expect(schemaRecords.length).toBe(1)
      expect(schemaRecords[0].schemaFileId).toBe('TEST_SCHEMA_WITH_IDS')

      // Check models - should preserve IDs
      const userModel = await db
        .select()
        .from(models)
        .where(eq(models.name, 'User'))
        .limit(1)
      
      expect(userModel.length).toBe(1)
      expect(userModel[0].schemaFileId).toBe('TEST_USER_MODEL')
    })

    it('should generate missing IDs while preserving existing ones in complete schema', async () => {
      const fixturePath = isNodeEnv && pathModule
        ? pathModule.join(process.cwd(), 'schema-partial-ids.json')
        : '/app-files/schema-partial-ids.json'
      const content = await BaseFileManager.readFileAsString(fixturePath)
      
      await importJsonSchema({ contents: content }, 1)

      const db = BaseDb.getAppDb()
      if (!db) throw new Error('Database not available')

      // Check schema - should preserve ID
      const schemaRecords = await db
        .select()
        .from(schemas)
        .where(eq(schemas.name, 'Test Schema With Partial IDs'))
        .limit(1)
      
      expect(schemaRecords.length).toBe(1)
      expect(schemaRecords[0].schemaFileId).toBe('TEST_SCHEMA_PARTIAL')

      // Check Order model - should preserve ID
      const orderModel = await db
        .select()
        .from(models)
        .where(eq(models.name, 'Order'))
        .limit(1)
      
      expect(orderModel.length).toBe(1)
      expect(orderModel[0].schemaFileId).toBe('TEST_ORDER_MODEL')

      // Check Item model - should have generated ID
      const itemModel = await db
        .select()
        .from(models)
        .where(eq(models.name, 'Item'))
        .limit(1)
      
      expect(itemModel.length).toBe(1)
      expect(itemModel[0].schemaFileId).toBeTruthy()
      expect(itemModel[0].schemaFileId).not.toBeNull()
    })
  })

  describe('ID generation consistency', () => {
    it('should generate unique IDs for different models and properties', async () => {
      const fixturePath = isNodeEnv && pathModule
        ? pathModule.join(process.cwd(), 'schema-without-ids.json')
        : '/app-files/schema-without-ids.json'
      
      await loadSchemaFromFile(fixturePath)

      const db = BaseDb.getAppDb()
      if (!db) throw new Error('Database not available')

      const productModel = await db
        .select()
        .from(models)
        .where(eq(models.name, 'Product'))
        .limit(1)
      
      const categoryModel = await db
        .select()
        .from(models)
        .where(eq(models.name, 'Category'))
        .limit(1)

      // Models should have different IDs
      expect(productModel[0].schemaFileId).not.toBe(categoryModel[0].schemaFileId)

      // Properties within same model should have different IDs
      const productProperties = await db
        .select()
        .from(properties)
        .where(eq(properties.modelId, productModel[0].id!))
      
      const propertyIds = productProperties.map((p: PropertyType) => p.schemaFileId).filter(Boolean)
      const uniqueIds = new Set(propertyIds)
      expect(uniqueIds.size).toBe(propertyIds.length) // All IDs should be unique
    })
  })
})

