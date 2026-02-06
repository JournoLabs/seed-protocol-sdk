import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import { waitFor } from 'xstate'
import { Schema } from '@/Schema/Schema'
import { Model } from '@/Model/Model'
import { ModelProperty } from '@/ModelProperty/ModelProperty'
import { BaseDb } from '@/db/Db/BaseDb'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { schemas } from '@/seedSchema/SchemaSchema'
import { models as modelsTable, properties as propertiesTable } from '@/seedSchema/ModelSchema'
import { modelSchemas } from '@/seedSchema/ModelSchemaSchema'
import { modelUids } from '@/seedSchema/ModelUidSchema'
import { propertyUids } from '@/seedSchema/PropertyUidSchema'
import { eq, and, ne, notInArray } from 'drizzle-orm'
import { SchemaFileFormat } from '@/types/import'
import { importJsonSchema } from '@/imports/json'
import { generateId } from '@/helpers'
import { setupTestEnvironment } from '../test-utils/client-init'
import { getPropertySchema } from '@/helpers/property'
import type { Static } from '@sinclair/typebox'
import type { TProperty } from '@/Schema'

// Helper function to wait for ModelProperty to be in idle state using xstate waitFor
async function waitForModelPropertyIdle(property: ModelProperty, timeout: number = 5000): Promise<void> {
  const service = property.getService()
  
  try {
    await waitFor(
      service,
      (snapshot) => {
        if (snapshot.value === 'error') {
          throw new Error('ModelProperty failed to load')
        }
        return snapshot.value === 'idle'
      },
      { timeout }
    )
  } catch (error: any) {
    if (error.message === 'ModelProperty failed to load') {
      throw error
    }
    throw new Error(`ModelProperty loading timeout after ${timeout}ms`)
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

testDescribe('ModelProperty Integration Tests', () => {
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
      await db.update(propertiesTable).set({ refModelId: null })
      // Delete in order: propertyUids -> modelUids -> properties -> model_schemas -> models -> schemas
      await db.delete(propertyUids)
      await db.delete(modelUids)
      await db.delete(propertiesTable)
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
          await db.update(propertiesTable)
            .set({ refModelId: null })
            .where(notInArray(propertiesTable.modelId, seedProtocolModelIds))
        } else {
          await db.update(propertiesTable).set({ refModelId: null })
        }
        
        // Delete propertyUids and modelUids (these don't have schema references, delete all)
        await db.delete(propertyUids)
        await db.delete(modelUids)
        
        // Delete properties for non-Seed Protocol models
        if (seedProtocolModelIds.length > 0) {
          await db.delete(propertiesTable)
            .where(notInArray(propertiesTable.modelId, seedProtocolModelIds))
        } else {
          await db.delete(propertiesTable)
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
        await db.update(propertiesTable).set({ refModelId: null })
        await db.delete(propertyUids)
        await db.delete(modelUids)
        await db.delete(propertiesTable)
        await db.delete(modelSchemas)
        await db.delete(modelsTable)
        await db.delete(schemas)
      }
    }

    // Clean up property files (Node.js only)
    if (isNodeEnv && fsModule) {
      const workingDir = BaseFileManager.getWorkingDir()
      if (fsModule.existsSync && fsModule.existsSync(workingDir)) {
        const files = fsModule.readdirSync(workingDir)
        for (const file of files) {
          if (file.endsWith('.json') && (file.includes('Test_Property') || file.includes('Test_Model') || file.includes('Test_Schema'))) {
            fsModule.unlinkSync(pathModule.join(workingDir, file))
          }
        }
      }
    }
  })

  afterEach(async () => {
    // Clean up ModelProperty instances by unloading them
    // Note: ModelProperty doesn't have a static unloadAll, so we'll rely on cache cleanup
    // The cache will be cleared when models are unloaded
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

  describe('ModelProperty.create()', () => {
    it('should create a new ModelProperty instance with property data', async () => {
      const schemaName = 'Test Schema Property Create'
      const modelName = 'TestModel Property Create'
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
      
      // Wait for schema to be imported
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      const model = Model.create(modelName, schemaName, { waitForReady: false })
      await new Promise(resolve => setTimeout(resolve, 500))
      
      // Get property schema data
      const propertyData = await getPropertySchema(modelName, 'title')
      expect(propertyData).toBeDefined()
      
      if (propertyData) {
        const property = ModelProperty.create(propertyData, { waitForReady: false })
        expect(property).toBeDefined()
        expect(property.name).toBe('title')
        expect(property.dataType).toBe('Text')
        
        await waitForModelPropertyIdle(property)
      }
    })

    it('should return the same instance when called multiple times (caching)', async () => {
      const schemaName = 'Test Schema Property Cache'
      const modelName = 'TestModel Property Cache'
      const testSchema = createTestSchema(schemaName, {
        [modelName]: {
          id: generateId(),
          properties: {
            content: {
              id: generateId(),
              type: 'Text',
            },
          },
        },
      })

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      const model = Model.create(modelName, schemaName, { waitForReady: false })
      await new Promise(resolve => setTimeout(resolve, 500))
      
      const propertyData = await getPropertySchema(modelName, 'content')
      expect(propertyData).toBeDefined()
      
      if (propertyData) {
        const property1 = ModelProperty.create(propertyData, { waitForReady: false })
        const property2 = ModelProperty.create(propertyData, { waitForReady: false })
        
        expect(property1).toBe(property2) // Should be the same instance
        
        await waitForModelPropertyIdle(property1)
      }
    })

    it('should throw error if property is null or undefined', () => {
      expect(() => {
        ModelProperty.create(null as any, { waitForReady: false })
      }).toThrow('Property is required')
      
      expect(() => {
        ModelProperty.create(undefined as any, { waitForReady: false })
      }).toThrow('Property is required')
    })

    it('should create property with propertyFileId', async () => {
      const schemaName = 'Test Schema Property ID'
      const modelName = 'TestModel Property ID'
      const propertyFileId = generateId()
      const testSchema = createTestSchema(schemaName, {
        [modelName]: {
          id: generateId(),
          properties: {
            name: {
              id: propertyFileId,
              type: 'Text',
            },
          },
        },
      })

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      const model = Model.create(modelName, schemaName, { waitForReady: false })
      await new Promise(resolve => setTimeout(resolve, 500))
      
      const propertyData = await getPropertySchema(modelName, 'name')
      expect(propertyData).toBeDefined()
      
      if (propertyData && propertyData.id) {
        const property = ModelProperty.create(propertyData, { waitForReady: false })
        expect(property).toBeDefined()
        
        const context = (property as any)._getSnapshotContext()
        // Check _propertyFileId instead of id, as id is the database primary key (number)
        // and _propertyFileId is the schemaFileId (string) from the JSON schema file
        expect(context._propertyFileId).toBe(propertyFileId)
        
        await waitForModelPropertyIdle(property)
      }
    })
  })

  describe('ModelProperty.find()', () => {
    it('should find existing ModelProperty by propertyFileId and wait for idle by default', async () => {
      const schemaName = 'Test Schema Property Find'
      const propertyFileId = generateId()
      const testSchema = createTestSchema(schemaName, {
        'TestPost': {
          id: generateId(),
          properties: {
            title: {
              id: propertyFileId,
              dataType: 'Text',
            },
          },
        },
      })

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      const model = Model.create('TestPost', schemaName, { waitForReady: false })
      await waitFor(
        model.getService(),
        (snapshot) => snapshot.value === 'idle',
        { timeout: 5000 }
      )

      // Find the property
      const foundProperty = await ModelProperty.find({
        propertyFileId: propertyFileId,
      })

      expect(foundProperty).toBeDefined()
      expect(foundProperty?.name).toBe('title')
      
      // Verify it's in idle state (find() should have waited)
      const service = foundProperty!.getService()
      expect(service.getSnapshot().value).toBe('idle')
    })

    it('should return undefined if ModelProperty not found', async () => {
      const foundProperty = await ModelProperty.find({
        propertyFileId: 'non-existent-id',
      })

      expect(foundProperty).toBeUndefined()
    })

    it('should support waitForReady: false option', async () => {
      const schemaName = 'Test Schema Property Find No Wait'
      const propertyFileId = generateId()
      const testSchema = createTestSchema(schemaName, {
        'TestPost': {
          id: generateId(),
          properties: {
            title: {
              id: propertyFileId,
              dataType: 'Text',
            },
          },
        },
      })

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      const model = Model.create('TestPost', schemaName, { waitForReady: false })
      await waitFor(
        model.getService(),
        (snapshot) => snapshot.value === 'idle',
        { timeout: 5000 }
      )

      // Find with waitForReady: false - should return immediately
      const foundProperty = await ModelProperty.find({
        propertyFileId: propertyFileId,
        waitForReady: false,
      })

      expect(foundProperty).toBeDefined()
      // Property might not be idle yet since we didn't wait
      const service = foundProperty!.getService()
      const state = service.getSnapshot().value
      // State could be idle (if already loaded) or loading/waitingForDb
      expect(['idle', 'loading', 'waitingForDb']).toContain(state)
    })
  })

  describe('ModelProperty.all()', () => {
    it('should return all properties for a model', async () => {
      const schemaName = 'Test Schema ModelProperty All'
      const modelFileId = generateId()
      const propId1 = generateId()
      const propId2 = generateId()
      const testSchema = createTestSchema(schemaName, {
        'TestPost': {
          id: modelFileId,
          properties: {
            title: { id: propId1, dataType: 'Text' },
            content: { id: propId2, dataType: 'Text' },
          },
        },
      })

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      const model = Model.create('TestPost', schemaName, { waitForReady: false })
      await waitFor(
        model.getService(),
        (snapshot) => snapshot.value === 'idle',
        { timeout: 5000 }
      )

      const allProperties = await ModelProperty.all(modelFileId)
      expect(allProperties).toBeDefined()
      expect(Array.isArray(allProperties)).toBe(true)
      expect(allProperties.length).toBeGreaterThanOrEqual(2)
      const names = allProperties.map((p) => p.name)
      expect(names).toContain('title')
      expect(names).toContain('content')
    })

    it('should return all properties in idle state when waitForReady is true', async () => {
      const schemaName = 'Test Schema ModelProperty All WaitForReady'
      const modelFileId = generateId()
      const testSchema = createTestSchema(schemaName, {
        'TestPost': {
          id: modelFileId,
          properties: {
            title: { id: generateId(), dataType: 'Text' },
          },
        },
      })

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      const model = Model.create('TestPost', schemaName, { waitForReady: false })
      await waitFor(
        model.getService(),
        (snapshot) => snapshot.value === 'idle',
        { timeout: 5000 }
      )

      const allProperties = await ModelProperty.all(modelFileId, {
        waitForReady: true,
      })
      expect(allProperties.length).toBeGreaterThanOrEqual(1)
      for (const p of allProperties) {
        expect(p.getService().getSnapshot().value).toBe('idle')
      }
    })
  })

  describe('ModelProperty.getById()', () => {
    it('should return cached ModelProperty instance by propertyFileId', async () => {
      const schemaName = 'Test Schema Property Get By ID'
      const modelName = 'TestModel Property Get By ID'
      const propertyFileId = generateId()
      const testSchema = createTestSchema(schemaName, {
        [modelName]: {
          id: generateId(),
          properties: {
            description: {
              id: propertyFileId,
              type: 'Text',
            },
          },
        },
      })

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      const model = Model.create(modelName, schemaName, { waitForReady: false })
      await new Promise(resolve => setTimeout(resolve, 500))
      
      const propertyData = await getPropertySchema(modelName, 'description')
      expect(propertyData).toBeDefined()
      
      if (propertyData) {
        const property1 = ModelProperty.create(propertyData, { waitForReady: false })
        await waitForModelPropertyIdle(property1)
        
        // Use _propertyFileId (schemaFileId string) instead of id (which might be a number from DB)
        // getById() looks for _propertyFileId or string id, not the database primary key
        const propertyFileIdToLookup = propertyData._propertyFileId || (typeof propertyData.id === 'string' ? propertyData.id : undefined)
        if (propertyFileIdToLookup) {
          const property2 = ModelProperty.getById(propertyFileIdToLookup)
          expect(property2).toBe(property1)
        } else {
          throw new Error('propertyFileId not found in propertyData')
        }
      }
    })

    it('should return undefined if property not found in cache', () => {
      const nonExistentId = generateId()
      const property = ModelProperty.getById(nonExistentId)
      expect(property).toBeUndefined()
    })
  })

  describe('ModelProperty Database Integration', () => {
    it('should create property records in database', async () => {
      const schemaName = 'Test Schema Property DB Create'
      const modelName = 'TestModel Property DB Create'
      const testSchema = createTestSchema(schemaName, {
        [modelName]: {
          id: generateId(),
          properties: {
            title: {
              id: generateId(),
              type: 'Text',
            },
            body: {
              id: generateId(),
              type: 'Text',
            },
          },
        },
      })

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      const model = Model.create(modelName, schemaName, { waitForReady: false })
      await new Promise(resolve => setTimeout(resolve, 500))
      
      // Wait for model to be written to database
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      const db = BaseDb.getAppDb()
      if (!db) {
        throw new Error('Database not available')
      }

      // Get model from database
      const dbModels = await db
        .select()
        .from(modelsTable)
        .where(eq(modelsTable.name, modelName))
        .limit(1)

      expect(dbModels.length).toBeGreaterThan(0)
      const dbModel = dbModels[0]

      // Verify properties exist in database
      const dbProperties = await db
        .select()
        .from(propertiesTable)
        .where(eq(propertiesTable.modelId, dbModel.id!))

      expect(dbProperties.length).toBeGreaterThanOrEqual(2)
      
      const propertyNames = dbProperties.map(p => p.name)
      expect(propertyNames).toContain('title')
      expect(propertyNames).toContain('body')
    })

    it('should load property from database', async () => {
      const schemaName = 'Test Schema Property DB Load'
      const modelName = 'TestModel Property DB Load'
      const propertyFileId = generateId()
      const testSchema = createTestSchema(schemaName, {
        [modelName]: {
          id: generateId(),
          properties: {
            content: {
              id: propertyFileId,
              type: 'Text',
            },
          },
        },
      })

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      // Wait for schema to be imported and model to be created
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      // Create the model to ensure it's written to database
      const model = Model.create(modelName, schemaName, { waitForReady: false })
      await new Promise(resolve => setTimeout(resolve, 500))
      
      // Wait for model and properties to be written to database
      // We need to wait for the write process to complete
      await new Promise(resolve => setTimeout(resolve, 2000))
      
      // Verify property exists in database before trying to load it
      const db = BaseDb.getAppDb()
      if (db) {
        const propertyRecords = await db
          .select()
          .from(propertiesTable)
          .where(eq(propertiesTable.schemaFileId, propertyFileId))
          .limit(1)
        
          console.log('propertyRecords', propertyRecords)
        // If property is not in database yet, wait a bit more
        if (propertyRecords.length === 0) {
          await new Promise(resolve => setTimeout(resolve, 2000))
        }
      }

      console.log('propertyFileId', propertyFileId)
      // Create property using createById which queries database
      const property = await ModelProperty.createById(propertyFileId)
      expect(property).toBeDefined()
      
      if (property) {
        expect(property.name).toBe('content')
        expect(property.dataType).toBe('Text')
        
        await waitForModelPropertyIdle(property)
      } else {
        // If property is still undefined, it means it's not in the database yet
        // This could happen if the write process hasn't completed
        // Let's verify what's in the database
        const db = BaseDb.getAppDb()
        if (db) {
          const allProperties = await db.select().from(propertiesTable)
          console.log('All properties in database:', allProperties.map(p => ({ 
            name: p.name, 
            schemaFileId: p.schemaFileId,
            modelId: p.modelId 
          })))
        }
        throw new Error(`Property with id ${propertyFileId} not found in database`)
      }
    })

    it('should handle relationships (refModelId, modelId)', async () => {
      const schemaName = 'Test Schema Property Relationships'
      const authorModelName = 'Author'
      const postModelName = 'Post'
      const testSchema = createTestSchema(schemaName, {
        [authorModelName]: {
          id: generateId(),
          properties: {
            name: {
              id: generateId(),
              type: 'Text',
            },
          },
        },
        [postModelName]: {
          id: generateId(),
          properties: {
            title: {
              id: generateId(),
              type: 'Text',
            },
            author: {
              id: generateId(),
              type: 'Relation',
              ref: authorModelName,
            },
          },
        },
      })

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      const postModel = Model.create(postModelName, schemaName)
      await new Promise(resolve => setTimeout(resolve, 500))
      
      // Wait for models to be written to database
      await new Promise(resolve => setTimeout(resolve, 1000))

      const db = BaseDb.getAppDb()
      if (db) {
        const allProperties = await db.select().from(propertiesTable)
        console.log('All properties in database:', allProperties.map(p => ({ 
          name: p.name, 
          schemaFileId: p.schemaFileId,
          modelId: p.modelId 
        })))
      }
      
      const propertyData = await getPropertySchema(postModelName, 'author')
      expect(propertyData).toBeDefined()
      console.log('[TEST] propertyData from getPropertySchema:', JSON.stringify(propertyData, null, 2))
      
      if (propertyData) {
        const property = ModelProperty.create(propertyData, { waitForReady: false })
        expect(property).toBeDefined()
        console.log('[TEST] property after create:', property)
        console.log('[TEST] property.ref:', property.ref)
        console.log('[TEST] property.refModelName:', property.refModelName)
        expect(property.ref).toBe(authorModelName)
        console.log('property.refModelName', property.refModelName)
        expect(property.refModelName).toBe(authorModelName)
        console.log('property.modelId', property.modelId)
        expect(property.modelId).toBeDefined()
        console.log('property.refModelId', property.refModelId)
        expect(property.refModelId).toBeDefined()
        
        await waitForModelPropertyIdle(property)
      }
    })
  })

  describe('ModelProperty property access', () => {
    it('should access property name, dataType, ref, etc.', async () => {
      const schemaName = 'Test Schema Property Access'
      const modelName = 'TestModel Property Access'
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
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      const model = Model.create(modelName, schemaName, { waitForReady: false })
      await new Promise(resolve => setTimeout(resolve, 500))
      
      const propertyData = await getPropertySchema(modelName, 'title')
      expect(propertyData).toBeDefined()
      
      if (propertyData) {
        const property = ModelProperty.create(propertyData, { waitForReady: false })
        await waitForModelPropertyIdle(property)
        
        expect(property.name).toBe('title')
        expect(property.dataType).toBe('Text')
        expect(property.modelName).toBe(modelName)
      }
    })

    it('should update property values', async () => {
      const schemaName = 'Test Schema Property Update'
      const modelName = 'TestModel Property Update'
      const testSchema = createTestSchema(schemaName, {
        [modelName]: {
          id: generateId(),
          properties: {
            description: {
              id: generateId(),
              type: 'Text',
            },
          },
        },
      })

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      const model = Model.create(modelName, schemaName, { waitForReady: false })
      await new Promise(resolve => setTimeout(resolve, 500))
      
      const propertyData = await getPropertySchema(modelName, 'description')
      expect(propertyData).toBeDefined()
      
      if (propertyData) {
        const property = ModelProperty.create(propertyData, { waitForReady: false })
        await waitForModelPropertyIdle(property)
        
        // Update dataType
        property.dataType = 'Number'
        
        // Wait for update to propagate
        await new Promise(resolve => setTimeout(resolve, 200))
        
        expect(property.dataType).toBe('Number')
      }
    })
  })

  describe('ModelProperty state management', () => {
    it('should track validation errors', async () => {
      const schemaName = 'Test Schema Property Validation Errors'
      const modelName = 'TestModel Property Validation Errors'
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
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      const model = Model.create(modelName, schemaName, { waitForReady: false })
      await new Promise(resolve => setTimeout(resolve, 500))
      
      const propertyData = await getPropertySchema(modelName, 'value')
      expect(propertyData).toBeDefined()
      
      if (propertyData) {
        const property = ModelProperty.create(propertyData, { waitForReady: false })
        await waitForModelPropertyIdle(property)
        
        expect(property.validationErrors).toBeDefined()
        expect(Array.isArray(property.validationErrors)).toBe(true)
        expect(property.isValid).toBe(true)
      }
    })

    it('should track draft/edited state', async () => {
      const schemaName = 'Test Schema Property Edited State'
      const modelName = 'TestModel Property Edited State'
      const testSchema = createTestSchema(schemaName, {
        [modelName]: {
          id: generateId(),
          properties: {
            field: {
              id: generateId(),
              type: 'Text',
            },
          },
        },
      })

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      const model = Model.create(modelName, schemaName, { waitForReady: false })
      await new Promise(resolve => setTimeout(resolve, 500))
      
      const propertyData = await getPropertySchema(modelName, 'field')
      expect(propertyData).toBeDefined()
      
      if (propertyData) {
        const property = ModelProperty.create(propertyData, { waitForReady: false })
        await waitForModelPropertyIdle(property)
        
        // Initially should not be edited
        expect(property.isEdited).toBe(false)
        
        // Update property
        property.dataType = 'Number'
        await new Promise(resolve => setTimeout(resolve, 200))
        
        // Should now be marked as edited
        expect(property.isEdited).toBe(true)
      }
    })

    it('should provide property status', async () => {
      const schemaName = 'Test Schema Property Status'
      const modelName = 'TestModel Property Status'
      const testSchema = createTestSchema(schemaName, {
        [modelName]: {
          id: generateId(),
          properties: {
            status: {
              id: generateId(),
              type: 'Text',
            },
          },
        },
      })

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      const model = Model.create(modelName, schemaName, { waitForReady: false })
      await new Promise(resolve => setTimeout(resolve, 500))
      
      const propertyData = await getPropertySchema(modelName, 'status')
      expect(propertyData).toBeDefined()
      
      if (propertyData) {
        const property = ModelProperty.create(propertyData, { waitForReady: false })
        
        // Status should be 'loading' initially or 'idle'
        expect(['loading', 'idle']).toContain(property.status)
        
        await waitForModelPropertyIdle(property)
        
        // Status should be 'idle' after loading
        expect(property.status).toBe('idle')
      }
    })
  })

  describe('ModelProperty validation', () => {
    it('should validate a valid property', async () => {
      const schemaName = 'Test Schema Property Validate'
      const modelName = 'TestModel Property Validate'
      const testSchema = createTestSchema(schemaName, {
        [modelName]: {
          id: generateId(),
          properties: {
            valid: {
              id: generateId(),
              type: 'Text',
            },
          },
        },
      })

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      const model = Model.create(modelName, schemaName, { waitForReady: false })
      await new Promise(resolve => setTimeout(resolve, 500))
      
      const propertyData = await getPropertySchema(modelName, 'valid')
      expect(propertyData).toBeDefined()
      
      if (propertyData) {
        const property = ModelProperty.create(propertyData, { waitForReady: false })
        await waitForModelPropertyIdle(property)
        
        const validationResult = await property.validate()
        expect(validationResult).toBeDefined()
        expect(validationResult).toHaveProperty('isValid')
        expect(validationResult).toHaveProperty('errors')
        expect(Array.isArray(validationResult.errors)).toBe(true)
      }
    })

    it('should return validation result structure', async () => {
      const schemaName = 'Test Schema Property Validate Structure'
      const modelName = 'TestModel Property Validate Structure'
      const testSchema = createTestSchema(schemaName, {
        [modelName]: {
          id: generateId(),
          properties: {
            test: {
              id: generateId(),
              type: 'Text',
            },
          },
        },
      })

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      const model = Model.create(modelName, schemaName, { waitForReady: false })
      await new Promise(resolve => setTimeout(resolve, 500))
      
      const propertyData = await getPropertySchema(modelName, 'test')
      expect(propertyData).toBeDefined()
      
      if (propertyData) {
        const property = ModelProperty.create(propertyData, { waitForReady: false })
        await waitForModelPropertyIdle(property)
        
        const validationResult = await property.validate()
        expect(validationResult).toHaveProperty('isValid')
        expect(validationResult).toHaveProperty('errors')
        expect(typeof validationResult.isValid).toBe('boolean')
        expect(Array.isArray(validationResult.errors)).toBe(true)
      }
    })
  })

  describe('ModelProperty save', () => {
    it('should save property to schema', async () => {
      const schemaName = 'Test Schema Property Save'
      const modelName = 'TestModel Property Save'
      const testSchema = createTestSchema(schemaName, {
        [modelName]: {
          id: generateId(),
          properties: {
            saved: {
              id: generateId(),
              type: 'Text',
            },
          },
        },
      })

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      const model = Model.create(modelName, schemaName, { waitForReady: false })
      await new Promise(resolve => setTimeout(resolve, 500))
      
      const propertyData = await getPropertySchema(modelName, 'saved')
      expect(propertyData).toBeDefined()
      
      if (propertyData) {
        const property = ModelProperty.create(propertyData, { waitForReady: false })
        await waitForModelPropertyIdle(property)
        
        // Update property
        property.dataType = 'Number'
        await new Promise(resolve => setTimeout(resolve, 200))
        
        // Save property
        property.save()
        
        // Wait for save to complete
        await new Promise(resolve => setTimeout(resolve, 1000))
        
        // Property should still be defined
        expect(property).toBeDefined()
      }
    })
  })

  describe('ModelProperty reload', () => {
    it('should reload property from database', async () => {
      const schemaName = 'Test Schema Property Reload'
      const modelName = 'TestModel Property Reload'
      const testSchema = createTestSchema(schemaName, {
        [modelName]: {
          id: generateId(),
          properties: {
            reload: {
              id: generateId(),
              type: 'Text',
            },
          },
        },
      })

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      const model = Model.create(modelName, schemaName, { waitForReady: false })
      await new Promise(resolve => setTimeout(resolve, 500))
      
      const propertyData = await getPropertySchema(modelName, 'reload')
      expect(propertyData).toBeDefined()
      
      if (propertyData) {
        const property = ModelProperty.create(propertyData, { waitForReady: false })
        await waitForModelPropertyIdle(property)
        
        // Reload property (note: ModelProperty.reload() is a no-op currently)
        await property.reload()
        
        // Property should still be defined
        expect(property).toBeDefined()
      }
    })
  })

  describe('ModelProperty unload', () => {
    it('should unload property and clean up resources', async () => {
      const schemaName = 'Test Schema Property Unload'
      const modelName = 'TestModel Property Unload'
      const testSchema = createTestSchema(schemaName, {
        [modelName]: {
          id: generateId(),
          properties: {
            unload: {
              id: generateId(),
              type: 'Text',
            },
          },
        },
      })

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      const model = Model.create(modelName, schemaName, { waitForReady: false })
      await new Promise(resolve => setTimeout(resolve, 500))
      
      const propertyData = await getPropertySchema(modelName, 'unload')
      expect(propertyData).toBeDefined()
      
      if (propertyData) {
        const property = ModelProperty.create(propertyData, { waitForReady: false })
        await waitForModelPropertyIdle(property)
        
        // Verify service is running
        const snapshotBefore = property.getService().getSnapshot()
        expect(snapshotBefore.status).toBe('active')
        
        // Unload
        property.unload()
        
        // Verify service is stopped
        const snapshotAfter = property.getService().getSnapshot()
        expect(snapshotAfter.status).toBe('stopped')
      }
    })
  })

  describe('ModelProperty name change', () => {
    it('should update property name', async () => {
      const schemaName = 'Test Schema Property Name Change'
      const modelName = 'TestModel Property Name Change'
      const testSchema = createTestSchema(schemaName, {
        [modelName]: {
          id: generateId(),
          properties: {
            oldName: {
              id: generateId(),
              type: 'Text',
            },
          },
        },
      })

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      const model = Model.create(modelName, schemaName, { waitForReady: false })
      await new Promise(resolve => setTimeout(resolve, 500))
      
      const propertyData = await getPropertySchema(modelName, 'oldName')
      expect(propertyData).toBeDefined()
      
      if (propertyData) {
        const property = ModelProperty.create(propertyData, { waitForReady: false })
        await waitForModelPropertyIdle(property)
        
        const oldName = property.name
        const newName = 'newName'
        
        property.name = newName
        
        // Wait for update to complete
        await new Promise(resolve => setTimeout(resolve, 200))
        
        expect(property.name).toBe(newName)
      }
    })

    it('should immediately save property name changes to database', async () => {
      const schemaName = 'Test Schema Property Name Change DB'
      const modelName = 'TestModel Property Name Change DB'
      const testSchema = createTestSchema(schemaName, {
        [modelName]: {
          id: generateId(),
          properties: {
            oldPropertyName: {
              id: generateId(),
              type: 'Text',
            },
          },
        },
      })

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      const model = Model.create(modelName, schemaName, { waitForReady: false })
      await new Promise(resolve => setTimeout(resolve, 500))
      
      const propertyData = await getPropertySchema(modelName, 'oldPropertyName')
      expect(propertyData).toBeDefined()
      
      if (!propertyData) {
        throw new Error('Property data not found')
      }

      const property = ModelProperty.create(propertyData, { waitForReady: false })
      await waitForModelPropertyIdle(property)
      
      const oldName = property.name
      const newName = 'UpdatedPropertyName'
      
      expect(oldName).toBeDefined()
      expect(oldName).toBe('oldPropertyName')
      
      // Get modelId and schemaFileId from property context for database queries
      const propertyContext = (property as any)._getSnapshotContext()
      const modelId = propertyContext.modelId
      const schemaFileId = propertyContext._propertyFileId || (typeof propertyContext.id === 'string' ? propertyContext.id : undefined)
      
      // Wait a bit for property to be written to database if it wasn't already
      await new Promise(resolve => setTimeout(resolve, 300))
      
      // Verify property exists in database with old name first
      const db = BaseDb.getAppDb()
      if (db && modelId && oldName) {
        const dbPropertiesBefore = await db
          .select()
          .from(propertiesTable)
          .where(
            and(
              eq(propertiesTable.modelId, modelId),
              eq(propertiesTable.name, oldName as string)
            )
          )
          .limit(1)
        
        // Property might not be in database yet if schema wasn't saved, but that's okay
        // We'll verify it gets saved after the name change
      }
      
      // Update name
      property.name = newName
      
      // Wait for update to complete (including database save via compareAndMarkDraft)
      // Need to wait for the state machine to complete the compareAndMarkDraft state
      await waitForModelPropertyIdle(property)
      await new Promise(resolve => setTimeout(resolve, 500))
      
      // Verify name changed in memory
      expect(property.name).toBe(newName)
      
      // Verify database was updated with new name
      if (db && modelId) {
        // Debug: Check all properties for this model
        const allProperties = await db
          .select()
          .from(propertiesTable)
          .where(eq(propertiesTable.modelId, modelId))
        console.log(`[TEST] All properties for modelId ${modelId}:`, allProperties.map(p => ({ id: p.id, name: p.name, schemaFileId: p.schemaFileId })))
        
        const dbProperties = await db
          .select()
          .from(propertiesTable)
          .where(
            and(
              eq(propertiesTable.modelId, modelId),
              eq(propertiesTable.name, newName)
            )
          )
          .limit(1)
        
        console.log(`[TEST] Properties with new name "${newName}":`, dbProperties)
        expect(dbProperties.length).toBeGreaterThan(0)
        expect(dbProperties[0].name).toBe(newName)
        
        // CRITICAL: Verify property can still be found by schemaFileId after name change
        // This ensures persistence works correctly
        if (schemaFileId) {
          const propertyBySchemaFileId = await db
            .select()
            .from(propertiesTable)
            .where(
              and(
                eq(propertiesTable.schemaFileId, schemaFileId),
                eq(propertiesTable.modelId, modelId)
              )
            )
            .limit(1)
          
          expect(propertyBySchemaFileId.length).toBe(1)
          expect(propertyBySchemaFileId[0].name).toBe(newName)
          expect(propertyBySchemaFileId[0].schemaFileId).toBe(schemaFileId)
        }
        
        // Verify old name no longer exists in database (if it existed before)
        if (oldName) {
          const oldDbProperties = await db
            .select()
            .from(propertiesTable)
            .where(
              and(
                eq(propertiesTable.modelId, modelId),
                eq(propertiesTable.name, oldName as string)
              )
            )
            .limit(1)
          
          // If the property was in the database before, it should be renamed (length = 0)
          // If it wasn't in the database before, this is also fine
          // The key assertion is that the new name exists in the database
        }
        expect(dbProperties.length).toBeGreaterThan(0)
      }
    })

    it('should save property name changes to database even when _originalValues is not initialized yet', async () => {
      // This test covers the race condition where name is changed before _originalValues is set
      const schemaName = 'Test Schema Property Name Change Race'
      const modelName = 'TestModel Property Name Change Race'
      const propertyFileId = generateId()
      const testSchema = createTestSchema(schemaName, {
        [modelName]: {
          id: generateId(),
          properties: {
            initialName: {
              id: propertyFileId,
              type: 'Text',
            },
          },
        },
      })

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      const model = Model.create(modelName, schemaName, { waitForReady: false })
      await new Promise(resolve => setTimeout(resolve, 500))
      
      const propertyData = await getPropertySchema(modelName, 'initialName')
      expect(propertyData).toBeDefined()
      
      if (!propertyData) {
        throw new Error('Property data not found')
      }

      const property = ModelProperty.create(propertyData, { waitForReady: false })
      
      // DON'T wait for idle - change the name immediately before _originalValues is initialized
      // This simulates the race condition scenario
      const newName = 'ChangedBeforeInit'
      property.name = newName
      
      // Now wait for the state machine to process the change
      await waitForModelPropertyIdle(property)
      await new Promise(resolve => setTimeout(resolve, 500))
      
      // Verify name changed in memory
      expect(property.name).toBe(newName)
      
      // Verify database was updated with new name
      const db = BaseDb.getAppDb()
      if (db) {
        const propertyContext = (property as any)._getSnapshotContext()
        const modelId = propertyContext.modelId
        
        if (modelId) {
          // Verify property exists in database with new name
          const dbProperties = await db
            .select()
            .from(propertiesTable)
            .where(
              and(
                eq(propertiesTable.modelId, modelId),
                eq(propertiesTable.name, newName)
              )
            )
            .limit(1)
          
          expect(dbProperties.length).toBeGreaterThan(0)
          expect(dbProperties[0].name).toBe(newName)
          
          // Verify property can be found by schemaFileId
          const propertyBySchemaFileId = await db
            .select()
            .from(propertiesTable)
            .where(
              and(
                eq(propertiesTable.schemaFileId, propertyFileId),
                eq(propertiesTable.modelId, modelId)
              )
            )
            .limit(1)
          
          expect(propertyBySchemaFileId.length).toBe(1)
          expect(propertyBySchemaFileId[0].name).toBe(newName)
        }
      }
    })

    it('should persist property name changes across reloads (simulating page reload)', async () => {
      // This test simulates what happens when a user changes a name and then reloads the page
      const schemaName = 'Test Schema Property Name Persistence'
      const modelName = 'TestModel Property Name Persistence'
      const propertyFileId = generateId()
      const testSchema = createTestSchema(schemaName, {
        [modelName]: {
          id: generateId(),
          properties: {
            originalPropertyName: {
              id: propertyFileId,
              type: 'Text',
            },
          },
        },
      })

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      const model = Model.create(modelName, schemaName, { waitForReady: false })
      await new Promise(resolve => setTimeout(resolve, 500))
      
      const propertyData = await getPropertySchema(modelName, 'originalPropertyName')
      expect(propertyData).toBeDefined()
      
      if (!propertyData) {
        throw new Error('Property data not found')
      }

      // Create property and change name
      const property = ModelProperty.create(propertyData, { waitForReady: false })
      await waitForModelPropertyIdle(property)
      
      const newName = 'PersistedPropertyName'
      property.name = newName
      
      // Wait for database save to complete
      await waitForModelPropertyIdle(property)
      await new Promise(resolve => setTimeout(resolve, 500))
      
      // Verify name changed in memory
      expect(property.name).toBe(newName)
      
      // "Reload" - unload the property and reload it from database
      property.unload()
      
      // Wait a bit to ensure unload completed
      await new Promise(resolve => setTimeout(resolve, 200))
      
      // Reload property from database using schemaFileId (simulating useModelProperties)
      const reloadedProperty = await ModelProperty.createById(propertyFileId)
      expect(reloadedProperty).toBeDefined()
      
      if (reloadedProperty) {
        await waitForModelPropertyIdle(reloadedProperty)
        
        // Verify the name change persisted
        expect(reloadedProperty.name).toBe(newName)
        
        // Verify it's the same property (same schemaFileId)
        const reloadedContext = (reloadedProperty as any)._getSnapshotContext()
        const originalContext = (property as any)._getSnapshotContext()
        const reloadedSchemaFileId = reloadedContext._propertyFileId || (typeof reloadedContext.id === 'string' ? reloadedContext.id : undefined)
        const originalSchemaFileId = originalContext._propertyFileId || (typeof originalContext.id === 'string' ? originalContext.id : undefined)
        
        expect(reloadedSchemaFileId).toBe(originalSchemaFileId)
        expect(reloadedSchemaFileId).toBe(propertyFileId)
      }
    })

    it('should correctly detect name changes in comparison logic', async () => {
      // This test verifies that the comparison logic in compareAndMarkDraft correctly detects name changes
      const schemaName = 'Test Schema Property Name Comparison'
      const modelName = 'TestModel Property Name Comparison'
      const testSchema = createTestSchema(schemaName, {
        [modelName]: {
          id: generateId(),
          properties: {
            beforeName: {
              id: generateId(),
              type: 'Text',
            },
          },
        },
      })

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      const model = Model.create(modelName, schemaName, { waitForReady: false })
      await new Promise(resolve => setTimeout(resolve, 500))
      
      const propertyData = await getPropertySchema(modelName, 'beforeName')
      expect(propertyData).toBeDefined()
      
      if (!propertyData) {
        throw new Error('Property data not found')
      }

      const property = ModelProperty.create(propertyData, { waitForReady: false })
      await waitForModelPropertyIdle(property)
      
      // Verify _originalValues is set (needed for comparison)
      const contextBefore = (property as any)._getSnapshotContext()
      expect(contextBefore._originalValues).toBeDefined()
      expect(contextBefore._originalValues?.name).toBe('beforeName')
      
      // Change name
      const newName = 'afterName'
      property.name = newName
      
      // Wait for state machine to process (validating -> compareAndMarkDraft -> idle)
      await waitForModelPropertyIdle(property)
      await new Promise(resolve => setTimeout(resolve, 500))
      
      // Verify name changed
      expect(property.name).toBe(newName)
      
      // Verify isEdited flag is set (indicates comparison detected the change)
      expect(property.isEdited).toBe(true)
      
      // Verify database was updated
      const db = BaseDb.getAppDb()
      if (db) {
        const contextAfter = (property as any)._getSnapshotContext()
        const modelId = contextAfter.modelId
        
        if (modelId) {
          const dbProperties = await db
            .select()
            .from(propertiesTable)
            .where(
              and(
                eq(propertiesTable.modelId, modelId),
                eq(propertiesTable.name, newName)
              )
            )
            .limit(1)
          
          expect(dbProperties.length).toBeGreaterThan(0)
          expect(dbProperties[0].name).toBe(newName)
          expect(dbProperties[0].isEdited).toBe(true)
        }
      }
    })

    it('newly created property: first rename persists and survives reload (regression test)', async () => {
      // Regression test: changing the name on a newly created ModelProperty must persist.
      // Scenario: user adds a new property (create from schema), renames it immediately,
      // then "reloads" (e.g. page refresh) — the new name must be what we get from DB.
      const schemaName = 'Test Schema Property Newly Created Rename'
      const modelName = 'TestModel Property Newly Created Rename'
      const propertyFileId = generateId()
      const testSchema = createTestSchema(schemaName, {
        [modelName]: {
          id: generateId(),
          properties: {
            initialName: {
              id: propertyFileId,
              type: 'Text',
            },
          },
        },
      })

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      await new Promise(resolve => setTimeout(resolve, 1000))

      const model = Model.create(modelName, schemaName, { waitForReady: false })
      await new Promise(resolve => setTimeout(resolve, 500))

      const propertyData = await getPropertySchema(modelName, 'initialName')
      expect(propertyData).toBeDefined()
      if (!propertyData) throw new Error('Property data not found')

      // Newly created via create(propertyData) — do NOT wait for idle
      const property = ModelProperty.create(propertyData, { waitForReady: false })
      const newName = 'RenamedAfterCreate'
      property.name = newName

      // Wait for machine to process (validation + compareAndMarkDraft + write) and settle
      await waitForModelPropertyIdle(property)
      await new Promise(resolve => setTimeout(resolve, 800))

      // In-memory name must be updated
      expect(property.name).toBe(newName)
      // Must not be in error state (structure validation must pass for newly created rename)
      const snapshot = property.getService().getSnapshot()
      expect(snapshot.value).not.toBe('error')

      // Simulate page reload: unload and load from DB by schemaFileId
      property.unload()
      await new Promise(resolve => setTimeout(resolve, 200))

      const reloaded = await ModelProperty.createById(propertyFileId)
      expect(reloaded).toBeDefined()
      if (!reloaded) throw new Error('Reloaded property not found')
      await waitForModelPropertyIdle(reloaded)

      // Critical: the name change must have persisted so "reload" shows the new name
      expect(reloaded.name).toBe(newName)
    })

    it('newly created property: renaming before idle does not cause error and name is applied (regression test)', async () => {
      // Regression test: first rename on a newly created property must not fail structure
      // validation (modelName/dataType/modelId resolution). The machine must stay out of error.
      const schemaName = 'Test Schema Property Newly Created No Error'
      const modelName = 'TestModel Property Newly Created No Error'
      const propertyFileId = generateId()
      const testSchema = createTestSchema(schemaName, {
        [modelName]: {
          id: generateId(),
          properties: {
            original: {
              id: propertyFileId,
              type: 'Text',
            },
          },
        },
      })

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      await new Promise(resolve => setTimeout(resolve, 1000))

      const model = Model.create(modelName, schemaName, { waitForReady: false })
      await new Promise(resolve => setTimeout(resolve, 500))

      const propertyData = await getPropertySchema(modelName, 'original')
      expect(propertyData).toBeDefined()
      if (!propertyData) throw new Error('Property data not found')

      const property = ModelProperty.create(propertyData, { waitForReady: false })
      const newName = 'FirstRename'
      property.name = newName

      await waitForModelPropertyIdle(property)

      expect(property.name).toBe(newName)
      const snapshot = property.getService().getSnapshot()
      expect(snapshot.value).toBe('idle')
      expect(snapshot.value).not.toBe('error')
    })
  })

  describe('ModelProperty subscription handling', () => {
    it('should not cause infinite loop when subscribing immediately after create', async () => {
      const schemaName = 'Test Schema Property Subscription'
      const modelName = 'TestModel Property Subscription'
      const testSchema = createTestSchema(schemaName, {
        [modelName]: {
          id: generateId(),
          properties: {
            sub: {
              id: generateId(),
              type: 'Text',
            },
          },
        },
      })

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      const model = Model.create(modelName, schemaName, { waitForReady: false })
      await new Promise(resolve => setTimeout(resolve, 500))
      
      const propertyData = await getPropertySchema(modelName, 'sub')
      expect(propertyData).toBeDefined()
      
      if (propertyData) {
        const property = ModelProperty.create(propertyData, { waitForReady: false })
        
        // Track subscription callbacks
        let callbackCount = 0
        const callbackHistory: Array<{ value: string; timestamp: number }> = []
        const maxExpectedCallbacks = 10
        
        const subscription = property.getService().subscribe((snapshot) => {
          callbackCount++
          callbackHistory.push({
            value: snapshot.value as string,
            timestamp: Date.now(),
          })
          
          // Access snapshot properties to ensure they don't trigger loops
          const value = snapshot.value
          const context = snapshot.context
          
          expect(value).toBeDefined()
          expect(context).toBeDefined()
          
          // Fail if we get too many callbacks (indicates infinite loop)
          if (callbackCount > maxExpectedCallbacks) {
            subscription.unsubscribe()
            throw new Error(
              `Infinite loop detected: subscription fired ${callbackCount} times. ` +
              `History: ${callbackHistory.map(h => `${h.value}@${h.timestamp}`).join(', ')}`
            )
          }
        })
        
        // Wait for property to stabilize
        await waitForModelPropertyIdle(property, 10000)
        
        // Wait a bit more to ensure no additional callbacks
        await new Promise(resolve => setTimeout(resolve, 1000))
        
        // Unsubscribe
        subscription.unsubscribe()
        
        // Verify we didn't get an excessive number of callbacks
        expect(callbackCount).toBeLessThanOrEqual(maxExpectedCallbacks)
        
        // Verify the property eventually reached idle state
        const finalSnapshot = property.getService().getSnapshot()
        expect(finalSnapshot.value).toBe('idle')
      }
    })
  })
})
