import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import { client } from '@/client'
import { Schema } from '@/Schema/Schema'
import { BaseDb } from '@/db/Db/BaseDb'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { schemas } from '@/seedSchema/SchemaSchema'
import { eq } from 'drizzle-orm'
import internalSchema from '@/seedSchema/SEEDPROTOCOL_Seed_Protocol_v1.json'
import { SchemaFileFormat } from '@/types/import'
import { importJsonSchema } from '@/imports/json'

// This test should only run in Node.js environment
const testDescribe = typeof window === 'undefined' 
  ? (describe.sequential || describe)
  : describe.skip

testDescribe('Schema Models Integration Tests', () => {
  let testProjectPath: string
  let fsModule: any
  let pathModule: any

  beforeAll(async () => {
    if (typeof window !== 'undefined') {
      throw new Error('This test suite requires Node.js environment')
    }

    fsModule = await import('fs')
    pathModule = await import('path')
    const { fileURLToPath } = await import('url')
    const __filename = fileURLToPath(import.meta.url)
    const __dirname = pathModule.dirname(__filename)
    testProjectPath = pathModule.join(__dirname, '../__mocks__/node/project')

    // Create minimal config for testing
    // The seed-protocol schema models will be loaded automatically via processSchemaFiles
    const config = {
      models: {}, // Empty models - seed-protocol models are loaded from schema files
      endpoints: {
        filePaths: '/api/seed/migrations',
        files: '/app-files',
      },
      arweaveDomain: 'arweave.net',
    }

    // Initialize client with config
    await client.init({
      config,
      projectPath: testProjectPath,
    })
  })

  afterAll(async () => {
    // Clean up
    const db = BaseDb.getAppDb()
    if (db) {
      // Clear schemas table
      await db.delete(schemas)
    }
  })

  beforeEach(async () => {
    // Clean up database before each test
    const db = BaseDb.getAppDb()
    if (db) {
      await db.delete(schemas)
    }

    // Clean up schema files
    const workingDir = BaseFileManager.getWorkingDir()
    if (fsModule.existsSync(workingDir)) {
      const files = fsModule.readdirSync(workingDir)
      for (const file of files) {
        if (file.endsWith('.json') && file.includes('Seed_Protocol')) {
          fsModule.unlinkSync(pathModule.join(workingDir, file))
        }
      }
    }
  })

  afterEach(async () => {
    // Clean up Schema instances
    Schema.clearCache()
  })

  describe('Loading seed-protocol schema with models', () => {
    it('should load schema with models from internal schema file', async () => {
      // Import the internal schema
      const schemaName = 'Seed Protocol'
      const schemaData = internalSchema as SchemaFileFormat
      
      console.log('Step 1: Importing schema...')
      await importJsonSchema({ contents: JSON.stringify(schemaData) }, schemaData.version)
      
      console.log('Step 2: Creating Schema instance...')
      const schema = Schema.create(schemaName)
      
      console.log('Step 3: Waiting for schema to load...')
      // Wait for schema to load
      await new Promise<void>((resolve, reject) => {
        const subscription = schema.getService().subscribe((snapshot) => {
          if (snapshot.value === 'idle') {
            subscription.unsubscribe()
            resolve()
          } else if (snapshot.value === 'error') {
            subscription.unsubscribe()
            reject(new Error('Schema failed to load'))
          }
        })
        
        // Timeout after 5 seconds
        setTimeout(() => {
          subscription.unsubscribe()
          reject(new Error('Schema loading timeout'))
        }, 5000)
      })

      console.log('Step 4: Checking schema context...')
      const context = schema.getService().getSnapshot().context
      console.log('Schema context:', {
        schemaName: context.schemaName,
        version: context.version,
        metadata: context.metadata,
        hasModels: !!context.models,
        modelCount: context.models ? Object.keys(context.models).length : 0,
        modelNames: context.models ? Object.keys(context.models) : [],
      })

      console.log('Step 5: Checking schema.models property...')
      const models = schema.models
      console.log('schema.models:', {
        isArray: Array.isArray(models),
        length: Array.isArray(models) ? models.length : 'N/A',
        models: models,
      })

      // Verify context has models
      expect(context.models).toBeDefined()
      expect(context.models).not.toBeNull()
      expect(Object.keys(context.models || {})).toHaveLength(4)
      expect(context.models).toHaveProperty('Seed')
      expect(context.models).toHaveProperty('Version')
      expect(context.models).toHaveProperty('Metadata')
      expect(context.models).toHaveProperty('Image')

      // Verify schema.models property returns array of Model instances
      expect(models).toBeDefined()
      expect(Array.isArray(models)).toBe(true)
      expect(models.length).toBe(4)
      
      // Verify each model is a Model instance
      for (const model of models) {
        expect(model).toBeDefined()
        expect(model.modelName).toBeDefined()
        expect(['Seed', 'Version', 'Metadata', 'Image']).toContain(model.modelName)
      }
    })

    it('should load schema with models from database schemaData', async () => {
      const schemaName = 'Seed Protocol'
      const schemaData = internalSchema as SchemaFileFormat
      
      // Import schema to database
      await importJsonSchema({ contents: JSON.stringify(schemaData) }, schemaData.version)
      
      // Verify schemaData is stored in database
      const db = BaseDb.getAppDb()
      expect(db).toBeDefined()
      
      const dbSchemas = await db!
        .select()
        .from(schemas)
        .where(eq(schemas.name, schemaName))
        .limit(1)
      
      expect(dbSchemas.length).toBeGreaterThan(0)
      const dbSchema = dbSchemas[0]
      expect(dbSchema.schemaData).toBeDefined()
      
      // Parse schemaData to verify it has models
      const storedSchema = JSON.parse(dbSchema.schemaData!) as SchemaFileFormat
      expect(storedSchema.models).toBeDefined()
      expect(Object.keys(storedSchema.models)).toHaveLength(4)
      
      // Delete the file to force loading from database
      const workingDir = BaseFileManager.getWorkingDir()
      const sanitizedName = schemaName.replace(/[^a-zA-Z0-9_-]/g, '_')
      const filename = `${sanitizedName}-v${schemaData.version}.json`
      const filePath = pathModule.join(workingDir, filename)
      
      if (fsModule.existsSync(filePath)) {
        fsModule.unlinkSync(filePath)
      }
      
      // Create new Schema instance (should load from database)
      const schema = Schema.create(schemaName)
      
      // Wait for schema to load
      await new Promise<void>((resolve, reject) => {
        const subscription = schema.getService().subscribe((snapshot) => {
          if (snapshot.value === 'idle') {
            subscription.unsubscribe()
            resolve()
          } else if (snapshot.value === 'error') {
            subscription.unsubscribe()
            reject(new Error('Schema failed to load'))
          }
        })
        
        setTimeout(() => {
          subscription.unsubscribe()
          reject(new Error('Schema loading timeout'))
        }, 5000)
      })

      const context = schema.getService().getSnapshot().context
      console.log('Schema loaded from database - context:', {
        hasModels: !!context.models,
        modelCount: context.models ? Object.keys(context.models).length : 0,
        modelNames: context.models ? Object.keys(context.models) : [],
      })

      const models = schema.models
      console.log('schema.models from database:', {
        length: Array.isArray(models) ? models.length : 'N/A',
        models: models,
      })

      // Verify models are loaded
      expect(context.models).toBeDefined()
      expect(Object.keys(context.models || {})).toHaveLength(4)
      expect(Array.isArray(models)).toBe(true)
      expect(models.length).toBe(4)
    })

    it('should populate models even when schemaData is missing', async () => {
      const schemaName = 'Seed Protocol'
      const schemaData = internalSchema as SchemaFileFormat
      
      // Import schema
      await importJsonSchema({ contents: JSON.stringify(schemaData) }, schemaData.version)
      
      // Remove schemaData from database to simulate old schema
      const db = BaseDb.getAppDb()
      const dbSchemas = await db!
        .select()
        .from(schemas)
        .where(eq(schemas.name, schemaName))
        .limit(1)
      
      if (dbSchemas.length > 0) {
        await db!
          .update(schemas)
          .set({ schemaData: null })
          .where(eq(schemas.id, dbSchemas[0].id!))
      }
      
      // Delete the file
      const workingDir = BaseFileManager.getWorkingDir()
      const sanitizedName = schemaName.replace(/[^a-zA-Z0-9_-]/g, '_')
      const filename = `${sanitizedName}-v${schemaData.version}.json`
      const filePath = pathModule.join(workingDir, filename)
      
      if (fsModule.existsSync(filePath)) {
        fsModule.unlinkSync(filePath)
      }
      
      // Create Schema instance (should fallback to internal schema)
      const schema = Schema.create(schemaName)
      
      // Wait for schema to load
      await new Promise<void>((resolve, reject) => {
        const subscription = schema.getService().subscribe((snapshot) => {
          if (snapshot.value === 'idle') {
            subscription.unsubscribe()
            resolve()
          } else if (snapshot.value === 'error') {
            subscription.unsubscribe()
            reject(new Error('Schema failed to load'))
          }
        })
        
        setTimeout(() => {
          subscription.unsubscribe()
          reject(new Error('Schema loading timeout'))
        }, 5000)
      })

      const context = schema.getService().getSnapshot().context
      console.log('Schema loaded without schemaData - context:', {
        hasModels: !!context.models,
        modelCount: context.models ? Object.keys(context.models).length : 0,
        modelNames: context.models ? Object.keys(context.models) : [],
      })

      const models = schema.models
      console.log('schema.models without schemaData:', {
        length: Array.isArray(models) ? models.length : 'N/A',
        models: models,
      })

      // Verify models are populated from internal schema
      expect(context.models).toBeDefined()
      expect(Object.keys(context.models || {})).toHaveLength(4)
      expect(Array.isArray(models)).toBe(true)
      expect(models.length).toBe(4)
    })

    it('should reference modelInstances when context.models changes', async () => {
      const schemaName = 'Seed Protocol'
      const schemaData = internalSchema as SchemaFileFormat
      
      await importJsonSchema({ contents: JSON.stringify(schemaData) }, schemaData.version)
      
      const schema = Schema.create(schemaName)
      
      // Wait for schema to load
      await new Promise<void>((resolve, reject) => {
        const subscription = schema.getService().subscribe((snapshot) => {
          if (snapshot.value === 'idle') {
            subscription.unsubscribe()
            resolve()
          } else if (snapshot.value === 'error') {
            subscription.unsubscribe()
            reject(new Error('Schema failed to load'))
          }
        })
        
        setTimeout(() => {
          subscription.unsubscribe()
          reject(new Error('Schema loading timeout'))
        }, 5000)
      })

      // Check models immediately
      const models1 = schema.models
      expect(Array.isArray(models1)).toBe(true)
      expect(models1.length).toBe(4)
      
      // Verify that Model instances are referenced (not updated) when context.models changes
      // liveQuery now handles Model instance updates automatically
      const context = schema.getService().getSnapshot().context
      expect(context.models).toBeDefined()
      expect(Object.keys(context.models || {})).toHaveLength(4)
      
      // Wait a bit and check again (to ensure modelInstances are referenced)
      await new Promise(resolve => setTimeout(resolve, 100))
      
      const models2 = schema.models
      expect(Array.isArray(models2)).toBe(true)
      expect(models2.length).toBe(4)
      
      // Models should be the same instances (referenced from cache)
      expect(models1).toEqual(models2)
      
      // Verify that Model instances maintain their own state independently
      // by checking that they are actual Model instances, not just data
      for (const model of models1) {
        expect(model.modelName).toBeDefined()
        expect(model.schemaName).toBe(schemaName)
      }
    })
  })
})

