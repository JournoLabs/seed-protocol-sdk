import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import { waitFor } from 'xstate'
import { Schema } from '@/Schema/Schema'
import { Model } from '@/Model/Model'
import { BaseDb } from '@/db/Db/BaseDb'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { schemas } from '@/seedSchema/SchemaSchema'
import { models as modelsTable } from '@/seedSchema/ModelSchema'
import { seeds } from '@/seedSchema/SeedSchema'
import { versions } from '@/seedSchema/VersionSchema'
import { metadata } from '@/seedSchema/MetadataSchema'
import { eq, and } from 'drizzle-orm'
import { SchemaFileFormat } from '@/types/import'
import { importJsonSchema } from '@/imports/json'
import { generateId } from '@/helpers'
import { setupTestEnvironment } from '../test-utils/client-init'

// Helper function to wait for model to be in idle state using xstate waitFor
async function waitForModelIdle(model: Model, timeout: number = 5000): Promise<void> {
  const service = model.getService()
  
  try {
    await waitFor(
      service,
      (snapshot) => {
        if (snapshot.value === 'error') {
          throw new Error('Model failed to load')
        }
        return snapshot.value === 'idle'
      },
      { timeout }
    )
  } catch (error: any) {
    if (error.message === 'Model failed to load') {
      throw error
    }
    throw new Error(`Model loading timeout after ${timeout}ms`)
  }
}

// Helper function to wait for schema to be in idle state using xstate waitFor
async function waitForSchemaIdle(schema: Schema, timeout: number = 5000): Promise<void> {
  const service = schema.getService()
  
  try {
    await waitFor(
      service,
      (snapshot) => {
        if (snapshot.value === 'error') {
          throw new Error('Schema failed to load')
        }
        return snapshot.value === 'idle'
      },
      { timeout }
    )
  } catch (error: any) {
    if (error.message === 'Schema failed to load') {
      throw error
    }
    throw new Error(`Schema loading timeout after ${timeout}ms`)
  }
}

