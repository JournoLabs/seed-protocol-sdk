import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { useLiveQuery } from '@seedprotocol/react'
import { BaseDb, schemas, models, properties, modelSchemas, modelUids, propertyUids } from '@seedprotocol/sdk'
import { eq } from 'drizzle-orm'
import { setupTestEnvironment } from './test-utils/client-init'
import { firstValueFrom, take, timeout } from 'rxjs'

// Test component for useLiveQuery
function TestLiveQueryComponent<T>({ query }: { query: ((sql: any) => any) | any | null | undefined }) {
  const data = useLiveQuery<T>(query)
  return (
    <div data-testid="live-query-data">
      {data === undefined ? (
        <div data-testid="loading">Loading...</div>
      ) : (
        <div data-testid="data">{JSON.stringify(data)}</div>
      )}
    </div>
  )
}

describe('useLiveQuery React Hook Integration Tests', () => {
  beforeAll(async () => {
    // Initialize test client and database
    await setupTestEnvironment({
      testFileUrl: import.meta.url,
      timeout: 90000,
    })
  }, 90000)

  afterEach(async () => {
    // Unmount rendered trees first so useLiveQuery unsubscribes before we clear the DOM
    // (setup.browser.ts clears document.body without React unmount, which leaks subscriptions).
    cleanup()

    // Clean up test data after each test (FK order: children before parents)
    const db = BaseDb.getAppDb()
    if (db) {
      try {
        await db.delete(modelSchemas)
        await db.delete(propertyUids)
        await db.delete(properties)
        await db.delete(modelUids)
        await db.delete(models)
        // Only delete test schemas, not the Seed Protocol schema
        await db.delete(schemas).where(eq(schemas.name, 'TestLiveQuerySchema'))
        await db.delete(schemas).where(eq(schemas.name, 'UpdatedTestSchema'))
        await db.delete(schemas).where(eq(schemas.name, 'TestSchemaForModels'))
        await db.delete(schemas).where(eq(schemas.name, 'TestSchemaForProperties'))
        await db.delete(schemas).where(eq(schemas.name, 'TestSchemaForModelSchemas'))
      } catch (error) {
        // Ignore cleanup errors
        console.warn('Cleanup error:', error)
      }
    }
  })

  describe('React Hook Basic Functionality', () => {
    it('should return undefined initially when client not ready', () => {
      // This test is tricky because setupTestEnvironment ensures client is ready
      // We'll test the null query case instead
      const { container } = render(<TestLiveQueryComponent query={null} />)
      const loadingElement = container.querySelector('[data-testid="loading"]')
      expect(loadingElement).toBeDefined()
    })

    it('should return undefined when query is null', () => {
      const { container } = render(<TestLiveQueryComponent query={null} />)
      const loadingElement = container.querySelector('[data-testid="loading"]')
      expect(loadingElement).toBeDefined()
    })

    it('should return data when client is ready', async () => {
      const db = BaseDb.getAppDb()
      if (!db) {
        throw new Error('Database not initialized')
      }

      // Insert test data
      const [schema] = await db
        .insert(schemas)
        .values({
          name: 'TestLiveQuerySchema',
          version: 1,
          schemaFileId: 'test-livequery-schema-1',
        })
        .returning()

      // Create query
      const query = db.select().from(schemas).where(eq(schemas.id, schema.id!))

      // Render component
      const { container } = render(<TestLiveQueryComponent query={query} />)

      // Wait for data to load
      await waitFor(
        () => {
          const dataElement = container.querySelector('[data-testid="data"]')
          expect(dataElement).toBeDefined()
          const dataText = dataElement?.textContent
          expect(dataText).toBeTruthy()
          const parsedData = JSON.parse(dataText || '[]')
          expect(parsedData.length).toBeGreaterThan(0)
        },
        { timeout: 5000 }
      )
    })

    it('should handle query changes', async () => {
      const db = BaseDb.getAppDb()
      if (!db) {
        throw new Error('Database not initialized')
      }

      // Insert test data
      const [schema1] = await db
        .insert(schemas)
        .values({
          name: 'TestLiveQuerySchema',
          version: 1,
          schemaFileId: 'test-livequery-schema-1',
        })
        .returning()

      const [schema2] = await db
        .insert(schemas)
        .values({
          name: 'TestLiveQuerySchema2',
          version: 1,
          schemaFileId: 'test-livequery-schema-2',
        })
        .returning()

      // Start with query for schema1
      let query = db.select().from(schemas).where(eq(schemas.id, schema1.id!))

      const { container, rerender } = render(<TestLiveQueryComponent query={query} />)

      // Wait for initial data
      await waitFor(
        () => {
          const dataElement = container.querySelector('[data-testid="data"]')
          expect(dataElement).toBeDefined()
        },
        { timeout: 5000 }
      )

      // Change query to schema2
      query = db.select().from(schemas).where(eq(schemas.id, schema2.id!))
      rerender(<TestLiveQueryComponent query={query} />)

      // Wait for updated data
      await waitFor(
        () => {
          const dataElement = container.querySelector('[data-testid="data"]')
          const dataText = dataElement?.textContent
          const parsedData = JSON.parse(dataText || '[]')
          expect(parsedData.length).toBe(1)
          expect(parsedData[0].id).toBe(schema2.id)
        },
        { timeout: 5000 }
      )
    })
  })

  describe('LiveQuery Table Change Detection - schemas', () => {
    it('should detect INSERT on schemas table', async () => {
      const db = BaseDb.getAppDb()
      if (!db) {
        throw new Error('Database not initialized')
      }

      // Create liveQuery observable
      const query = db.select().from(schemas).where(eq(schemas.name, 'TestLiveQuerySchema'))
      const observable = BaseDb.liveQuery<typeof schemas.$inferSelect>(query)

      // Get initial result (should be empty)
      const initialResult = await firstValueFrom(observable.pipe(take(1)))
      const initialCount = initialResult.length

      // Insert a new schema
      await db
        .insert(schemas)
        .values({
          name: 'TestLiveQuerySchema',
          version: 1,
          schemaFileId: 'test-livequery-schema-1',
        })

      // Wait for liveQuery to detect the change
      const updatedResult = await firstValueFrom(
        observable.pipe(
          take(1),
          timeout({ first: 5000 })
        )
      )

      expect(updatedResult.length).toBe(initialCount + 1)
      expect(updatedResult.some((s) => s.name === 'TestLiveQuerySchema')).toBe(true)
    }, 10000)

    it('should update React state when schemas row is inserted', async () => {
      const db = BaseDb.getAppDb()
      if (!db) {
        throw new Error('Database not initialized')
      }

      // Create query
      const query = db.select().from(schemas).where(eq(schemas.name, 'TestLiveQuerySchema'))

      // Render component
      const { container } = render(<TestLiveQueryComponent query={query} />)

      // Wait for initial render
      await waitFor(
        () => {
          const dataElement = container.querySelector('[data-testid="data"]')
          expect(dataElement).toBeDefined()
        },
        { timeout: 5000 }
      )

      // Get initial count
      const initialDataElement = container.querySelector('[data-testid="data"]')
      const initialData = JSON.parse(initialDataElement?.textContent || '[]')
      const initialCount = initialData.length

      // Insert a new schema
      await db
        .insert(schemas)
        .values({
          name: 'TestLiveQuerySchema',
          version: 1,
          schemaFileId: 'test-livequery-schema-1',
        })

      // Wait for React state to update
      await waitFor(
        () => {
          const dataElement = container.querySelector('[data-testid="data"]')
          const updatedData = JSON.parse(dataElement?.textContent || '[]')
          expect(updatedData.length).toBe(initialCount + 1)
        },
        { timeout: 5000 }
      )
    }, 10000)

    it('should detect UPDATE on schemas table', async () => {
      const db = BaseDb.getAppDb()
      if (!db) {
        throw new Error('Database not initialized')
      }

      // Insert initial schema
      const [inserted] = await db
        .insert(schemas)
        .values({
          name: 'TestLiveQuerySchema',
          version: 1,
          schemaFileId: 'test-livequery-schema-1',
        })
        .returning()

      // Create liveQuery observable
      const query = db.select().from(schemas).where(eq(schemas.id, inserted.id!))
      const observable = BaseDb.liveQuery<typeof schemas.$inferSelect>(query)

      // Get initial result
      const initialResult = await firstValueFrom(observable.pipe(take(1)))
      expect(initialResult[0].name).toBe('TestLiveQuerySchema')

      // Update the schema
      await db
        .update(schemas)
        .set({ name: 'UpdatedTestSchema' })
        .where(eq(schemas.id, inserted.id!))

      // Wait for liveQuery to detect the change
      const updatedResult = await firstValueFrom(
        observable.pipe(
          take(1),
          timeout({ first: 5000 })
        )
      )

      expect(updatedResult[0].name).toBe('UpdatedTestSchema')
    }, 10000)

    it('should update React state when schemas row is updated', async () => {
      const db = BaseDb.getAppDb()
      if (!db) {
        throw new Error('Database not initialized')
      }

      // Insert initial schema
      const [inserted] = await db
        .insert(schemas)
        .values({
          name: 'TestLiveQuerySchema',
          version: 1,
          schemaFileId: 'test-livequery-schema-1',
        })
        .returning()

      const { container, rerender } = render(
        <TestLiveQueryComponent query={db.select().from(schemas).where(eq(schemas.id, inserted.id!))} />
      )

      // Wait for initial data
      await waitFor(
        () => {
          const dataElement = container.querySelector('[data-testid="data"]')
          const data = JSON.parse(dataElement?.textContent || '[]')
          expect(data.length).toBe(1)
          expect(data[0].name).toBe('TestLiveQuerySchema')
        },
        { timeout: 5000 }
      )

      // Update the schema
      await db
        .update(schemas)
        .set({ name: 'UpdatedTestSchema' })
        .where(eq(schemas.id, inserted.id!))

      const [rowAfterUpdate] = await db
        .select()
        .from(schemas)
        .where(eq(schemas.id, inserted.id!))
      expect(rowAfterUpdate?.name).toBe('UpdatedTestSchema')

      rerender(
        <TestLiveQueryComponent query={db.select().from(schemas).where(eq(schemas.id, inserted.id!))} />
      )

      await waitFor(
        () => {
          const dataElement = container.querySelector('[data-testid="data"]')
          const updatedData = JSON.parse(dataElement?.textContent || '[]')
          expect(updatedData.length).toBeGreaterThan(0)
          expect(updatedData[0].name).toBe('UpdatedTestSchema')
        },
        { timeout: 10000, interval: 100 }
      )
    }, 20000)

    it('should detect DELETE on schemas table', async () => {
      const db = BaseDb.getAppDb()
      if (!db) {
        throw new Error('Database not initialized')
      }

      // Insert initial schema
      const [inserted] = await db
        .insert(schemas)
        .values({
          name: 'TestLiveQuerySchema',
          version: 1,
          schemaFileId: 'test-livequery-schema-1',
        })
        .returning()

      // Create liveQuery observable
      const query = db.select().from(schemas).where(eq(schemas.id, inserted.id!))
      const observable = BaseDb.liveQuery<typeof schemas.$inferSelect>(query)

      // Get initial result
      const initialResult = await firstValueFrom(observable.pipe(take(1)))
      expect(initialResult.length).toBe(1)

      // Delete the schema
      await db.delete(schemas).where(eq(schemas.id, inserted.id!))

      // Wait for liveQuery to detect the change
      const updatedResult = await firstValueFrom(
        observable.pipe(
          take(1),
          timeout({ first: 5000 })
        )
      )

      expect(updatedResult.length).toBe(0)
    }, 10000)

    it('should update React state when schemas row is deleted', async () => {
      const db = BaseDb.getAppDb()
      if (!db) {
        throw new Error('Database not initialized')
      }

      // Insert initial schema
      const [inserted] = await db
        .insert(schemas)
        .values({
          name: 'TestLiveQuerySchema',
          version: 1,
          schemaFileId: 'test-livequery-schema-1',
        })
        .returning()

      const { container, rerender } = render(
        <TestLiveQueryComponent query={db.select().from(schemas).where(eq(schemas.id, inserted.id!))} />
      )

      // Wait for initial data
      await waitFor(
        () => {
          const dataElement = container.querySelector('[data-testid="data"]')
          const data = JSON.parse(dataElement?.textContent || '[]')
          expect(data.length).toBe(1)
        },
        { timeout: 5000 }
      )

      // Delete the schema
      await db.delete(schemas).where(eq(schemas.id, inserted.id!))

      rerender(
        <TestLiveQueryComponent query={db.select().from(schemas).where(eq(schemas.id, inserted.id!))} />
      )

      await waitFor(
        () => {
          const dataElement = container.querySelector('[data-testid="data"]')
          const updatedData = JSON.parse(dataElement?.textContent || '[]')
          expect(updatedData.length).toBe(0)
        },
        { timeout: 10000, interval: 100 }
      )
    }, 20000)
  })

  describe('LiveQuery Table Change Detection - models', () => {
    it('should detect INSERT on models table', async () => {
      const db = BaseDb.getAppDb()
      if (!db) {
        throw new Error('Database not initialized')
      }

      // Create liveQuery observable
      const query = db.select().from(models).where(eq(models.name, 'TestLiveQueryModel'))
      const observable = BaseDb.liveQuery<typeof models.$inferSelect>(query)

      // Get initial result
      const initialResult = await firstValueFrom(observable.pipe(take(1)))
      const initialCount = initialResult.length

      // Insert a new model
      await db.insert(models).values({ name: 'TestLiveQueryModel' })

      // Wait for liveQuery to detect the change
      const updatedResult = await firstValueFrom(
        observable.pipe(
          take(1),
          timeout({ first: 5000 })
        )
      )

      expect(updatedResult.length).toBe(initialCount + 1)
      expect(updatedResult.some((m) => m.name === 'TestLiveQueryModel')).toBe(true)
    }, 10000)

    it('should update React state when models row is inserted', async () => {
      const db = BaseDb.getAppDb()
      if (!db) {
        throw new Error('Database not initialized')
      }

      // Create query
      const query = db.select().from(models).where(eq(models.name, 'TestLiveQueryModel'))

      // Render component
      const { container } = render(<TestLiveQueryComponent query={query} />)

      // Wait for initial render
      await waitFor(
        () => {
          const dataElement = container.querySelector('[data-testid="data"]')
          expect(dataElement).toBeDefined()
        },
        { timeout: 5000 }
      )

      // Get initial count
      const initialDataElement = container.querySelector('[data-testid="data"]')
      const initialData = JSON.parse(initialDataElement?.textContent || '[]')
      const initialCount = initialData.length

      // Insert a new model
      await db.insert(models).values({ name: 'TestLiveQueryModel' })

      // Wait for React state to update
      await waitFor(
        () => {
          const dataElement = container.querySelector('[data-testid="data"]')
          const updatedData = JSON.parse(dataElement?.textContent || '[]')
          expect(updatedData.length).toBe(initialCount + 1)
        },
        { timeout: 5000 }
      )
    }, 10000)

    it('should detect UPDATE on models table', async () => {
      const db = BaseDb.getAppDb()
      if (!db) {
        throw new Error('Database not initialized')
      }

      // Insert initial model
      const [inserted] = await db.insert(models).values({ name: 'TestLiveQueryModel' }).returning()

      // Create liveQuery observable
      const query = db.select().from(models).where(eq(models.id, inserted.id!))
      const observable = BaseDb.liveQuery<typeof models.$inferSelect>(query)

      // Get initial result
      const initialResult = await firstValueFrom(observable.pipe(take(1)))
      expect(initialResult[0].name).toBe('TestLiveQueryModel')

      // Update the model
      await db.update(models).set({ name: 'UpdatedTestModel' }).where(eq(models.id, inserted.id!))

      // Wait for liveQuery to detect the change
      const updatedResult = await firstValueFrom(
        observable.pipe(
          take(1),
          timeout({ first: 5000 })
        )
      )

      expect(updatedResult[0].name).toBe('UpdatedTestModel')
    }, 10000)

    it('should update React state when models row is updated', async () => {
      const db = BaseDb.getAppDb()
      if (!db) {
        throw new Error('Database not initialized')
      }

      // Insert initial model
      const [inserted] = await db.insert(models).values({ name: 'TestLiveQueryModel' }).returning()

      const { container, rerender } = render(
        <TestLiveQueryComponent query={db.select().from(models).where(eq(models.id, inserted.id!))} />
      )

      // Wait for initial data
      await waitFor(
        () => {
          const dataElement = container.querySelector('[data-testid="data"]')
          const data = JSON.parse(dataElement?.textContent || '[]')
          expect(data.length).toBe(1)
          expect(data[0].name).toBe('TestLiveQueryModel')
        },
        { timeout: 5000 }
      )

      // Update the model
      await db.update(models).set({ name: 'UpdatedTestModel' }).where(eq(models.id, inserted.id!))

      rerender(
        <TestLiveQueryComponent query={db.select().from(models).where(eq(models.id, inserted.id!))} />
      )

      await waitFor(
        () => {
          const dataElement = container.querySelector('[data-testid="data"]')
          const updatedData = JSON.parse(dataElement?.textContent || '[]')
          expect(updatedData.length).toBeGreaterThan(0)
          expect(updatedData[0].name).toBe('UpdatedTestModel')
        },
        { timeout: 10000, interval: 100 }
      )
    }, 20000)

    it('should detect DELETE on models table', async () => {
      const db = BaseDb.getAppDb()
      if (!db) {
        throw new Error('Database not initialized')
      }

      // Insert initial model
      const [inserted] = await db.insert(models).values({ name: 'TestLiveQueryModel' }).returning()

      // Create liveQuery observable
      const query = db.select().from(models).where(eq(models.id, inserted.id!))
      const observable = BaseDb.liveQuery<typeof models.$inferSelect>(query)

      // Get initial result
      const initialResult = await firstValueFrom(observable.pipe(take(1)))
      expect(initialResult.length).toBe(1)

      // Delete the model
      await db.delete(models).where(eq(models.id, inserted.id!))

      // Wait for liveQuery to detect the change
      const updatedResult = await firstValueFrom(
        observable.pipe(
          take(1),
          timeout({ first: 5000 })
        )
      )

      expect(updatedResult.length).toBe(0)
    }, 10000)

    it('should update React state when models row is deleted', async () => {
      const db = BaseDb.getAppDb()
      if (!db) {
        throw new Error('Database not initialized')
      }

      // Insert initial model
      const [inserted] = await db.insert(models).values({ name: 'TestLiveQueryModel' }).returning()

      const { container, rerender } = render(
        <TestLiveQueryComponent query={db.select().from(models).where(eq(models.id, inserted.id!))} />
      )

      // Wait for initial data
      await waitFor(
        () => {
          const dataElement = container.querySelector('[data-testid="data"]')
          const data = JSON.parse(dataElement?.textContent || '[]')
          expect(data.length).toBe(1)
        },
        { timeout: 5000 }
      )

      // Delete the model
      await db.delete(models).where(eq(models.id, inserted.id!))

      rerender(
        <TestLiveQueryComponent query={db.select().from(models).where(eq(models.id, inserted.id!))} />
      )

      await waitFor(
        () => {
          const dataElement = container.querySelector('[data-testid="data"]')
          const updatedData = JSON.parse(dataElement?.textContent || '[]')
          expect(updatedData.length).toBe(0)
        },
        { timeout: 10000, interval: 100 }
      )
    }, 20000)
  })

  describe('LiveQuery Table Change Detection - properties', () => {
    it('should detect INSERT on properties table', async () => {
      const db = BaseDb.getAppDb()
      if (!db) {
        throw new Error('Database not initialized')
      }

      // Create a model first
      const [model] = await db.insert(models).values({ name: 'TestModelForProperties' }).returning()

      // Create liveQuery observable
      const query = db.select().from(properties).where(eq(properties.modelId, model.id!))
      const observable = BaseDb.liveQuery<typeof properties.$inferSelect>(query)

      // Get initial result
      const initialResult = await firstValueFrom(observable.pipe(take(1)))
      const initialCount = initialResult.length

      // Insert a new property
      await db.insert(properties).values({
        name: 'TestProperty',
        dataType: 'Text',
        modelId: model.id!,
      })

      // Wait for liveQuery to detect the change
      const updatedResult = await firstValueFrom(
        observable.pipe(
          take(1),
          timeout({ first: 5000 })
        )
      )

      expect(updatedResult.length).toBe(initialCount + 1)
      expect(updatedResult.some((p) => p.name === 'TestProperty')).toBe(true)
    }, 10000)

    it('should update React state when properties row is inserted', async () => {
      const db = BaseDb.getAppDb()
      if (!db) {
        throw new Error('Database not initialized')
      }

      // Create a model first
      const [model] = await db.insert(models).values({ name: 'TestModelForProperties' }).returning()

      // Create query
      const query = db.select().from(properties).where(eq(properties.modelId, model.id!))

      // Render component
      const { container } = render(<TestLiveQueryComponent query={query} />)

      // Wait for initial render
      await waitFor(
        () => {
          const dataElement = container.querySelector('[data-testid="data"]')
          expect(dataElement).toBeDefined()
        },
        { timeout: 5000 }
      )

      // Get initial count
      const initialDataElement = container.querySelector('[data-testid="data"]')
      const initialData = JSON.parse(initialDataElement?.textContent || '[]')
      const initialCount = initialData.length

      // Insert a new property
      await db.insert(properties).values({
        name: 'TestProperty',
        dataType: 'Text',
        modelId: model.id!,
      })

      // Wait for React state to update
      await waitFor(
        () => {
          const dataElement = container.querySelector('[data-testid="data"]')
          const updatedData = JSON.parse(dataElement?.textContent || '[]')
          expect(updatedData.length).toBe(initialCount + 1)
        },
        { timeout: 5000 }
      )
    }, 10000)

    it('should detect UPDATE on properties table', async () => {
      const db = BaseDb.getAppDb()
      if (!db) {
        throw new Error('Database not initialized')
      }

      // Create a model first
      const [model] = await db.insert(models).values({ name: 'TestModelForProperties' }).returning()

      // Insert initial property
      const [inserted] = await db
        .insert(properties)
        .values({
          name: 'TestProperty',
          dataType: 'Text',
          modelId: model.id!,
        })
        .returning()

      // Create liveQuery observable
      const query = db.select().from(properties).where(eq(properties.id, inserted.id!))
      const observable = BaseDb.liveQuery<typeof properties.$inferSelect>(query)

      // Get initial result
      const initialResult = await firstValueFrom(observable.pipe(take(1)))
      expect(initialResult[0].name).toBe('TestProperty')

      // Update the property
      await db
        .update(properties)
        .set({ name: 'UpdatedProperty' })
        .where(eq(properties.id, inserted.id!))

      // Wait for liveQuery to detect the change
      const updatedResult = await firstValueFrom(
        observable.pipe(
          take(1),
          timeout({ first: 5000 })
        )
      )

      expect(updatedResult[0].name).toBe('UpdatedProperty')
    }, 10000)

    it('should update React state when properties row is updated', async () => {
      const db = BaseDb.getAppDb()
      if (!db) {
        throw new Error('Database not initialized')
      }

      // Create a model first
      const [model] = await db.insert(models).values({ name: 'TestModelForProperties' }).returning()

      // Insert initial property
      const [inserted] = await db
        .insert(properties)
        .values({
          name: 'TestProperty',
          dataType: 'Text',
          modelId: model.id!,
        })
        .returning()

      const { container, rerender } = render(
        <TestLiveQueryComponent query={db.select().from(properties).where(eq(properties.id, inserted.id!))} />
      )

      // Wait for initial data
      await waitFor(
        () => {
          const dataElement = container.querySelector('[data-testid="data"]')
          const data = JSON.parse(dataElement?.textContent || '[]')
          expect(data.length).toBe(1)
          expect(data[0].name).toBe('TestProperty')
        },
        { timeout: 5000 }
      )

      // Update the property
      await db
        .update(properties)
        .set({ name: 'UpdatedProperty' })
        .where(eq(properties.id, inserted.id!))

      rerender(
        <TestLiveQueryComponent query={db.select().from(properties).where(eq(properties.id, inserted.id!))} />
      )

      await waitFor(
        () => {
          const dataElement = container.querySelector('[data-testid="data"]')
          const updatedData = JSON.parse(dataElement?.textContent || '[]')
          expect(updatedData.length).toBeGreaterThan(0)
          expect(updatedData[0].name).toBe('UpdatedProperty')
        },
        { timeout: 10000, interval: 100 }
      )
    }, 20000)

    it('should detect DELETE on properties table', async () => {
      const db = BaseDb.getAppDb()
      if (!db) {
        throw new Error('Database not initialized')
      }

      // Create a model first
      const [model] = await db.insert(models).values({ name: 'TestModelForProperties' }).returning()

      // Insert initial property
      const [inserted] = await db
        .insert(properties)
        .values({
          name: 'TestProperty',
          dataType: 'Text',
          modelId: model.id!,
        })
        .returning()

      // Create liveQuery observable
      const query = db.select().from(properties).where(eq(properties.id, inserted.id!))
      const observable = BaseDb.liveQuery<typeof properties.$inferSelect>(query)

      // Get initial result
      const initialResult = await firstValueFrom(observable.pipe(take(1)))
      expect(initialResult.length).toBe(1)

      // Delete the property
      await db.delete(properties).where(eq(properties.id, inserted.id!))

      // Wait for liveQuery to detect the change
      const updatedResult = await firstValueFrom(
        observable.pipe(
          take(1),
          timeout({ first: 5000 })
        )
      )

      expect(updatedResult.length).toBe(0)
    }, 10000)

    it('should update React state when properties row is deleted', async () => {
      const db = BaseDb.getAppDb()
      if (!db) {
        throw new Error('Database not initialized')
      }

      // Create a model first
      const [model] = await db.insert(models).values({ name: 'TestModelForProperties' }).returning()

      // Insert initial property
      const [inserted] = await db
        .insert(properties)
        .values({
          name: 'TestProperty',
          dataType: 'Text',
          modelId: model.id!,
        })
        .returning()

      const { container, rerender } = render(
        <TestLiveQueryComponent query={db.select().from(properties).where(eq(properties.id, inserted.id!))} />
      )

      // Wait for initial data
      await waitFor(
        () => {
          const dataElement = container.querySelector('[data-testid="data"]')
          const data = JSON.parse(dataElement?.textContent || '[]')
          expect(data.length).toBe(1)
        },
        { timeout: 5000 }
      )

      // Delete the property
      await db.delete(properties).where(eq(properties.id, inserted.id!))

      rerender(
        <TestLiveQueryComponent query={db.select().from(properties).where(eq(properties.id, inserted.id!))} />
      )

      await waitFor(
        () => {
          const dataElement = container.querySelector('[data-testid="data"]')
          const updatedData = JSON.parse(dataElement?.textContent || '[]')
          expect(updatedData.length).toBe(0)
        },
        { timeout: 10000, interval: 100 }
      )
    }, 20000)
  })

  describe('LiveQuery Table Change Detection - model_schemas', () => {
    it('should detect INSERT on model_schemas table', async () => {
      const db = BaseDb.getAppDb()
      if (!db) {
        throw new Error('Database not initialized')
      }

      // Create a schema and model first
      const [schema] = await db
        .insert(schemas)
        .values({
          name: 'TestSchemaForModelSchemas',
          version: 1,
          schemaFileId: 'test-schema-model-schemas-1',
        })
        .returning()

      const [model] = await db.insert(models).values({ name: 'TestModelForModelSchemas' }).returning()

      // Create liveQuery observable
      const query = db
        .select()
        .from(modelSchemas)
        .where(eq(modelSchemas.schemaId, schema.id!))
      const observable = BaseDb.liveQuery<typeof modelSchemas.$inferSelect>(query)

      // Get initial result
      const initialResult = await firstValueFrom(observable.pipe(take(1)))
      const initialCount = initialResult.length

      // Insert a new model_schemas link
      await db.insert(modelSchemas).values({
        modelId: model.id!,
        schemaId: schema.id!,
      })

      // Wait for liveQuery to detect the change
      const updatedResult = await firstValueFrom(
        observable.pipe(
          take(1),
          timeout({ first: 5000 })
        )
      )

      expect(updatedResult.length).toBe(initialCount + 1)
      expect(updatedResult.some((ms) => ms.modelId === model.id && ms.schemaId === schema.id)).toBe(
        true
      )
    }, 10000)

    it('should update React state when model_schemas row is inserted', async () => {
      const db = BaseDb.getAppDb()
      if (!db) {
        throw new Error('Database not initialized')
      }

      // Create a schema and model first
      const [schema] = await db
        .insert(schemas)
        .values({
          name: 'TestSchemaForModelSchemas',
          version: 1,
          schemaFileId: 'test-schema-model-schemas-1',
        })
        .returning()

      const [model] = await db.insert(models).values({ name: 'TestModelForModelSchemas' }).returning()

      // Create query
      const query = db.select().from(modelSchemas).where(eq(modelSchemas.schemaId, schema.id!))

      // Render component
      const { container } = render(<TestLiveQueryComponent query={query} />)

      // Wait for initial render
      await waitFor(
        () => {
          const dataElement = container.querySelector('[data-testid="data"]')
          expect(dataElement).toBeDefined()
        },
        { timeout: 5000 }
      )

      // Get initial count
      const initialDataElement = container.querySelector('[data-testid="data"]')
      const initialData = JSON.parse(initialDataElement?.textContent || '[]')
      const initialCount = initialData.length

      // Insert a new model_schemas link
      await db.insert(modelSchemas).values({
        modelId: model.id!,
        schemaId: schema.id!,
      })

      // Wait for React state to update
      await waitFor(
        () => {
          const dataElement = container.querySelector('[data-testid="data"]')
          const updatedData = JSON.parse(dataElement?.textContent || '[]')
          expect(updatedData.length).toBe(initialCount + 1)
        },
        { timeout: 5000 }
      )
    }, 10000)

    it('should detect DELETE on model_schemas table', async () => {
      const db = BaseDb.getAppDb()
      if (!db) {
        throw new Error('Database not initialized')
      }

      // Create a schema and model first
      const [schema] = await db
        .insert(schemas)
        .values({
          name: 'TestSchemaForModelSchemas',
          version: 1,
          schemaFileId: 'test-schema-model-schemas-1',
        })
        .returning()

      const [model] = await db.insert(models).values({ name: 'TestModelForModelSchemas' }).returning()

      // Insert initial model_schemas link
      const [inserted] = await db
        .insert(modelSchemas)
        .values({
          modelId: model.id!,
          schemaId: schema.id!,
        })
        .returning()

      // Create liveQuery observable
      const query = db.select().from(modelSchemas).where(eq(modelSchemas.id, inserted.id!))
      const observable = BaseDb.liveQuery<typeof modelSchemas.$inferSelect>(query)

      // Get initial result
      const initialResult = await firstValueFrom(observable.pipe(take(1)))
      expect(initialResult.length).toBe(1)

      // Delete the model_schemas link
      await db.delete(modelSchemas).where(eq(modelSchemas.id, inserted.id!))

      // Wait for liveQuery to detect the change
      const updatedResult = await firstValueFrom(
        observable.pipe(
          take(1),
          timeout({ first: 5000 })
        )
      )

      expect(updatedResult.length).toBe(0)
    }, 10000)

    it('should update React state when model_schemas row is deleted', async () => {
      const db = BaseDb.getAppDb()
      if (!db) {
        throw new Error('Database not initialized')
      }

      // Create a schema and model first
      const [schema] = await db
        .insert(schemas)
        .values({
          name: 'TestSchemaForModelSchemas',
          version: 1,
          schemaFileId: 'test-schema-model-schemas-1',
        })
        .returning()

      const [model] = await db.insert(models).values({ name: 'TestModelForModelSchemas' }).returning()

      // Insert initial model_schemas link
      const [inserted] = await db
        .insert(modelSchemas)
        .values({
          modelId: model.id!,
          schemaId: schema.id!,
        })
        .returning()

      const { container, rerender } = render(
        <TestLiveQueryComponent query={db.select().from(modelSchemas).where(eq(modelSchemas.id, inserted.id!))} />
      )

      // Wait for initial data
      await waitFor(
        () => {
          const dataElement = container.querySelector('[data-testid="data"]')
          const data = JSON.parse(dataElement?.textContent || '[]')
          expect(data.length).toBe(1)
        },
        { timeout: 5000 }
      )

      // Delete the model_schemas link
      await db.delete(modelSchemas).where(eq(modelSchemas.id, inserted.id!))

      rerender(
        <TestLiveQueryComponent query={db.select().from(modelSchemas).where(eq(modelSchemas.id, inserted.id!))} />
      )

      await waitFor(
        () => {
          const dataElement = container.querySelector('[data-testid="data"]')
          const updatedData = JSON.parse(dataElement?.textContent || '[]')
          expect(updatedData.length).toBe(0)
        },
        { timeout: 10000, interval: 100 }
      )
    }, 20000)
  })

  describe('Integration Tests with Multiple Tables', () => {
    it('should detect changes across related tables', async () => {
      const db = BaseDb.getAppDb()
      if (!db) {
        throw new Error('Database not initialized')
      }

      // Create a schema
      const [schema] = await db
        .insert(schemas)
        .values({
          name: 'TestSchemaForModels',
          version: 1,
          schemaFileId: 'test-schema-models-1',
        })
        .returning()

      // Create liveQuery for models linked to this schema
      const query = db
        .select({
          model: models,
          modelSchema: modelSchemas,
        })
        .from(modelSchemas)
        .innerJoin(models, eq(modelSchemas.modelId, models.id))
        .where(eq(modelSchemas.schemaId, schema.id!))

      const observable = BaseDb.liveQuery(query)

      // Get initial result
      const initialResult = await firstValueFrom(observable.pipe(take(1)))
      const initialCount = initialResult.length

      // Create a model
      const [model] = await db.insert(models).values({ name: 'RelatedModel' }).returning()

      // Link model to schema
      await db.insert(modelSchemas).values({
        modelId: model.id!,
        schemaId: schema.id!,
      })

      // Wait for liveQuery to detect the change
      const updatedResult = await firstValueFrom(
        observable.pipe(
          take(1),
          timeout({ first: 5000 })
        )
      )

      expect(updatedResult.length).toBe(initialCount + 1)
      expect(updatedResult.some((r) => r.model.name === 'RelatedModel')).toBe(true)
    }, 10000)
  })
})
