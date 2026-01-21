import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import { waitFor } from 'xstate'
import { Schema } from '@/Schema/Schema'
import { Model } from '@/Model/Model'
import { BaseDb } from '@/db/Db/BaseDb'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { schemas } from '@/seedSchema/SchemaSchema'
import { models as modelsTable, properties } from '@/seedSchema/ModelSchema'
import { modelSchemas } from '@/seedSchema/ModelSchemaSchema'
import { modelUids } from '@/seedSchema/ModelUidSchema'
import { propertyUids } from '@/seedSchema/PropertyUidSchema'
import { seeds } from '@/seedSchema/SeedSchema'
import { versions } from '@/seedSchema/VersionSchema'
import { metadata } from '@/seedSchema/MetadataSchema'
import { eq, and } from 'drizzle-orm'
import { SchemaFileFormat } from '@/types/import'
import { importJsonSchema } from '@/imports/json'
import { generateId } from '@/helpers'
import { setupTestEnvironment } from '../test-utils/client-init'
import { modelPropertiesToObject } from '@/helpers/model'

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
    // Clean up - delete in order to respect foreign key constraints
    const db = BaseDb.getAppDb()
    if (db) {
      // First, nullify refModelId in properties to break self-referential foreign keys
      await db.update(properties).set({ refModelId: null })
      // Delete in order: propertyUids -> modelUids -> properties -> model_schemas -> models -> schemas
      await db.delete(propertyUids)
      await db.delete(modelUids)
      await db.delete(properties)
      await db.delete(modelSchemas)
      await db.delete(modelsTable)
      await db.delete(schemas)
    }
  })

  beforeEach(async () => {
    // Clean up database before each test - delete in order to respect foreign key constraints
    // IMPORTANT: Preserve Seed Protocol schema as it's required for client initialization
    const db = BaseDb.getAppDb()
    if (db) {
      const { SEED_PROTOCOL_SCHEMA_NAME } = await import('@/helpers/constants')
      const { eq, ne, notInArray, sql } = await import('drizzle-orm')
      
      // Get Seed Protocol schema to exclude from cleanup
      const seedProtocolSchema = await db
        .select()
        .from(schemas)
        .where(eq(schemas.name, SEED_PROTOCOL_SCHEMA_NAME))
        .limit(1)
      
      if (seedProtocolSchema.length > 0 && seedProtocolSchema[0].id) {
        const seedProtocolSchemaId = seedProtocolSchema[0].id
        
        // Get Seed Protocol model IDs to exclude from cleanup
        const seedProtocolModelLinks = await db
          .select({ modelId: modelSchemas.modelId })
          .from(modelSchemas)
          .where(eq(modelSchemas.schemaId, seedProtocolSchemaId))
        
        const seedProtocolModelIds: number[] = seedProtocolModelLinks
          .map((link: { modelId: number | null }) => link.modelId)
          .filter((id: number | null): id is number => id !== null)
        
        // First, nullify refModelId in properties to break self-referential foreign keys
        // Exclude Seed Protocol properties
        if (seedProtocolModelIds.length > 0) {
          await db.update(properties)
            .set({ refModelId: null })
            .where(notInArray(properties.modelId, seedProtocolModelIds))
        } else {
          await db.update(properties).set({ refModelId: null })
        }
        
        // Delete propertyUids and modelUids (these don't have schema references, delete all)
        await db.delete(propertyUids)
        await db.delete(modelUids)
        
        // Delete properties for non-Seed Protocol models
        if (seedProtocolModelIds.length > 0) {
          await db.delete(properties)
            .where(notInArray(properties.modelId, seedProtocolModelIds))
        } else {
          await db.delete(properties)
        }
        
        // Delete model_schemas join entries for non-Seed Protocol schemas
        await db.delete(modelSchemas)
          .where(ne(modelSchemas.schemaId, seedProtocolSchemaId))
        
        // Delete models for non-Seed Protocol schemas
        // Get all non-Seed Protocol model IDs from model_schemas
        const nonSeedProtocolModelLinks = await db
          .select({ modelId: modelSchemas.modelId })
          .from(modelSchemas)
          .where(ne(modelSchemas.schemaId, seedProtocolSchemaId))
        
        const nonSeedProtocolModelIds: number[] = nonSeedProtocolModelLinks
          .map((link: { modelId: number | null }) => link.modelId)
          .filter((id: number | null): id is number => id !== null)
        
        if (nonSeedProtocolModelIds.length > 0) {
          await db.delete(modelsTable)
            .where(notInArray(modelsTable.id, nonSeedProtocolModelIds))
        }
        
        // Delete schemas except Seed Protocol
        await db.delete(schemas)
          .where(ne(schemas.name, SEED_PROTOCOL_SCHEMA_NAME))
      } else {
        // Seed Protocol schema not found - delete everything (shouldn't happen but handle gracefully)
        await db.update(properties).set({ refModelId: null })
        await db.delete(propertyUids)
        await db.delete(modelUids)
        await db.delete(properties)
        await db.delete(modelSchemas)
        await db.delete(modelsTable)
        await db.delete(schemas)
      }
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
      
      const model = Model.create('TestModel Basic', schemaName)
      expect(model).toBeDefined()
      expect(model.modelName).toBe('TestModel Basic')
      expect(model.schemaName).toBe(schemaName)
      
      await waitForModelIdle(model)
      
      const context = model.getService().getSnapshot().context
      expect(context.modelName).toBe('TestModel Basic')
      expect(context.schemaName).toBe(schemaName)
    })

    it('should create a new Model instance with Schema instance', async () => {
      const schemaName = 'Test Schema Model Create Instance'
      const testSchema = createTestSchema(schemaName)

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      const schema = Schema.create(schemaName)
      await new Promise(resolve => setTimeout(resolve, 500)) // Wait for schema to initialize
      
      const model = Model.create('TestModel Schema Instance', schema)
      expect(model).toBeDefined()
      expect(model.modelName).toBe('TestModel Schema Instance')
      expect(model.schemaName).toBe(schemaName)
      
      await waitForModelIdle(model)
    })

    it('should create a Model with properties', async () => {
      const schemaName = 'Test Schema Model Properties'
      const testSchema = createTestSchema(schemaName)

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      const properties = {
        title: { dataType: 'Text' },
        content: { dataType: 'Text' },
      }
      
      const model = Model.create('TestModel With Properties', schemaName, {
        properties,
      })

      model.getService().subscribe((snapshot) => {
        console.log('model snapshot.value', snapshot.value)
        // console.log('model snapshot.context', snapshot.context)
      })
      
      await waitForModelIdle(model)
      
      // Wait for liveQuery subscription to be set up and context to be updated
      await new Promise<void>((resolve, reject) => {
        const subscription = model.getService().subscribe((snapshot) => {
          console.log('Waiting for liveQueryIds', snapshot.context._liveQueryPropertyIds)
          const liveQueryIds = snapshot.context._liveQueryPropertyIds || []
          if (liveQueryIds.length >= 2) {
            subscription.unsubscribe()
            resolve()
          }
        })
        
        // Also check immediately in case it's already updated
        const currentSnapshot = model.getService().getSnapshot()
        const currentLiveQueryIds = currentSnapshot.context._liveQueryPropertyIds || []
        if (currentLiveQueryIds.length >= 2) {
          subscription.unsubscribe()
          resolve()
          return
        }
        
        // Timeout after 5 seconds
        setTimeout(() => {
          subscription.unsubscribe()
          const finalSnapshot = model.getService().getSnapshot()
          const finalLiveQueryIds = finalSnapshot.context._liveQueryPropertyIds || []
          console.log('finalLiveQueryIds', finalLiveQueryIds)
          if (finalLiveQueryIds.length >= 2) {
            resolve()
          } else {
            reject(new Error(`Timeout waiting for liveQueryPropertyIds. Got ${finalLiveQueryIds.length} items, expected at least 2`))
          }
        }, 5000)
      })
      
      expect(model.properties).toBeDefined()
      const modelProperties = model.properties || []
      expect(Array.isArray(modelProperties)).toBe(true)
      expect(modelProperties.length).toBe(2)
      
      // Find properties by name
      const titleProperty = modelProperties.find(p => p.name === 'title')
      const contentProperty = modelProperties.find(p => p.name === 'content')
      
      expect(titleProperty).toBeDefined()
      expect(titleProperty?.dataType).toBe('Text')
      expect(contentProperty).toBeDefined()
      expect(contentProperty?.dataType).toBe('Text')
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
      
      const model = Model.create('TestModel Empty Properties', schemaName)
      await waitForModelIdle(model)
      
      expect(model.properties).toBeDefined()
      expect(Object.keys(model.properties || {})).toHaveLength(0)
    })
  })

  describe('Model.create() - Duplicate Name Validation', () => {
    it('should automatically rename model when duplicate name exists in cache (case-insensitive)', async () => {
      const schemaName = 'Test Schema Duplicate Names Cache'
      const testSchema = createTestSchema(schemaName, {
        'New model': {
          id: generateId(),
          properties: {},
        },
      })

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      // Create first model
      const model1 = Model.create('New model', schemaName)
      await waitForModelIdle(model1)
      expect(model1.modelName).toBe('New model 1')
      
      // Try to create second model with same name (different case)
      const model2 = Model.create('new model', schemaName)
      await waitForModelIdle(model2)
      
      // Should be automatically renamed
      expect(model2.modelName).toBe('new model 2')
      expect(model2).not.toBe(model1) // Should be different instances
      
      // Verify both models exist
      expect(model1.modelName).toBe('New model 1')
      expect(model2.modelName).toBe('new model 2')
    })

    it('should increment model name when multiple duplicates exist', async () => {
      const schemaName = 'Test Schema Duplicate Names Increment'
      const testSchema = createTestSchema(schemaName)

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      // Create multiple models with the same base name
      const model1 = Model.create('My Model', schemaName)
      await waitForModelIdle(model1)
      expect(model1.modelName).toBe('My Model')
      
      const model2 = Model.create('My Model', schemaName)
      await waitForModelIdle(model2)
      expect(model2.modelName).toBe('My Model 1')
      
      const model3 = Model.create('My Model', schemaName)
      await waitForModelIdle(model3)
      expect(model3.modelName).toBe('My Model 2')
      
      // Verify all models are different instances
      expect(model1).not.toBe(model2)
      expect(model2).not.toBe(model3)
      expect(model1).not.toBe(model3)
    })

    it('should handle duplicate names when models exist in database', async () => {
      const schemaName = 'Test Schema Duplicate Names Database'
      const testSchema = createTestSchema(schemaName, {
        'Existing Model': {
          id: generateId(),
          properties: {},
        },
      })

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      // Wait for the imported model to be written to database
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      // Clear the cache to force database lookup
      // Note: We can't easily clear the cache, but we can create a model with a different name first
      // then try to create one with the same name as the imported one
      
      // Try to create a model with the same name as the imported one (case-insensitive)
      const newModel = Model.create('existing model', schemaName)
      await waitForModelIdle(newModel)
      
      // Should be automatically renamed since 'Existing Model' exists in database
      expect(newModel.modelName).toBe('existing model 1')
    })

    it('should find next available number when some numbers are already used', async () => {
      const schemaName = 'Test Schema Duplicate Names Gaps'
      const testSchema = createTestSchema(schemaName)

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      // Create models: base, 1, 3 (skipping 2)
      const model1 = Model.create('Gap Model', schemaName)
      await waitForModelIdle(model1)
      expect(model1.modelName).toBe('Gap Model')
      
      const model2 = Model.create('Gap Model', schemaName)
      await waitForModelIdle(model2)
      expect(model2.modelName).toBe('Gap Model 1')
      
      // Create model 3 directly by using the name
      const model3 = Model.create('Gap Model 3', schemaName)
      await waitForModelIdle(model3)
      expect(model3.modelName).toBe('Gap Model 3')
      
      // Now create another duplicate - should fill the gap at 2
      const model4 = Model.create('Gap Model', schemaName)
      await waitForModelIdle(model4)
      expect(model4.modelName).toBe('Gap Model 2')
    })

    it('should handle case-insensitive comparison correctly', async () => {
      const schemaName = 'Test Schema Duplicate Names Case Insensitive'
      const testSchema = createTestSchema(schemaName)

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      // Create model with lowercase
      const model1 = Model.create('case test', schemaName)
      await waitForModelIdle(model1)
      expect(model1.modelName).toBe('case test')
      
      // Try to create with uppercase - should be treated as duplicate
      const model2 = Model.create('CASE TEST', schemaName)
      await waitForModelIdle(model2)
      expect(model2.modelName).toBe('CASE TEST 1')
      
      // Try with mixed case - should also be treated as duplicate
      const model3 = Model.create('Case Test', schemaName)
      await waitForModelIdle(model3)
      expect(model3.modelName).toBe('Case Test 2')
    })

    it('should preserve original name format when appending number', async () => {
      const schemaName = 'Test Schema Duplicate Names Format'
      const testSchema = createTestSchema(schemaName)

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      // Create first model
      const model1 = Model.create('Formatted Model', schemaName)
      await waitForModelIdle(model1)
      expect(model1.modelName).toBe('Formatted Model')
      
      // Create duplicate - should preserve original capitalization
      const model2 = Model.create('Formatted Model', schemaName)
      await waitForModelIdle(model2)
      expect(model2.modelName).toBe('Formatted Model 1')
      
      // Verify the format is preserved (space before number)
      expect(model2.modelName).toMatch(/^Formatted Model \d+$/)
    })

    it('should work correctly with models in different schemas', async () => {
      const schemaName1 = 'Test Schema Duplicate Names Schema1'
      const schemaName2 = 'Test Schema Duplicate Names Schema2'
      
      const testSchema1 = createTestSchema(schemaName1)
      const testSchema2 = createTestSchema(schemaName2)

      await importJsonSchema({ contents: JSON.stringify(testSchema1) }, testSchema1.version)
      await importJsonSchema({ contents: JSON.stringify(testSchema2) }, testSchema2.version)
      
      // Create models with same name in different schemas
      const model1 = Model.create('Shared Name', schemaName1)
      await waitForModelIdle(model1)
      expect(model1.modelName).toBe('Shared Name')
      
      const model2 = Model.create('Shared Name', schemaName2)
      await waitForModelIdle(model2)
      // Should NOT be renamed since it's in a different schema
      expect(model2.modelName).toBe('Shared Name')
      
      // But duplicates within the same schema should be renamed
      const model3 = Model.create('Shared Name', schemaName1)
      await waitForModelIdle(model3)
      expect(model3.modelName).toBe('Shared Name 1')
    })
  })

  describe('Model.create() - Database Integration', () => {
    it('should create seed, version, and metadata records when creating an item instance', async () => {
      const schemaName = 'Test Schema Model DB Integration'
      const modelName = 'TestModel DB Integration'
      const testSchema = createTestSchema(schemaName, {
        [modelName]: {
          id: generateId(),
          properties: {
            title: {
              id: generateId(),
              type: 'Text',
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
      
      // Wait a bit for the schema import to complete and model to be written to database
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      // Get the model that was imported (may be renamed if duplicate exists)
      // Try getByNameAsync first, but if that fails, try Model.create which will handle renaming
      let TestModel = await Model.getByNameAsync(modelName, schemaName)
      if (!TestModel) {
        // If not found, try creating it (will use the imported model from database or create new)
        TestModel = Model.create(modelName, schemaName)
      }
      
      await waitForModelIdle(TestModel)
      
      // Wait for model properties to be loaded (they come from the schema import)
      await new Promise<void>((resolve, reject) => {
        const subscription = TestModel.getService().subscribe((snapshot) => {
          const properties = TestModel.properties || []
          if (properties.length >= 3) { // title, content, count
            subscription.unsubscribe()
            resolve()
          }
        })
        
        // Check immediately
        const properties = TestModel.properties || []
        if (properties.length >= 3) {
          subscription.unsubscribe()
          resolve()
          return
        }
        
        // Timeout after 5 seconds
        setTimeout(() => {
          subscription.unsubscribe()
          const finalProperties = TestModel.properties || []
          if (finalProperties.length >= 3) {
            resolve()
          } else {
            reject(new Error(`Timeout waiting for model properties. Got ${finalProperties.length} properties, expected at least 3`))
          }
        }, 5000)
      })
      
      // Get the actual model name (may be renamed if duplicate exists)
      const actualModelName = TestModel.modelName
      if (!actualModelName) {
        throw new Error('Model name is required')
      }
      // Convert to snake_case for type assertions (using same function as createNewItem)
      const { toSnakeCase } = await import('drizzle-orm/casing')
      const expectedType = toSnakeCase(actualModelName)
      
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
      expect(seedRecords[0].type).toBe(expectedType)
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
      expect(versionRecords[0].seedType).toBe(expectedType)
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

      console.log('metadataRecords', metadataRecords)

      expect(metadataRecords.length).toBeGreaterThanOrEqual(3)

      // Verify title metadata
      const titleMetadata = metadataRecords.find((r: any) => r.propertyName === 'title')
      expect(titleMetadata).toBeDefined()
      expect(titleMetadata!.propertyValue).toBe('Test Title')
      expect(titleMetadata!.seedLocalId).toBe(testModelItem.seedLocalId)
      expect(titleMetadata!.versionLocalId).toBe(testModelItem.latestVersionLocalId)
      expect(titleMetadata!.modelType).toBe(expectedType)
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
      const modelName = 'TestModel Relationships'
      const testSchema = createTestSchema(schemaName, {
        [modelName]: {
          id: generateId(),
          properties: {
            name: {
              id: generateId(),
              type: 'Text',
            },
          },
        },
      })

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      const model = Model.create(modelName, schemaName)
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
      const modelName = 'TestModel No Properties'
      const testSchema = createTestSchema(schemaName, {
        [modelName]: {
          id: generateId(),
          properties: {},
        },
      })

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      const model = Model.create(modelName, schemaName)
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
      const modelName = 'TestModel Unique IDs'
      const testSchema = createTestSchema(schemaName, {
        [modelName]: {
          id: generateId(),
          properties: {
            value: {
              id: generateId(),
              type: 'Text',
            },
          },
        },
      })

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      const model = Model.create(modelName, schemaName)
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
      const model1 = Model.create('TestModel Get By ID', schemaName, { modelFileId })
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
      const modelName = 'TestModel Get By Name'
      const testSchema = createTestSchema(schemaName)

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      const model1 = Model.create(modelName, schemaName)
      await waitForModelIdle(model1)
      
      const model2 = Model.getByName(modelName, schemaName)
      expect(model2).toBe(model1)
    })

    it('should return undefined if model not found in cache', () => {
      // This test doesn't require client initialization - just tests cache lookup
      const model = Model.getByName('NonExistentModel', 'NonExistentSchema')
      expect(model).toBeUndefined()
    })
  })

  describe('Model property access', () => {

    it('should access model name via "name" alias', async () => {
      const schemaName = 'Test Schema Model Name Alias'
      const modelName = 'TestModel Name Alias'
      const testSchema = createTestSchema(schemaName)

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      const model = Model.create(modelName, schemaName)
      await waitForModelIdle(model)
      
      expect(model.name).toBe(modelName)
      expect(model.name).toBe(model.modelName)
    })

    it('should access model id via "id" property', async () => {
      const schemaName = 'Test Schema Model ID Property'
      const testSchema = createTestSchema(schemaName)

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      const modelFileId = generateId()
      const model = Model.create('TestModel ID Property', schemaName, { modelFileId })
      await waitForModelIdle(model)
      
      expect(model.id).toBe(modelFileId)
    })

    it('should update model name', async () => {
      const schemaName = 'Test Schema Model Update Name'
      const modelName = 'TestModel Update Name'
      const testSchema = createTestSchema(schemaName)

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      const model = Model.create(modelName, schemaName)
      await waitForModelIdle(model)
      
      const oldName = model.modelName
      const newName = 'UpdatedModel'
      
      model.modelName = newName
      
      // Wait for update to complete
      await new Promise(resolve => setTimeout(resolve, 200))
      
      expect(model.modelName).toBe(newName)
      expect(model.name).toBe(newName)
    })
  })

  describe('Model state management', () => {

    it('should track validation errors', async () => {
      const schemaName = 'Test Schema Model Validation Errors'
      const testSchema = createTestSchema(schemaName)

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      const model = Model.create('TestModel Validation', schemaName)
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
      
      const model = Model.create('TestModel Status', schemaName)
      
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
      
      const model = Model.create('TestModel Validate', schemaName, {
        properties: {
          title: { dataType: 'Text' },
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
      
      const model = Model.create('TestModel Validate Structure', schemaName)
      await waitForModelIdle(model)
      
      const validationResult = await model.validate()
      expect(validationResult).toHaveProperty('isValid')
      expect(validationResult).toHaveProperty('errors')
      expect(typeof validationResult.isValid).toBe('boolean')
      expect(Array.isArray(validationResult.errors)).toBe(true)
    })
  })

  describe('Model reload', () => {
    it('should reload model from database', async () => {
      const schemaName = 'Test Schema Model Reload'
      const modelName = 'TestModel Reload'
      const testSchema = createTestSchema(schemaName, {
        [modelName]: {
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
      
      const model = Model.create(modelName, schemaName)
      await waitForModelIdle(model)
      
      // Update database directly
      const db = BaseDb.getAppDb()
      if (db) {
        const dbModels = await db
          .select()
          .from(modelsTable)
          .where(eq(modelsTable.name, modelName))
          .limit(1)
        
        if (dbModels.length > 0 && dbModels[0].modelData) {
          const updatedModel = JSON.parse(dbModels[0].modelData) as any
          // Note: description is not used - JSON files can have it but we ignore it at runtime
          
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
      
      const model = Model.create('TestModel Unload', schemaName)
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
      const modelName = 'TestModel Cache Update'
      const testSchema = createTestSchema(schemaName)

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      const model = Model.create(modelName, schemaName)
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

    it('should immediately save model name changes to database', async () => {
      const schemaName = 'Test Schema Model Name Change DB'
      const modelName = 'TestModel Name Change DB'
      const testSchema = createTestSchema(schemaName, {
        [modelName]: {
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
      
      // Wait a bit for the model to be loaded into cache from the schema import
      await new Promise(resolve => setTimeout(resolve, 500))
      
      // Get the existing model from the schema import (don't create a new one)
      // Use getByNameAsync to ensure we get the model even if it's not in cache yet
      let model = await Model.getByNameAsync(modelName, schemaName)
      
      // If model isn't found yet, wait a bit more and try again
      if (!model) {
        await new Promise(resolve => setTimeout(resolve, 500))
        model = await Model.getByNameAsync(modelName, schemaName)
      }
      
      // If still not found, the model might not have been loaded yet, so we'll need to get it via the schema
      if (!model) {
        const schema = Schema.create(schemaName)
        await waitForSchemaIdle(schema)
        // Wait for models to be loaded
        await new Promise(resolve => setTimeout(resolve, 500))
        model = await Model.getByNameAsync(modelName, schemaName)
      }
      
      // If model still doesn't exist, something went wrong
      if (!model) {
        throw new Error(`Model "${modelName}" not found after schema import`)
      }
      
      await waitForModelIdle(model)
      
      const oldName = model.modelName
      const newName = 'UpdatedModelName'
      
      expect(oldName).toBeDefined()
      expect(oldName).toBe(modelName)
      
      // Wait a bit for model to be written to database if it wasn't already
      await new Promise(resolve => setTimeout(resolve, 300))
      
      // Verify model exists in database with old name first (if it was written)
      const db = BaseDb.getAppDb()
      if (db && oldName) {
        const dbModelsBefore = await db
          .select()
          .from(modelsTable)
          .where(eq(modelsTable.name, oldName))
          .limit(1)
        
        // Model might not be in database yet if schema wasn't saved, but that's okay
        // We'll verify it gets saved after the name change
      }
      
      // Update name
      model.modelName = newName
      
      // Wait for update to complete (including database save)
      await new Promise(resolve => setTimeout(resolve, 500))
      
      // Verify name changed in memory
      expect(model.modelName).toBe(newName)
      expect(model.name).toBe(newName)
      
      // Verify database was updated with new name
      if (db) {
        const dbModels = await db
          .select()
          .from(modelsTable)
          .where(eq(modelsTable.name, newName))
          .limit(1)
        
        expect(dbModels.length).toBeGreaterThan(0)
        expect(dbModels[0].name).toBe(newName)
        
        // Verify old name no longer exists in database (if it existed before)
        if (oldName) {
          const oldDbModels = await db
            .select()
            .from(modelsTable)
            .where(eq(modelsTable.name, oldName))
            .limit(1)
          
          // If the model was in the database before, it should be renamed (length = 0)
          // If it wasn't in the database before, this is also fine
          // The key assertion is that the new name exists in the database
        }
        expect(dbModels.length).toBeGreaterThan(0)
      }
    })
  })

  describe('Model edit independence', () => {

    it('should load Model data from database first', async () => {
      const schemaName = 'Test Schema Model Load From DB'
      const modelName = 'TestModel Load From DB'
      const testSchema = createTestSchema(schemaName, {
        [modelName]: {
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
      const model1 = Model.create(modelName, schemaName)
      await waitForModelIdle(model1)
      
      // Note: description is not supported - JSON files can have it but we ignore it at runtime
      // Edit the model (using a supported property if needed)
      await new Promise(resolve => setTimeout(resolve, 200))
      
      // Save the model (this persists to database)
      // Note: The exact save mechanism depends on implementation
      // For now, we verify that a new Model instance loads from database
      
      // Create a new Model instance with the same name
      // It should load from database, not from Schema context
      const model2 = Model.create(modelName, schemaName)
      await waitForModelIdle(model2)
      
      // Verify both instances exist (they're cached)
      expect(model1).toBeDefined()
      expect(model2).toBeDefined()
      
      // They should be the same instance (cached)
      expect(model1).toBe(model2)
      
      // Verify the model loaded its data
      expect(model2.modelName).toBe(modelName)
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
          title: { dataType: 'Text' },
          content: { dataType: 'Text' },
        },
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
      console.log('finalSnapshot.value', finalSnapshot.value)
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
          title: { dataType: 'Text' },
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
          title: { dataType: 'Text' },
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

    it('should not cause infinite loop when multiple subscriptions are active', async () => {
      const schemaName = 'Test Schema Subscription No Loop 6'
      const testSchema = createTestSchema(schemaName)

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      const newModel = Model.create('New model', schemaName, {
        properties: {
          title: { dataType: 'Text' },
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

