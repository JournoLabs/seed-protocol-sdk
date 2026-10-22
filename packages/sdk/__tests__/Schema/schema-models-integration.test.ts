import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import { client } from '@/client'
import { Schema } from '@/Schema/Schema'
import { BaseDb } from '@/db/Db/BaseDb'
import { DEFAULT_ARWEAVE_HOST } from '@/helpers/constants'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { schemas } from '@/seedSchema/SchemaSchema'
import { models as modelsTable } from '@/seedSchema/ModelSchema'
import { modelSchemas } from '@/seedSchema/ModelSchemaSchema'
import { eq } from 'drizzle-orm'
import internalSchema from '@/seedSchema/SEEDPROTOCOL_Seed_Protocol_v1.json'
import { SchemaFileFormat } from '@/types/import'
import { importJsonSchema, syncSchemaFromSource } from '@/imports/json'
import { loadAllSchemasFromDb } from '@/helpers/schema'
import { Model } from '@/Model/Model'
import { setupTestEnvironment, teardownTestEnvironment } from '../test-utils/client-init'
import { cleanupTestSchemaData } from '../test-utils/cleanupTestDb'
import { waitForSchemaIdle } from '../test-utils/waitForIdle'

const internalModelNames = Object.keys((internalSchema as SchemaFileFormat).models)

// This test should only run in Node.js environment
const testDescribe = typeof window === 'undefined' 
  ? (describe.sequential || describe)
  : describe.skip