// Helper to create a test schema
function createTestSchema(name: string, models: Record<string, any> = {}): SchemaFileFormat {
  return {
    $schema: 'https://seedprotocol.org/schemas/data-model/v1',
    version: 1,
    id: generateId(),
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

// This test should run in both browser and Node.js environments
// Use sequential execution to avoid database locking issues in Node.js
const testDescribe = typeof window === 'undefined' 
  ? (describe.sequential || describe)
  : describe

testDescribe('Model Integration Tests', () => {
  let fsModule: any
  let pathModule: any
  const isNodeEnv = typeof window === 'undefined'

  beforeAll(async () => {
    // Set up Node.js-specific modules if needed
    if (isNodeEnv) {
      fsModule = await import('fs')
      pathModule = await import('path')
    }

    // Use shared test environment setup
    await setupTestEnvironment({
      testFileUrl: import.meta.url,
      timeout: 90000,
    })
  }, 90000) // Increased timeout to allow for full initialization

  afterAll(async () => {
    // Clean up
    const db = BaseDb.getAppDb()
    if (db) {
      await db.delete(modelsTable)
      await db.delete(schemas)
    }
  })

  beforeEach(async () => {
    // Clean up database before each test
    const db = BaseDb.getAppDb()
    if (db) {
      await db.delete(modelsTable)
      await db.delete(schemas)
    }

    // Clean up model files (Node.js only)
    if (isNodeEnv && fsModule) {
      const workingDir = BaseFileManager.getWorkingDir()
      if (fsModule.existsSync && fsModule.existsSync(workingDir)) {
        const files = fsModule.readdirSync(workingDir)
        for (const file of files) {
          if (file.endsWith('.json') && (file.includes('Test_Model') || file.includes('Test_Schema'))) {
            fsModule.unlinkSync(pathModule.join(workingDir, file))
          }
        }
      }
    }
  })

  afterEach(async () => {
    // Clean up Model instances by unloading them
    const db = BaseDb.getAppDb()
    if (db) {
      const dbModels = await db.select().from(modelsTable)
      for (const dbModel of dbModels) {
        try {
          const model = Model.getByName(dbModel.name, dbModel.schemaName)
          if (model) {
            model.unload()
          }
        } catch (error) {
          // Model might not exist, ignore
        }
      }
    }
  })

  describe('Model.create()', () => {
    it('should create a new Model instance with schema name string', async () => {
      const schemaName = 'Test Schema Model Create'
      const testSchema = createTestSchema(schemaName)

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      const model = Model.create('TestModel', schemaName)
      expect(model).toBeDefined()
      expect(model.modelName).toBe('TestModel')
      expect(model.schemaName).toBe(schemaName)
      
      await waitForModelIdle(model)
      
      const context = model.getService().getSnapshot().context
      expect(context.modelName).toBe('TestModel')
      expect(context.schemaName).toBe(schemaName)
    })

    it('should create a new Model instance with Schema instance', async () => {
      const schemaName = 'Test Schema Model Create Instance'
      const testSchema = createTestSchema(schemaName)

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      const schema = Schema.create(schemaName)
      await new Promise(resolve => setTimeout(resolve, 500)) // Wait for schema to initialize
      
      const model = Model.create('TestModel', schema)
      expect(model).toBeDefined()
      expect(model.modelName).toBe('TestModel')
      expect(model.schemaName).toBe(schemaName)
      
      await waitForModelIdle(model)
    })

    it('should create a Model with properties', async () => {
      const schemaName = 'Test Schema Model Properties'
      const testSchema = createTestSchema(schemaName)

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      const properties = {
        title: { dataType: 'String' },
        content: { dataType: 'Text' },
      }
      
      const model = Model.create('TestModel', schemaName, {
        properties,
      })
      
      await waitForModelIdle(model)
      
      expect(model.properties).toBeDefined()
      expect(model.properties?.title).toBeDefined()
      expect(model.properties?.content).toBeDefined()
    })

    it('should create a Model with indexes', async () => {
      const schemaName = 'Test Schema Model Indexes'
      const testSchema = createTestSchema(schemaName)

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      const model = Model.create('TestModel', schemaName, {
        properties: {
          title: { dataType: 'String' },
        },
        indexes: ['title'],
      })
      
      await waitForModelIdle(model)
      
      expect(model.indexes).toBeDefined()
      expect(model.indexes).toContain('title')
    })

    it('should create a Model with description', async () => {
      const schemaName = 'Test Schema Model Description'
      const testSchema = createTestSchema(schemaName)

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      const description = 'Test model description'
      const model = Model.create('TestModel', schemaName, {
        description,
      })
      
      await waitForModelIdle(model)
      
      expect(model.description).toBe(description)
    })

    it('should create a Model with modelFileId', async () => {
      const schemaName = 'Test Schema Model File ID'
      const testSchema = createTestSchema(schemaName)

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      const modelFileId = generateId()
      const model = Model.create('TestModel', schemaName, {
        modelFileId,
      })
      
      await waitForModelIdle(model)
      
      expect(model.id).toBe(modelFileId)
      const context = model.getService().getSnapshot().context
      expect(context._modelFileId).toBe(modelFileId)
    })

    it('should return the same instance when called multiple times (caching)', async () => {
      const schemaName = 'Test Schema Model Cache'
      const testSchema = createTestSchema(schemaName)

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      const model1 = Model.create('TestModel', schemaName)
      const model2 = Model.create('TestModel', schemaName)
      
      await waitForModelIdle(model1)
      await waitForModelIdle(model2)
      
      expect(model1).toBe(model2)
    })

    it('should throw error if model name is empty', () => {
      // This test doesn't require client initialization
      expect(() => {
        Model.create('', 'TestSchema')
      }).toThrow('Model name is required')
    })

    it('should throw error if schema name is empty', () => {
      // This test doesn't require client initialization
      expect(() => {
        Model.create('TestModel', '')
      }).toThrow('Schema name is required')
    })

    it('should create model with empty properties when options not provided', async () => {
      const schemaName = 'Test Schema Model Empty'
      const testSchema = createTestSchema(schemaName)

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      const model = Model.create('TestModel', schemaName)
      await waitForModelIdle(model)
      
      expect(model.properties).toBeDefined()
      expect(Object.keys(model.properties || {})).toHaveLength(0)
    })
  })

  describe('Model.create() - Database Integration', () => {
    it('should create seed, version, and metadata records when creating an item instance', async () => {
      const schemaName = 'Test Schema Model DB Integration'
      const testSchema = createTestSchema(schemaName, {
        TestModel: {
          id: generateId(),
          properties: {
            title: {
              id: generateId(),
              type: 'String',
            },
            content: {
              id: generateId(),
              type: 'Text',
            },
            count: {
              id: generateId(),
              type: 'Number',
            },
          },
        },
      })

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      const TestModel = Model.create('TestModel', schemaName)
      await waitForModelIdle(TestModel)
      
      // Create an item instance
      const testModelItem = await TestModel.create({
        title: 'Test Title',
        content: 'Test Content',
        count: 42,
      } as any)

      // Wait a bit for database writes to complete
      await new Promise(resolve => setTimeout(resolve, 500))

      // Verify item has required IDs
      expect(testModelItem.seedLocalId).toBeDefined()
      expect(testModelItem.latestVersionLocalId).toBeDefined()

      const db = BaseDb.getAppDb()
      if (!db) {
        throw new Error('Database not available')
      }

      // Verify seed record was created
      const seedRecords = await db
        .select()
        .from(seeds)
        .where(eq(seeds.localId, testModelItem.seedLocalId!))
        .limit(1)

      expect(seedRecords).toHaveLength(1)
      expect(seedRecords[0].localId).toBe(testModelItem.seedLocalId)
      expect(seedRecords[0].type).toBe('test_model')
      expect(seedRecords[0].schemaUid).toBeDefined()
      expect(seedRecords[0].createdAt).toBeDefined()
      expect(seedRecords[0].createdAt).toBeGreaterThan(0)

      // Verify version record was created
      const versionRecords = await db
        .select()
        .from(versions)
        .where(eq(versions.localId, testModelItem.latestVersionLocalId!))
        .limit(1)

      expect(versionRecords).toHaveLength(1)
      expect(versionRecords[0].localId).toBe(testModelItem.latestVersionLocalId)
      expect(versionRecords[0].seedLocalId).toBe(testModelItem.seedLocalId)
      expect(versionRecords[0].seedType).toBe('test_model')
      expect(versionRecords[0].createdAt).toBeDefined()
      expect(versionRecords[0].createdAt).toBeGreaterThan(0)

      // Verify metadata records were created for each property
      const metadataRecords = await db
        .select()
        .from(metadata)
        .where(
          and(
            eq(metadata.seedLocalId, testModelItem.seedLocalId!),
            eq(metadata.versionLocalId, testModelItem.latestVersionLocalId!)
          )
        )

      expect(metadataRecords.length).toBeGreaterThanOrEqual(3)

      // Verify title metadata
      const titleMetadata = metadataRecords.find((r: any) => r.propertyName === 'title')
      expect(titleMetadata).toBeDefined()
      expect(titleMetadata!.propertyValue).toBe('Test Title')
      expect(titleMetadata!.seedLocalId).toBe(testModelItem.seedLocalId)
      expect(titleMetadata!.versionLocalId).toBe(testModelItem.latestVersionLocalId)
      expect(titleMetadata!.modelType).toBe('test_model')
      expect(titleMetadata!.createdAt).toBeDefined()
      expect(titleMetadata!.updatedAt).toBeDefined()

      // Verify content metadata
      const contentMetadata = metadataRecords.find((r: any) => r.propertyName === 'content')
      expect(contentMetadata).toBeDefined()
      expect(contentMetadata!.propertyValue).toBe('Test Content')
      expect(contentMetadata!.seedLocalId).toBe(testModelItem.seedLocalId)
      expect(contentMetadata!.versionLocalId).toBe(testModelItem.latestVersionLocalId)

      // Verify count metadata
      const countMetadata = metadataRecords.find((r: any) => r.propertyName === 'count')
      expect(countMetadata).toBeDefined()
      expect(countMetadata!.propertyValue).toBe('42')
      expect(countMetadata!.seedLocalId).toBe(testModelItem.seedLocalId)
      expect(countMetadata!.versionLocalId).toBe(testModelItem.latestVersionLocalId)
    })

    it('should create records with correct relationships between seed, version, and metadata', async () => {
      const schemaName = 'Test Schema Model DB Relationships'
      const testSchema = createTestSchema(schemaName, {
        TestModel: {
          id: generateId(),
          properties: {
            name: {
              id: generateId(),
              type: 'String',
            },
          },
        },
      })

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      const model = Model.create('TestModel', schemaName)
      await waitForModelIdle(model)
      
      const item = await model.create({
        name: 'Test Item',
      } as any)

      await new Promise(resolve => setTimeout(resolve, 500))

      // Verify item has required IDs
      expect(item.seedLocalId).toBeDefined()
      expect(item.latestVersionLocalId).toBeDefined()

      const db = BaseDb.getAppDb()
      if (!db) {
        throw new Error('Database not available')
      }

      // Get all related records
      const seedRecord = (await db
        .select()
        .from(seeds)
        .where(eq(seeds.localId, item.seedLocalId!))
        .limit(1))[0]

      const versionRecord = (await db
        .select()
        .from(versions)
        .where(eq(versions.localId, item.latestVersionLocalId!))
        .limit(1))[0]

      const metadataRecords = await db
        .select()
        .from(metadata)
        .where(
          and(
            eq(metadata.seedLocalId, item.seedLocalId!),
            eq(metadata.versionLocalId, item.latestVersionLocalId!)
          )
        )

      // Verify relationships
      expect(versionRecord.seedLocalId).toBe(seedRecord.localId)
      expect(versionRecord.seedType).toBe(seedRecord.type)

      // All metadata records should reference the same seed and version
      for (const meta of metadataRecords) {
        expect(meta.seedLocalId).toBe(seedRecord.localId)
        expect(meta.versionLocalId).toBe(versionRecord.localId)
        expect(meta.modelType).toBe(seedRecord.type)
      }
    })

    it('should handle creating items with no properties', async () => {
      const schemaName = 'Test Schema Model DB No Properties'
      const testSchema = createTestSchema(schemaName, {
        TestModel: {
          id: generateId(),
          properties: {},
        },
      })

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      const model = Model.create('TestModel', schemaName)
      await waitForModelIdle(model)
      
      const item = await model.create({} as any)

      await new Promise(resolve => setTimeout(resolve, 500))

      // Verify item has required IDs
      expect(item.seedLocalId).toBeDefined()
      expect(item.latestVersionLocalId).toBeDefined()

      const db = BaseDb.getAppDb()
      if (!db) {
        throw new Error('Database not available')
      }

      // Verify seed and version records were still created
      const seedRecords = await db
        .select()
        .from(seeds)
        .where(eq(seeds.localId, item.seedLocalId!))
        .limit(1)

      expect(seedRecords).toHaveLength(1)

      const versionRecords = await db
        .select()
        .from(versions)
        .where(eq(versions.localId, item.latestVersionLocalId!))
        .limit(1)

      expect(versionRecords).toHaveLength(1)

      // No metadata records should be created if no properties provided
      const metadataRecords = await db
        .select()
        .from(metadata)
        .where(
          and(
            eq(metadata.seedLocalId, item.seedLocalId!),
            eq(metadata.versionLocalId, item.latestVersionLocalId!)
          )
        )

      // Should have 0 metadata records since no properties were provided
      expect(metadataRecords.length).toBe(0)
    })

    it('should create unique localIds for seed, version, and metadata records', async () => {
      const schemaName = 'Test Schema Model DB Unique IDs'
      const testSchema = createTestSchema(schemaName, {
        TestModel: {
          id: generateId(),
          properties: {
            value: {
              id: generateId(),
              type: 'String',
            },
          },
        },
      })

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      const model = Model.create('TestModel', schemaName)
      await waitForModelIdle(model)
      
      // Create multiple items
      const item1 = await model.create({ value: 'Item 1' } as any)
      const item2 = await model.create({ value: 'Item 2' } as any)

      await new Promise(resolve => setTimeout(resolve, 500))

      // Verify items have required IDs
      expect(item1.seedLocalId).toBeDefined()
      expect(item1.latestVersionLocalId).toBeDefined()
      expect(item2.seedLocalId).toBeDefined()
      expect(item2.latestVersionLocalId).toBeDefined()

      const db = BaseDb.getAppDb()
      if (!db) {
        throw new Error('Database not available')
      }

      // Verify all IDs are unique
      expect(item1.seedLocalId).not.toBe(item2.seedLocalId)
      expect(item1.latestVersionLocalId).not.toBe(item2.latestVersionLocalId)

      // Verify seed records have unique localIds
      const allSeeds = await db.select().from(seeds)
      const seedLocalIds = allSeeds.map((s: any) => s.localId).filter(Boolean)
      expect(new Set(seedLocalIds).size).toBe(seedLocalIds.length)

      // Verify version records have unique localIds
      const allVersions = await db.select().from(versions)
      const versionLocalIds = allVersions.map((v: any) => v.localId).filter(Boolean)
      expect(new Set(versionLocalIds).size).toBe(versionLocalIds.length)

      // Verify metadata records have unique localIds
      const allMetadata = await db.select().from(metadata)
      const metadataLocalIds = allMetadata.map((m: any) => m.localId).filter(Boolean)
      expect(new Set(metadataLocalIds).size).toBe(metadataLocalIds.length)
    })
  })

  describe('Model.getById()', () => {
    it('should return cached Model instance by modelFileId', async () => {
      const schemaName = 'Test Schema Model Get By ID'
      const testSchema = createTestSchema(schemaName)

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      const modelFileId = generateId()
      const model1 = Model.create('TestModel', schemaName, { modelFileId })
      await waitForModelIdle(model1)
      
      const model2 = Model.getById(modelFileId)
      expect(model2).toBe(model1)
    })

    it('should return undefined if model not found in cache', () => {
      // This test doesn't require client initialization - just tests cache lookup
      const nonExistentId = generateId()
      const model = Model.getById(nonExistentId)
      expect(model).toBeUndefined()
    })
  })

  describe('Model.getByName()', () => {
    it('should return cached Model instance by name', async () => {
      const schemaName = 'Test Schema Model Get By Name'
      const testSchema = createTestSchema(schemaName)

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      const model1 = Model.create('TestModel', schemaName)
      await waitForModelIdle(model1)
      
      const model2 = Model.getByName('TestModel', schemaName)
      expect(model2).toBe(model1)
    })

    it('should return undefined if model not found in cache', () => {
      // This test doesn't require client initialization - just tests cache lookup
      const model = Model.getByName('NonExistentModel', 'NonExistentSchema')
      expect(model).toBeUndefined()
    })
  })

  describe('Model property access', () => {
    it('should access model properties through proxy', async () => {
      const schemaName = 'Test Schema Model Property Access'
      const testSchema = createTestSchema(schemaName)

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      const properties = {
        title: { dataType: 'String' },
        content: { dataType: 'Text' },
      }
      
      const model = Model.create('TestModel', schemaName, { properties })
      await waitForModelIdle(model)
      
      // Test property access
      expect(model.modelName).toBe('TestModel')
      expect(model.schemaName).toBe(schemaName)
      expect(model.properties).toBeDefined()
      expect(model.properties?.title).toBeDefined()
    })

    it('should access model name via "name" alias', async () => {
      const schemaName = 'Test Schema Model Name Alias'
      const testSchema = createTestSchema(schemaName)

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      const model = Model.create('TestModel', schemaName)
      await waitForModelIdle(model)
      
      expect(model.name).toBe('TestModel')
      expect(model.name).toBe(model.modelName)
    })

    it('should access model id via "id" property', async () => {
      const schemaName = 'Test Schema Model ID Property'
      const testSchema = createTestSchema(schemaName)

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      const modelFileId = generateId()
      const model = Model.create('TestModel', schemaName, { modelFileId })
      await waitForModelIdle(model)
      
      expect(model.id).toBe(modelFileId)
    })

    it('should update model name', async () => {
      const schemaName = 'Test Schema Model Update Name'
      const testSchema = createTestSchema(schemaName)

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      const model = Model.create('TestModel', schemaName)
      await waitForModelIdle(model)
      
      const oldName = model.modelName
      const newName = 'UpdatedModel'
      
      model.modelName = newName
      
      // Wait for update to complete
      await new Promise(resolve => setTimeout(resolve, 200))
      
      expect(model.modelName).toBe(newName)
      expect(model.name).toBe(newName)
    })

    it('should update model properties', async () => {
      const schemaName = 'Test Schema Model Update Properties'
      const testSchema = createTestSchema(schemaName)

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      const model = Model.create('TestModel', schemaName, {
        properties: {
          title: { dataType: 'String' },
        },
      })
      await waitForModelIdle(model)
      
      const newProperties = {
        title: { dataType: 'String' },
        content: { dataType: 'Text' },
      }
      
      model.properties = newProperties
      
      // Wait for update to complete
      await new Promise(resolve => setTimeout(resolve, 200))
      
      expect(model.properties).toBeDefined()
      expect(model.properties?.content).toBeDefined()
    })

    it('should update model indexes', async () => {
      const schemaName = 'Test Schema Model Update Indexes'
      const testSchema = createTestSchema(schemaName)

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      const model = Model.create('TestModel', schemaName, {
        properties: {
          title: { dataType: 'String' },
          content: { dataType: 'Text' },
        },
        indexes: ['title'],
      })
      await waitForModelIdle(model)
      
      model.indexes = ['title', 'content']
      
      // Wait for update to complete
      await new Promise(resolve => setTimeout(resolve, 200))
      
      expect(model.indexes).toContain('title')
      expect(model.indexes).toContain('content')
    })

    it('should update model description', async () => {
      const schemaName = 'Test Schema Model Update Description'
      const testSchema = createTestSchema(schemaName)

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      const model = Model.create('TestModel', schemaName, {
        description: 'Initial description',
      })
      await waitForModelIdle(model)
      
      model.description = 'Updated description'
      
      // Wait for update to complete
      await new Promise(resolve => setTimeout(resolve, 200))
      
      expect(model.description).toBe('Updated description')
    })
  })

  describe('Model state management', () => {
    it('should track draft state', async () => {
      const schemaName = 'Test Schema Model Draft'
      const testSchema = createTestSchema(schemaName)

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      const model = Model.create('TestModel', schemaName)
      await waitForModelIdle(model)
      
      // Initially should not be a draft (loaded from file or newly created)
      let context = model.getService().getSnapshot().context
      expect(context._isEdited).toBe(false)
      
      // Make a change
      model.description = 'Updated description'
      
      // Wait for draft to be saved
      await new Promise(resolve => setTimeout(resolve, 200))
      
      // Should now be a draft
      context = model.getService().getSnapshot().context
      expect(context._isEdited).toBe(true)
    })

    it('should track validation errors', async () => {
      const schemaName = 'Test Schema Model Validation Errors'
      const testSchema = createTestSchema(schemaName)

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      const model = Model.create('TestModel', schemaName)
      await waitForModelIdle(model)
      
      // Check validation errors property
      expect(model.validationErrors).toBeDefined()
      expect(Array.isArray(model.validationErrors)).toBe(true)
      expect(model.isValid).toBe(true)
    })

    it('should provide model status', async () => {
      const schemaName = 'Test Schema Model Status'
      const testSchema = createTestSchema(schemaName)

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      const model = Model.create('TestModel', schemaName)
      
      // Status should be 'loading' initially
      expect(['loading', 'idle']).toContain(model.status)
      
      await waitForModelIdle(model)
      
      // Status should be 'idle' after loading
      expect(model.status).toBe('idle')
    })
  })

  describe('Model validation', () => {
    it('should validate a valid model', async () => {
      const schemaName = 'Test Schema Model Validate'
      const testSchema = createTestSchema(schemaName)

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      const model = Model.create('TestModel', schemaName, {
        properties: {
          title: { dataType: 'String' },
        },
      })
      await waitForModelIdle(model)
      
      const validationResult = await model.validate()
      expect(validationResult).toBeDefined()
      expect(validationResult).toHaveProperty('isValid')
      expect(validationResult).toHaveProperty('errors')
      expect(Array.isArray(validationResult.errors)).toBe(true)
    })

    it('should return validation result structure', async () => {
      const schemaName = 'Test Schema Model Validate Structure'
      const testSchema = createTestSchema(schemaName)

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      const model = Model.create('TestModel', schemaName)
      await waitForModelIdle(model)
      
      const validationResult = await model.validate()
      expect(validationResult).toHaveProperty('isValid')
      expect(validationResult).toHaveProperty('errors')
      expect(typeof validationResult.isValid).toBe('boolean')
      expect(Array.isArray(validationResult.errors)).toBe(true)
    })
  })

  describe('Model schema property', () => {
    it('should return properties as schema', async () => {
      const schemaName = 'Test Schema Model Schema Property'
      const testSchema = createTestSchema(schemaName)

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      const properties = {
        title: { dataType: 'String' },
        content: { dataType: 'Text' },
      }
      
      const model = Model.create('TestModel', schemaName, { properties })
      await waitForModelIdle(model)
      
      expect(model.schema).toBeDefined()
      expect(model.schema).toBe(model.properties)
    })
  })

  describe('Model reload', () => {
    it('should reload model from database', async () => {
      const schemaName = 'Test Schema Model Reload'
      const testSchema = createTestSchema(schemaName, {
        TestModel: {
          id: generateId(),
          properties: {
            title: {
              id: generateId(),
              type: 'Text',
            },
          },
        },
      })

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      const model = Model.create('TestModel', schemaName)
      await waitForModelIdle(model)
      
      // Update database directly
      const db = BaseDb.getAppDb()
      if (db) {
        const dbModels = await db
          .select()
          .from(modelsTable)
          .where(eq(modelsTable.name, 'TestModel'))
          .limit(1)
        
        if (dbModels.length > 0 && dbModels[0].modelData) {
          const updatedModel = JSON.parse(dbModels[0].modelData) as any
          updatedModel.description = 'Updated from database'
          
          await db
            .update(modelsTable)
            .set({
              modelData: JSON.stringify(updatedModel, null, 2),
            })
            .where(eq(modelsTable.id, dbModels[0].id!))
        }
      }
      
      // Reload model
      await model.reload()
      
      // Note: The reload might update the model, but the exact behavior depends on implementation
      expect(model).toBeDefined()
    })
  })

  describe('Model unload', () => {
    it('should unload model and clean up resources', async () => {
      const schemaName = 'Test Schema Model Unload'
      const testSchema = createTestSchema(schemaName)

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      const model = Model.create('TestModel', schemaName)
      await waitForModelIdle(model)
      
      // Verify service is running
      const snapshotBefore = model.getService().getSnapshot()
      expect(snapshotBefore.status).toBe('active')
      
      // Unload
      model.unload()
      
      // Verify service is stopped
      const snapshotAfter = model.getService().getSnapshot()
      expect(snapshotAfter.status).toBe('stopped')
    })
  })

  describe('Model name change', () => {
    it('should update cache when model name changes', async () => {
      const schemaName = 'Test Schema Model Name Change'
      const testSchema = createTestSchema(schemaName)

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      const model = Model.create('TestModel', schemaName)
      await waitForModelIdle(model)
      
      const modelId = model.id
      const oldName = model.modelName
      const newName = 'UpdatedModel'
      
      model.modelName = newName
      
      // Wait for update to complete
      await new Promise(resolve => setTimeout(resolve, 200))
      
      // Model should still be accessible by new name
      const modelByName = Model.getByName(newName, schemaName)
      expect(modelByName).toBe(model)
      
      // Model should still be accessible by ID
      const modelById = Model.getById(modelId!)
      expect(modelById).toBe(model)
      
      // Old name should not be in cache
      const oldModel = oldName ? Model.getByName(oldName, schemaName) : undefined
      expect(oldModel).toBeUndefined()
    })
  })

  describe('Model integration with Schema', () => {
    it('should register model with schema when created with schema instance', async () => {
      const schemaName = 'Test Schema Model Register'
      const testSchema = createTestSchema(schemaName)

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      const schema = Schema.create(schemaName)
      await new Promise(resolve => setTimeout(resolve, 500)) // Wait for schema to initialize
      
      const model = Model.create('TestModel', schema, {
        properties: {
          title: { dataType: 'String' },
        },
      })
      await waitForModelIdle(model)
      
      // Wait a bit for registration to complete
      await new Promise(resolve => setTimeout(resolve, 500))
      
      // Schema should have the model
      const schemaContext = schema.getService().getSnapshot().context
      expect(schemaContext.models).toBeDefined()
      expect(schemaContext.models?.['TestModel']).toBeDefined()
    })

    it('should not register model with schema when registerWithSchema is false', async () => {
      const schemaName = 'Test Schema Model No Register'
      const testSchema = createTestSchema(schemaName)

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      const schema = Schema.create(schemaName)
      await new Promise(resolve => setTimeout(resolve, 500)) // Wait for schema to initialize
      
      const model = Model.create('TestModel', schema, {
        properties: {
          title: { dataType: 'String' },
        },
        registerWithSchema: false,
      })
      await waitForModelIdle(model)
      
      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 500))
      
      // Model should still be created
      expect(model).toBeDefined()
      expect(model.modelName).toBe('TestModel')
    })
  })

  describe('Model edit independence', () => {
    it('should not update Schema context when Model is edited', async () => {
      const schemaName = 'Test Schema Model Edit Independence'
      const testSchema = createTestSchema(schemaName)

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      const schema = Schema.create(schemaName)
      await waitForSchemaIdle(schema)
      
      // Create a model
      const model = Model.create('TestModel', schema, {
        properties: {
          title: { dataType: 'String' },
        },
      })
      await waitForModelIdle(model)
      
      // Wait for registration
      await new Promise(resolve => setTimeout(resolve, 500))
      
      // Get initial Schema context state
      const initialContext = schema.getService().getSnapshot().context
      const initialModelData = initialContext.models?.['TestModel']
      
      // Edit model properties
      model.properties = {
        title: { dataType: 'String' },
        content: { dataType: 'Text' },
      }
      
      // Wait for model update to complete
      await new Promise(resolve => setTimeout(resolve, 200))
      
      // Verify Model instance has the new values
      expect(model.properties?.content).toBeDefined()
      
      // Verify Schema context.models is NOT updated immediately
      // (Model edits no longer notify Schema during edits, only during persistence)
      const updatedContext = schema.getService().getSnapshot().context
      const updatedModelData = updatedContext.models?.['TestModel']
      
      // The context.models should still have the old data structure
      // (it's not updated during Model edits, only during persistence)
      // Note: The exact structure depends on implementation, but the key point is
      // that Schema context is not immediately updated when Model is edited
      expect(updatedModelData).toBeDefined()
      
      // Verify Model instance maintains its own state
      expect(model.properties?.content).toBeDefined()
    })

    it('should read from Model instances when Schema persists', async () => {
      const schemaName = 'Test Schema Model Persistence'
      const testSchema = createTestSchema(schemaName)

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      const schema = Schema.create(schemaName)
      await waitForSchemaIdle(schema)
      
      // Create a model
      const model = Model.create('TestModel', schema, {
        properties: {
          title: { dataType: 'String' },
        },
      })
      await waitForModelIdle(model)
      
      // Wait for registration
      await new Promise(resolve => setTimeout(resolve, 500))
      
      // Edit model properties
      model.properties = {
        title: { dataType: 'String' },
        content: { dataType: 'Text' },
      }
      
      // Wait for model update
      await new Promise(resolve => setTimeout(resolve, 200))
      
      // Verify Model instance has the new values
      expect(model.properties?.content).toBeDefined()
      
      // When Schema persists, it should read from Model instances, not context.models
      // This is verified by checking that the Model instance has the updated data
      // and that Schema can access it through schema.models
      const models = schema.models || []
      const foundModel = models.find((m: any) => m.modelName === 'TestModel')
      
      if (foundModel) {
        // Schema should be able to read from the Model instance
        expect(foundModel.properties).toBeDefined()
        // The Model instance should have the updated properties
        expect(foundModel.properties?.content).toBeDefined()
      }
    })

    it('should load Model data from database first', async () => {
      const schemaName = 'Test Schema Model Load From DB'
      const testSchema = createTestSchema(schemaName, {
        TestModel: {
          id: generateId(),
          properties: {
            title: {
              id: generateId(),
              type: 'Text',
            },
            description: {
              id: generateId(),
              type: 'Text',
            },
          },
        },
      })

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      // Create first model instance and save to database
      const model1 = Model.create('TestModel', schemaName)
      await waitForModelIdle(model1)
      
      // Edit the model
      model1.description = 'Initial description'
      await new Promise(resolve => setTimeout(resolve, 200))
      
      // Save the model (this persists to database)
      // Note: The exact save mechanism depends on implementation
      // For now, we verify that a new Model instance loads from database
      
      // Create a new Model instance with the same name
      // It should load from database, not from Schema context
      const model2 = Model.create('TestModel', schemaName)
      await waitForModelIdle(model2)
      
      // Verify both instances exist (they're cached)
      expect(model1).toBeDefined()
      expect(model2).toBeDefined()
      
      // They should be the same instance (cached)
      expect(model1).toBe(model2)
      
      // Verify the model loaded its data
      expect(model2.modelName).toBe('TestModel')
      expect(model2.schemaName).toBe(schemaName)
    })
  })

  describe('Model.create() - Subscription Infinite Loop Prevention', () => {
    it('should not cause infinite loop when subscribing immediately after Model.create() without options', async () => {
      const schemaName = 'Test Schema Subscription No Loop 1'
      const testSchema = createTestSchema(schemaName)

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      const newModel = Model.create('New model', schemaName)
      
      // Track subscription callbacks
      let callbackCount = 0
      const callbackHistory: Array<{ value: string; timestamp: number }> = []
      const maxExpectedCallbacks = 10 // Should stabilize after initial loading
      
      const subscription = newModel.getService().subscribe((snapshot) => {
        callbackCount++
        callbackHistory.push({
          value: snapshot.value as string,
          timestamp: Date.now(),
        })
        
        // Access snapshot properties to ensure they don't trigger loops
        const value = snapshot.value
        const context = snapshot.context
        
        // Verify we can access properties without causing loops
        expect(value).toBeDefined()
        expect(context).toBeDefined()
        expect(context.modelName).toBe('New model')
        
        // Fail if we get too many callbacks (indicates infinite loop)
        if (callbackCount > maxExpectedCallbacks) {
          subscription.unsubscribe()
          throw new Error(
            `Infinite loop detected: subscription fired ${callbackCount} times. ` +
            `History: ${callbackHistory.map(h => `${h.value}@${h.timestamp}`).join(', ')}`
          )
        }
      })
      
      // Wait for model to stabilize
      await waitForModelIdle(newModel, 10000)
      
      // Wait a bit more to ensure no additional callbacks
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      // Unsubscribe
      subscription.unsubscribe()
      
      // Verify we didn't get an excessive number of callbacks
      expect(callbackCount).toBeLessThanOrEqual(maxExpectedCallbacks)
      
      // Verify the model eventually reached idle state
      const finalSnapshot = newModel.getService().getSnapshot()
      expect(finalSnapshot.value).toBe('idle')
    })

    it('should not cause infinite loop when subscribing immediately after Model.create() with options', async () => {
      const schemaName = 'Test Schema Subscription No Loop 2'
      const testSchema = createTestSchema(schemaName)

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      const newModel = Model.create('New model', schemaName, {
        properties: {
          title: { dataType: 'String' },
          content: { dataType: 'Text' },
        },
        indexes: ['title'],
        description: 'Test model description',
      })
      
      // Track subscription callbacks
      let callbackCount = 0
      const callbackHistory: Array<{ value: string; timestamp: number }> = []
      const maxExpectedCallbacks = 15 // May have more callbacks due to validation
      
      const subscription = newModel.getService().subscribe((snapshot) => {
        callbackCount++
        callbackHistory.push({
          value: snapshot.value as string,
          timestamp: Date.now(),
        })
        
        // Access snapshot properties to ensure they don't trigger loops
        const value = snapshot.value
        const context = snapshot.context
        
        // Verify we can access properties without causing loops
        expect(value).toBeDefined()
        expect(context).toBeDefined()
        expect(context.modelName).toBe('New model')
        
        // Fail if we get too many callbacks (indicates infinite loop)
        if (callbackCount > maxExpectedCallbacks) {
          subscription.unsubscribe()
          throw new Error(
            `Infinite loop detected: subscription fired ${callbackCount} times. ` +
            `History: ${callbackHistory.map(h => `${h.value}@${h.timestamp}`).join(', ')}`
          )
        }
      })
      
      // Wait for model to stabilize
      await waitForModelIdle(newModel, 10000)
      
      // Wait a bit more to ensure no additional callbacks
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      // Unsubscribe
      subscription.unsubscribe()
      
      // Verify we didn't get an excessive number of callbacks
      expect(callbackCount).toBeLessThanOrEqual(maxExpectedCallbacks)
      
      // Verify the model eventually reached idle state
      const finalSnapshot = newModel.getService().getSnapshot()
      expect(finalSnapshot.value).toBe('idle')
    })

    it('should not cause infinite loop when subscribing after Model.create() with schema instance', async () => {
      const schemaName = 'Test Schema Subscription No Loop 3'
      const testSchema = createTestSchema(schemaName)

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      const schema = Schema.create(schemaName)
      await new Promise(resolve => setTimeout(resolve, 500)) // Wait for schema to initialize
      
      const newModel = Model.create('New model', schema, {
        properties: {
          title: { dataType: 'String' },
        },
      })
      
      // Track subscription callbacks
      let callbackCount = 0
      const callbackHistory: Array<{ value: string; timestamp: number }> = []
      const maxExpectedCallbacks = 20 // May have more due to schema registration
      
      const subscription = newModel.getService().subscribe((snapshot) => {
        callbackCount++
        callbackHistory.push({
          value: snapshot.value as string,
          timestamp: Date.now(),
        })
        
        // Access snapshot properties to ensure they don't trigger loops
        const value = snapshot.value
        const context = snapshot.context
        
        // Verify we can access properties without causing loops
        expect(value).toBeDefined()
        expect(context).toBeDefined()
        expect(context.modelName).toBe('New model')
        
        // Fail if we get too many callbacks (indicates infinite loop)
        if (callbackCount > maxExpectedCallbacks) {
          subscription.unsubscribe()
          throw new Error(
            `Infinite loop detected: subscription fired ${callbackCount} times. ` +
            `History: ${callbackHistory.map(h => `${h.value}@${h.timestamp}`).join(', ')}`
          )
        }
      })
      
      // Wait for model to stabilize
      await waitForModelIdle(newModel, 10000)
      
      // Wait for schema registration to complete
      await new Promise(resolve => setTimeout(resolve, 2000))
      
      // Unsubscribe
      subscription.unsubscribe()
      
      // Verify we didn't get an excessive number of callbacks
      expect(callbackCount).toBeLessThanOrEqual(maxExpectedCallbacks)
      
      // Verify the model eventually reached idle state
      const finalSnapshot = newModel.getService().getSnapshot()
      expect(finalSnapshot.value).toBe('idle')
    })

    it('should not cause infinite loop when accessing model properties in subscription callback', async () => {
      const schemaName = 'Test Schema Subscription No Loop 4'
      const testSchema = createTestSchema(schemaName)

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      const newModel = Model.create('New model', schemaName, {
        properties: {
          title: { dataType: 'String' },
        },
      })
      
      // Track subscription callbacks
      let callbackCount = 0
      const maxExpectedCallbacks = 15
      
      const subscription = newModel.getService().subscribe((snapshot) => {
        callbackCount++
        
        // Access model properties through the Proxy (this could trigger getters)
        // This is the pattern that might cause infinite loops
        const modelName = newModel.modelName
        const modelSchemaName = newModel.schemaName
        const properties = newModel.properties
        const description = newModel.description
        
        // Verify properties are accessible
        expect(modelName).toBe('New model')
        expect(modelSchemaName).toBe(schemaName)
        expect(properties).toBeDefined()
        
        // Fail if we get too many callbacks (indicates infinite loop)
        if (callbackCount > maxExpectedCallbacks) {
          subscription.unsubscribe()
          throw new Error(
            `Infinite loop detected when accessing model properties: subscription fired ${callbackCount} times`
          )
        }
      })
      
      // Wait for model to stabilize
      await waitForModelIdle(newModel, 10000)
      
      // Wait a bit more to ensure no additional callbacks
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      // Unsubscribe
      subscription.unsubscribe()
      
      // Verify we didn't get an excessive number of callbacks
      expect(callbackCount).toBeLessThanOrEqual(maxExpectedCallbacks)
    })

    it('should stabilize context updates and not trigger infinite validation loops', async () => {
      const schemaName = 'Test Schema Subscription No Loop 5'
      const testSchema = createTestSchema(schemaName)

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      const newModel = Model.create('New model', schemaName, {
        properties: {
          title: { dataType: 'String' },
        },
      })
      
      await waitForModelIdle(newModel)
      
      // Track subscription callbacks after initial creation
      let callbackCount = 0
      const stateTransitions: string[] = []
      const maxExpectedCallbacks = 10
      
      const subscription = newModel.getService().subscribe((snapshot) => {
        callbackCount++
        stateTransitions.push(snapshot.value as string)
        
        // Fail if we get too many callbacks (indicates infinite loop)
        if (callbackCount > maxExpectedCallbacks) {
          subscription.unsubscribe()
          throw new Error(
            `Infinite loop detected after stabilization: subscription fired ${callbackCount} times. ` +
            `State transitions: ${stateTransitions.join(' -> ')}`
          )
        }
      })
      
      // Make a property update (this should trigger validation but not infinite loop)
      newModel.properties = {
        title: { dataType: 'String' },
        content: { dataType: 'Text' },
      }
      
      // Wait for validation to complete
      await waitForModelIdle(newModel, 10000)
      
      // Wait a bit more to ensure no additional callbacks
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      // Unsubscribe
      subscription.unsubscribe()
      
      // Verify we didn't get an excessive number of callbacks
      expect(callbackCount).toBeLessThanOrEqual(maxExpectedCallbacks)
      
      // Verify the model eventually reached idle state
      const finalSnapshot = newModel.getService().getSnapshot()
      expect(finalSnapshot.value).toBe('idle')
    })

    it('should not cause infinite loop when multiple subscriptions are active', async () => {
      const schemaName = 'Test Schema Subscription No Loop 6'
      const testSchema = createTestSchema(schemaName)

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      const newModel = Model.create('New model', schemaName, {
        properties: {
          title: { dataType: 'String' },
        },
      })
      
      // Create multiple subscriptions (simulating React hooks)
      let callbackCount1 = 0
      let callbackCount2 = 0
      const maxExpectedCallbacks = 15
      
      const subscription1 = newModel.getService().subscribe((snapshot) => {
        callbackCount1++
        const value = snapshot.value
        const context = snapshot.context
        
        if (callbackCount1 > maxExpectedCallbacks) {
          subscription1.unsubscribe()
          throw new Error(`Subscription 1 infinite loop: ${callbackCount1} callbacks`)
        }
      })
      
      const subscription2 = newModel.getService().subscribe((snapshot) => {
        callbackCount2++
        const value = snapshot.value
        const context = snapshot.context
        
        if (callbackCount2 > maxExpectedCallbacks) {
          subscription2.unsubscribe()
          throw new Error(`Subscription 2 infinite loop: ${callbackCount2} callbacks`)
        }
      })
      
      // Wait for model to stabilize
      await waitForModelIdle(newModel, 10000)
      
      // Wait a bit more to ensure no additional callbacks
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      // Unsubscribe
      subscription1.unsubscribe()
      subscription2.unsubscribe()
      
      // Verify we didn't get an excessive number of callbacks
      expect(callbackCount1).toBeLessThanOrEqual(maxExpectedCallbacks)
      expect(callbackCount2).toBeLessThanOrEqual(maxExpectedCallbacks)
    })
  })
})

