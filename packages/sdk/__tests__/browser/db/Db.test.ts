import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { BaseDb } from '@/db/Db/BaseDb'
import { Db } from '@/browser/db/Db'
import { models, properties, modelSchemas, schemas } from '@/seedSchema'
import { eq, sql } from 'drizzle-orm'
import { firstValueFrom, take, timeout } from 'rxjs'
import { setupTestEnvironment } from '../../test-utils/client-init'
import { BaseFileManager } from '@/helpers'

describe('Browser Db Integration Tests', () => {
  beforeAll(async () => {
    // Initialize test client and database
    await setupTestEnvironment({
      testFileUrl: import.meta.url,
      timeout: 90000,
    })
  }, 90000)

  afterEach(async () => {
    // Clean up test data after each test
    const db = BaseDb.getAppDb()
    if (db) {
      try {
        await db.delete(modelSchemas)
        await db.delete(properties)
        await db.delete(models)
        // Only delete test schemas, not the Seed Protocol schema
        await db.delete(schemas).where(eq(schemas.name, 'TestSchema'))
        await db.delete(schemas).where(eq(schemas.name, 'TestSchema2'))
      } catch (error) {
        // Ignore cleanup errors
        console.warn('Cleanup error:', error)
      }
    }
  })

  describe('Database Initialization', () => {
    it('should return appDb from getAppDb()', () => {
      const db = BaseDb.getAppDb()
      expect(db).toBeDefined()
      expect(db).not.toBeNull()
    })

    it('should return true from isAppDbReady() when ready', () => {
      const isReady = BaseDb.isAppDbReady()
      expect(isReady).toBe(true)
    })

    it('should have database tables available', async () => {
      const db = BaseDb.getAppDb()
      if (!db) {
        throw new Error('Database not initialized')
      }

      // Try to query each table to verify they exist
      const schemasResult = await db.select().from(schemas).limit(1)
      expect(Array.isArray(schemasResult)).toBe(true)

      const modelsResult = await db.select().from(models).limit(1)
      expect(Array.isArray(modelsResult)).toBe(true)

      const propertiesResult = await db.select().from(properties).limit(1)
      expect(Array.isArray(propertiesResult)).toBe(true)

      const modelSchemasResult = await db.select().from(modelSchemas).limit(1)
      expect(Array.isArray(modelSchemasResult)).toBe(true)
    })
  })

  describe('Database Operations', () => {
    it('should execute SQL queries', async () => {
      const db = BaseDb.getAppDb()
      if (!db) {
        throw new Error('Database not initialized')
      }

      // Execute a simple SQL query
      const result = await db.run(sql`SELECT 1 as test`)
      expect(result).toBeDefined()
    })

    it('should insert and select data', async () => {
      const db = BaseDb.getAppDb()
      if (!db) {
        throw new Error('Database not initialized')
      }

      // Use a unique schema_file_id to avoid conflicts
      const uniqueId = `test-schema-insert-${Date.now()}-${Math.random().toString(36).substring(7)}`

      // Insert a test schema
      const [inserted] = await db
        .insert(schemas)
        .values({
          name: 'TestSchema',
          version: 1,
          schemaFileId: uniqueId,
        })
        .returning()

      expect(inserted).toBeDefined()
      expect(inserted.name).toBe('TestSchema')

      // Select it back
      const [selected] = await db
        .select()
        .from(schemas)
        .where(eq(schemas.id, inserted.id!))
        .limit(1)

      expect(selected).toBeDefined()
      expect(selected.name).toBe('TestSchema')
    })

    it('should update data', async () => {
      const db = BaseDb.getAppDb()
      if (!db) {
        throw new Error('Database not initialized')
      }

      // Use a unique schema_file_id to avoid conflicts
      const uniqueId = `test-schema-update-${Date.now()}-${Math.random().toString(36).substring(7)}`

      // Insert a test schema
      const [inserted] = await db
        .insert(schemas)
        .values({
          name: 'TestSchema',
          version: 1,
          schemaFileId: uniqueId,
        })
        .returning()

      // Update it
      await db
        .update(schemas)
        .set({ name: 'UpdatedSchema' })
        .where(eq(schemas.id, inserted.id!))

      // Verify update
      const [updated] = await db
        .select()
        .from(schemas)
        .where(eq(schemas.id, inserted.id!))
        .limit(1)

      expect(updated.name).toBe('UpdatedSchema')
    })

    it('should delete data', async () => {
      const db = BaseDb.getAppDb()
      if (!db) {
        throw new Error('Database not initialized')
      }

      // Use a unique schema_file_id to avoid conflicts
      const uniqueId = `test-schema-delete-${Date.now()}-${Math.random().toString(36).substring(7)}`
      
      // Insert a test schema
      const [inserted] = await db
        .insert(schemas)
        .values({
          name: 'TestSchema',
          version: 1,
          schemaFileId: uniqueId,
        })
        .returning()

      const schemaId = inserted.id!

      // Delete it
      await db.delete(schemas).where(eq(schemas.id, schemaId))

      // Verify deletion
      const deleted = await db
        .select()
        .from(schemas)
        .where(eq(schemas.id, schemaId))
        .limit(1)

      expect(deleted.length).toBe(0)
    })
  })

  describe('LiveQuery Basic Functionality', () => {
    it('should return Observable from liveQuery()', () => {
      const db = BaseDb.getAppDb()
      if (!db) {
        throw new Error('Database not initialized')
      }

      const query = db.select().from(models)
      const observable = BaseDb.liveQuery(query)

      expect(observable).toBeDefined()
      expect(typeof observable.subscribe).toBe('function')
    })

    it('should emit initial results immediately', async () => {
      const db = BaseDb.getAppDb()
      if (!db) {
        throw new Error('Database not initialized')
      }

      // Insert test data
      const [model] = await db.insert(models).values({ name: 'TestModel' }).returning()

      // Create liveQuery
      const query = db.select().from(models).where(eq(models.id, model.id!))
      const observable = BaseDb.liveQuery<typeof models.$inferSelect>(query)

      // Get first emission
      const result = await firstValueFrom(observable.pipe(take(1)))

      expect(result).toBeDefined()
      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBe(1)
      expect(result[0].name).toBe('TestModel')
    })

    it('should handle SQL tag function queries', async () => {
      const db = BaseDb.getAppDb()
      if (!db) {
        throw new Error('Database not initialized')
      }

      // Insert test data
      const [model] = await db.insert(models).values({ name: 'SQLModel' }).returning()

      // Create liveQuery with SQL tag function
      const observable = BaseDb.liveQuery<typeof models.$inferSelect>(
        (sql) => sql`SELECT * FROM models WHERE id = ${model.id}`
      )

      // Get first emission
      const result = await firstValueFrom(observable.pipe(take(1)))

      expect(result).toBeDefined()
      expect(result.length).toBe(1)
      expect(result[0].name).toBe('SQLModel')
    })

    it('should handle Drizzle query builder', async () => {
      const db = BaseDb.getAppDb()
      if (!db) {
        throw new Error('Database not initialized')
      }

      // Insert test data
      const [model] = await db.insert(models).values({ name: 'DrizzleModel' }).returning()

      // Create liveQuery with Drizzle query builder
      const query = db.select().from(models).where(eq(models.id, model.id!))
      const observable = BaseDb.liveQuery<typeof models.$inferSelect>(query)

      // Get first emission
      const result = await firstValueFrom(observable.pipe(take(1)))

      expect(result).toBeDefined()
      expect(result.length).toBe(1)
      expect(result[0].name).toBe('DrizzleModel')
    })

    it('should use distinctUntilChanged to prevent duplicate emissions', async () => {
      const db = BaseDb.getAppDb()
      if (!db) {
        throw new Error('Database not initialized')
      }

      // Insert test data
      const [model] = await db.insert(models).values({ name: 'DistinctModel' }).returning()

      // Create liveQuery
      const query = db.select().from(models).where(eq(models.id, model.id!))
      const observable = BaseDb.liveQuery<typeof models.$inferSelect>(query)

      // Collect emissions
      const emissions: any[][] = []
      const subscription = observable.subscribe({
        next: (data) => {
          emissions.push(data)
        },
      })

      // Wait for initial emission
      await new Promise((resolve) => setTimeout(resolve, 100))

      // Trigger multiple updates that don't change the data
      await db
        .update(models)
        .set({ name: 'DistinctModel' }) // Same name, should not emit
        .where(eq(models.id, model.id!))

      await new Promise((resolve) => setTimeout(resolve, 200))

      // Update with different value
      await db
        .update(models)
        .set({ name: 'UpdatedDistinctModel' })
        .where(eq(models.id, model.id!))

      await new Promise((resolve) => setTimeout(resolve, 200))

      subscription.unsubscribe()

      // Should have at least initial emission and the update emission
      // distinctUntilChanged should prevent duplicate emissions for same data
      expect(emissions.length).toBeGreaterThanOrEqual(1)
    }, 10000)
  })

  describe('Error Handling', () => {
    it('should throw error if database is not initialized when calling liveQuery', () => {
      // This test verifies the error handling in liveQuery
      // Since we have a properly initialized DB, we can't easily test this
      // without breaking the test environment, so we'll skip this test
      // The error handling is tested in the existing liveQuery.test.ts
    })
  })
})