testDescribe('Schema Models Integration Tests', () => {
  let testProjectPath: string | undefined
  let fsModule: any
  let pathModule: any

  beforeAll(async () => {
    if (typeof window !== 'undefined') {
      throw new Error('This test suite requires Node.js environment')
    }

    fsModule = await import('fs')
    pathModule = await import('path')

    // Use setupTestEnvironment to create a temporary directory and initialize client
    testProjectPath = await setupTestEnvironment({
      testFileUrl: import.meta.url,
    })
  })

  afterAll(async () => {
    await cleanupTestSchemaData()
    await teardownTestEnvironment()
  })

  beforeEach(async () => {
    // Remove schemas other tests created. The Seed Protocol schema stays: client init needs it, and these
    // tests re-import it over the existing rows.
    await cleanupTestSchemaData()

    // Drop cached Schema instances so each test loads a fresh one.
    Schema.clearCache()

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
      const schema = Schema.create(schemaName, { waitForReady: false })
      
      console.log('Step 3: Waiting for schema to load...')
      // Wait for schema to load
      await waitForSchemaIdle(schema)

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
      expect(Object.keys(context.models || {})).toHaveLength(internalModelNames.length)
      expect(context.models).toHaveProperty('Seed')
      expect(context.models).toHaveProperty('Version')
      expect(context.models).toHaveProperty('Metadata')
      expect(context.models).toHaveProperty('Image')

      // Verify schema.models property returns array of Model instances
      expect(models).toBeDefined()
      expect(Array.isArray(models)).toBe(true)
      expect(models.length).toBe(internalModelNames.length)
      
      // Verify each model is a Model instance
      for (const model of models) {
        expect(model).toBeDefined()
        expect(model.modelName).toBeDefined()
        expect(internalModelNames).toContain(model.modelName)
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
      expect(Object.keys(storedSchema.models)).toHaveLength(internalModelNames.length)
      
      // Delete the file to force loading from database
      const workingDir = BaseFileManager.getWorkingDir()
      const sanitizedName = schemaName.replace(/[^a-zA-Z0-9_-]/g, '_')
      const filename = `${sanitizedName}-v${schemaData.version}.json`
      const filePath = pathModule.join(workingDir, filename)
      
      if (fsModule.existsSync(filePath)) {
        fsModule.unlinkSync(filePath)
      }
      
      // Create new Schema instance (should load from database)
      const schema = Schema.create(schemaName, { waitForReady: false })
      
      // Wait for schema to load
      await waitForSchemaIdle(schema)

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
      expect(Object.keys(context.models || {})).toHaveLength(internalModelNames.length)
      expect(Array.isArray(models)).toBe(true)
      expect(models.length).toBe(internalModelNames.length)
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
      const schema = Schema.create(schemaName, { waitForReady: false })
      
      // Wait for schema to load
      await waitForSchemaIdle(schema)

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
      expect(Object.keys(context.models || {})).toHaveLength(internalModelNames.length)
      expect(Array.isArray(models)).toBe(true)
      expect(models.length).toBe(internalModelNames.length)
    })

    it('should reference modelInstances when context.models changes', async () => {
      const schemaName = 'Seed Protocol'
      const schemaData = internalSchema as SchemaFileFormat
      
      await importJsonSchema({ contents: JSON.stringify(schemaData) }, schemaData.version)
      
      const schema = Schema.create(schemaName, { waitForReady: false })
      
      // Wait for schema to load
      await waitForSchemaIdle(schema)

      // Check models immediately
      const models1 = schema.models
      expect(Array.isArray(models1)).toBe(true)
      expect(models1.length).toBe(internalModelNames.length)
      
      // Verify that Model instances are referenced (not updated) when context.models changes
      // liveQuery now handles Model instance updates automatically
      const context = schema.getService().getSnapshot().context
      expect(context.models).toBeDefined()
      expect(Object.keys(context.models || {})).toHaveLength(internalModelNames.length)
      
      // Wait a bit and check again (to ensure modelInstances are referenced)
      await new Promise(resolve => setTimeout(resolve, 100))
      
      const models2 = schema.models
      expect(Array.isArray(models2)).toBe(true)
      expect(models2.length).toBe(internalModelNames.length)
      
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

  describe('syncSchemaFromSource idempotency', () => {
    const testSchemaName = 'Test Schema Idempotency'
    const testSchema: SchemaFileFormat = {
      $schema: 'https://seedprotocol.org/schemas/data-model/v1',
      version: 1,
      metadata: {
        name: testSchemaName,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      models: {
        Foo: {
          properties: { title: { dataType: 'text' } },
        },
        Bar: {
          properties: { name: { dataType: 'text' } },
        },
      },
      enums: {},
      migrations: [],
    }

    it('should not create duplicate schemas or models when called twice with same schema', async () => {
      await syncSchemaFromSource(testSchema)
      await syncSchemaFromSource(testSchema)

      const db = BaseDb.getAppDb()
      expect(db).toBeDefined()

      const schemaRows = await db!.select().from(schemas).where(eq(schemas.name, testSchemaName))
      expect(schemaRows.length).toBe(1)

      const schemaId = schemaRows[0].id
      const modelSchemaRows = await db!
        .select()
        .from(modelSchemas)
        .where(eq(modelSchemas.schemaId, schemaId!))
      const modelIds = modelSchemaRows.map((r: { modelId: number | null }) => r.modelId).filter((id: number | null): id is number => id != null)

      const modelRows = await db!.select().from(modelsTable).where(eq(modelsTable.name, 'Foo'))
      expect(modelRows.length).toBe(1)

      const barRows = await db!.select().from(modelsTable).where(eq(modelsTable.name, 'Bar'))
      expect(barRows.length).toBe(1)

      expect(modelIds.length).toBe(2)
    })
  })

  // A schema with pinned schema, model and property ids, as PermaPress ships it. A content change that
  // keeps the id and version maps to the same file path as the device's stored file.
  describe('changed schema with a pinned id', () => {
    const pinnedSchema = (
      schemaId: string,
      schemaName: string,
      modelNames: string[],
      version = 1,
    ): SchemaFileFormat => ({
      $schema: 'https://seedprotocol.org/schemas/data-model/v1',
      id: schemaId,
      version,
      metadata: {
        name: schemaName,
        createdAt: '2026-10-01T00:00:00.000Z',
        updatedAt: '2026-10-01T00:00:00.000Z',
      },
      models: Object.fromEntries(
        modelNames.map((modelName) => [
          modelName,
          {
            id: `${schemaId}${modelName}`.slice(-10),
            properties: { title: { id: `${modelName}title`.slice(-10), dataType: 'Text' } },
          },
        ]),
      ),
      enums: {},
      migrations: [],
    })

    const schemaRowFor = async (schemaName: string) => {
      const rows = await BaseDb.getAppDb()!.select().from(schemas).where(eq(schemas.name, schemaName))
      expect(rows.length).toBe(1)
      return rows[0]
    }

    const linkedModelNames = async (schemaRowId: number): Promise<string[]> => {
      const rows = await BaseDb.getAppDb()!
        .select({ name: modelsTable.name })
        .from(modelSchemas)
        .innerJoin(modelsTable, eq(modelSchemas.modelId, modelsTable.id))
        .where(eq(modelSchemas.schemaId, schemaRowId))
      return rows.map((r: { name: string }) => r.name).sort()
    }

    const schemaFileContent = (schemaId: string, schemaName: string, version: number): SchemaFileFormat => {
      const workingDir = BaseFileManager.getWorkingDir()
      const file = fsModule
        .readdirSync(workingDir)
        .find((f: string) => f.startsWith(`${schemaId}_`) && f.endsWith(`_v${version}.json`))
      expect(file, `schema file for ${schemaName} v${version}`).toBeDefined()
      return JSON.parse(fsModule.readFileSync(pathModule.join(workingDir, file), 'utf8'))
    }

    it('syncSchemaFromSource writes the new content over the stored file of the same id and version', async () => {
      const schemaId = 'pin0000001'
      const schemaName = 'Pinned Sync Schema'
      await syncSchemaFromSource(pinnedSchema(schemaId, schemaName, ['PinArticle', 'PinLink']))
      await syncSchemaFromSource(pinnedSchema(schemaId, schemaName, ['PinArticle', 'PinSection']))

      expect(Object.keys(schemaFileContent(schemaId, schemaName, 1).models).sort()).toEqual([
        'PinArticle',
        'PinSection',
      ])

      const row = await schemaRowFor(schemaName)
      expect(Object.keys(JSON.parse(row.schemaData!).models).sort()).toEqual(['PinArticle', 'PinSection'])
      expect(await linkedModelNames(row.id!)).toEqual(['PinArticle', 'PinSection'])

      expect(Model.getByName('PinSection', schemaName)).toBeDefined()

      const loaded = (await loadAllSchemasFromDb()).find((s) => s.schema.metadata?.name === schemaName)
      expect(Object.keys(loaded!.schema.models).sort()).toEqual(['PinArticle', 'PinSection'])
    })

    it('a new version with the same pinned id unlinks models it removed', async () => {
      const schemaId = 'pin0000002'
      const schemaName = 'Pinned Version Schema'
      await syncSchemaFromSource(pinnedSchema(schemaId, schemaName, ['PinPost', 'PinOldLink']))
      await syncSchemaFromSource(pinnedSchema(schemaId, schemaName, ['PinPost', 'PinClip'], 2))

      const row = await schemaRowFor(schemaName)
      expect(row.version).toBe(2)
      expect(await linkedModelNames(row.id!)).toEqual(['PinClip', 'PinPost'])
    })

    it('importJsonSchema throws instead of loading the stored file when the content differs', async () => {
      const schemaId = 'pin0000003'
      const schemaName = 'Pinned Import Schema'
      await importJsonSchema({ contents: JSON.stringify(pinnedSchema(schemaId, schemaName, ['PinNote'])) })

      await expect(
        importJsonSchema({ contents: JSON.stringify(pinnedSchema(schemaId, schemaName, ['PinNote', 'PinTag'])) }),
      ).rejects.toThrow(/already exists with different content/)

      expect(Object.keys(schemaFileContent(schemaId, schemaName, 1).models)).toEqual(['PinNote'])
    })

    it('reuses the stored file when the content is unchanged', async () => {
      const schemaId = 'pin0000004'
      const schemaName = 'Pinned Unchanged Schema'
      const schema = pinnedSchema(schemaId, schemaName, ['PinPage'])
      await syncSchemaFromSource(schema)
      await syncSchemaFromSource(schema)
      await importJsonSchema({ contents: JSON.stringify(schema) })

      const row = await schemaRowFor(schemaName)
      expect(await linkedModelNames(row.id!)).toEqual(['PinPage'])
    })
  })
})

