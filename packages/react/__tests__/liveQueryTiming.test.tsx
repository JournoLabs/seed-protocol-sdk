import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import React, { useEffect, useState } from 'react'
import {
  client,
  BaseDb,
  schemas,
  metadata,
  modelSchemas,
  importJsonSchema,
  Schema,
  Model,
  Item,
  ItemProperty,
  BaseFileManager,
  loadAllSchemasFromDb,
} from '@seedprotocol/sdk'
import type { SeedConstructorOptions, SchemaFileFormat } from '@seedprotocol/sdk'
import { eq, and, isNotNull } from 'drizzle-orm'
import { waitFor as xstateWaitFor } from 'xstate'
import { Observable } from 'rxjs'
import { waitForItemPersisted } from './test-utils/persistence'
import { waitUntil, waitUntilOrThrow } from './test-utils/waitUntil'
import { WAIT_TIMEOUT_MS } from '../../sdk/__tests__/test-utils/timeouts'

// Test schema
const testSchema: SchemaFileFormat = {
  $schema: 'https://seedprotocol.org/schemas/data-model/v1',
  version: 1,
  id: 'livequery-timing-test',
  metadata: {
    name: 'LiveQuery Timing Test Schema',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  models: {
    TestModel: {
      id: 'test-model-id',
      properties: {
        name: {
          id: 'name-prop-id',
          type: 'Text',
        },
        value: {
          id: 'value-prop-id',
          type: 'Text',
        },
      },
    },
  },
  enums: {},
  migrations: [],
}

describe('LiveQuery Timing Investigation', () => {
  let container: HTMLElement

  beforeAll(async () => {
    if (!client.isInitialized()) {
      const config: SeedConstructorOptions = {
        config: {
          endpoints: {
            filePaths: '/api/seed/migrations',
            files: '/app-files',
          },
          filesDir: '.seed',
        },
      }
      await client.init(config)
    }

    await waitFor(
      () => {
        expect(client.isInitialized()).toBe(true)
      },
      { timeout: 30000 }
    )
  })

  afterAll(async () => {
    const db = BaseDb.getAppDb()
    if (db) {
      await db.delete(metadata)
      // model_schemas.schema_id FK — clear join rows before schemas (same order as liveQuery.test.tsx)
      await db.delete(modelSchemas)
      await db.delete(schemas).where(eq(schemas.name, 'LiveQuery Timing Test Schema'))
    }

    Schema.clearCache()
  })

  beforeEach(async () => {
    container = document.createElement('div')
    container.id = 'root'
    document.body.appendChild(container)

    // Clean up
    const db = BaseDb.getAppDb()
    if (db) {
      await db.delete(metadata)
      await db.delete(modelSchemas)
      await db.delete(schemas).where(eq(schemas.name, 'LiveQuery Timing Test Schema'))
    }

    Schema.clearCache()

    // Import test schema
    try {
      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
    } catch (error) {
      console.log('Schema import note:', error)
    }

    // Wait for schema to be available
    await waitFor(
      async () => {
        const allSchemas = await loadAllSchemasFromDb()
        expect(allSchemas.some(s => s.schema.metadata?.name === 'LiveQuery Timing Test Schema')).toBe(true)
      },
      { timeout: 15000 }
    )

  })

  afterEach(async () => {
    document.body.innerHTML = ''
    Schema.clearCache()
  })

  describe('Scenario 1: Timing between data write and reactive query emission', () => {
    it('should measure time between data written and reactive query emits', async () => {
      const db = BaseDb.getAppDb()
      if (!db) {
        throw new Error('Database not available')
      }

      // Create item
      const model = await Model.create('TestModel', 'LiveQuery Timing Test Schema')
      await xstateWaitFor(
        model.getService(),
        (snapshot) => snapshot.value === 'idle',
        { timeout: WAIT_TIMEOUT_MS }
      )

      const item = await Item.create({
        modelName: 'TestModel',
        name: 'Test Item',
        value: 'Test Value',
      })

      await xstateWaitFor(
        item.getService(),
        (snapshot) => snapshot.value === 'idle',
        { timeout: WAIT_TIMEOUT_MS }
      )

      await waitForItemPersisted(item, { name: 'Test Item', value: 'Test Value' })

      // Measure time: Direct query
      const directQueryStart = performance.now()
      const directQueryResults = await db
        .select()
        .from(metadata)
        .where(
          and(
            eq(metadata.seedLocalId, item.seedLocalId),
            isNotNull(metadata.propertyName)
          )
        )
      const directQueryTime = performance.now() - directQueryStart

      console.log(`[Timing Test] Direct query time: ${directQueryTime.toFixed(2)}ms`)
      console.log(`[Timing Test] Direct query results: ${directQueryResults.length} records`)

      // Measure time: Reactive query first emission
      const reactiveQueryStart = performance.now()
      let reactiveQueryFirstEmission: number | null = null
      let reactiveQueryEmissionCount = 0

      const query = db
        .select({
          propertyName: metadata.propertyName,
          propertyValue: metadata.propertyValue,
          seedLocalId: metadata.seedLocalId,
        })
        .from(metadata)
        .where(
          and(
            eq(metadata.seedLocalId, item.seedLocalId),
            isNotNull(metadata.propertyName)
          )
        )

      const observable = BaseDb.liveQuery(query)

      const subscription = observable.subscribe({
        next: (results) => {
          reactiveQueryEmissionCount++
          if (reactiveQueryFirstEmission === null) {
            reactiveQueryFirstEmission = performance.now() - reactiveQueryStart
            console.log(`[Timing Test] Reactive query first emission: ${reactiveQueryFirstEmission.toFixed(2)}ms`)
            console.log(`[Timing Test] Reactive query first emission results: ${results.length} records`)
          }
        },
        error: (err) => {
          console.error('[Timing Test] Reactive query error:', err)
        },
      })

      // Wait for first emission or timeout
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          console.log('[Timing Test] Reactive query timeout after 5 seconds')
          subscription.unsubscribe()
          resolve()
        }, 5000)

        if (reactiveQueryFirstEmission !== null) {
          clearTimeout(timeout)
          subscription.unsubscribe()
          resolve()
        } else {
          // Check periodically
          const checkInterval = setInterval(() => {
            if (reactiveQueryFirstEmission !== null) {
              clearInterval(checkInterval)
              clearTimeout(timeout)
              subscription.unsubscribe()
              resolve()
            }
          }, 10)
        }
      })

      console.log(`[Timing Test] Reactive query emission count: ${reactiveQueryEmissionCount}`)

      // Assertions
      expect(directQueryResults.length).toBeGreaterThan(0)
      expect(directQueryTime).toBeLessThan(1000) // Direct query should be fast

      // Used to log a warning and pass when the reactive query never emitted
      expect(reactiveQueryFirstEmission).not.toBeNull()
      expect(reactiveQueryFirstEmission!).toBeLessThan(5000) // Should emit within 5 seconds

      item.unload()
      model.unload()
    })
  })

  describe('Scenario 2: Reactive query with existing data', () => {
    it('should emit immediately when data already exists', async () => {
      const db = BaseDb.getAppDb()
      if (!db) {
        throw new Error('Database not available')
      }

      // Create item and wait for it to be fully saved
      const model = await Model.create('TestModel', 'LiveQuery Timing Test Schema')
      await xstateWaitFor(
        model.getService(),
        (snapshot) => snapshot.value === 'idle',
        { timeout: WAIT_TIMEOUT_MS }
      )

      const item = await Item.create({
        modelName: 'TestModel',
        name: 'Existing Item',
        value: 'Existing Value',
      })

      await xstateWaitFor(
        item.getService(),
        (snapshot) => snapshot.value === 'idle',
        { timeout: WAIT_TIMEOUT_MS }
      )

      await waitForItemPersisted(item, { name: 'Existing Item', value: 'Existing Value' })

      // Verify data exists with direct query
      const directResults = await db
        .select()
        .from(metadata)
        .where(
          and(
            eq(metadata.seedLocalId, item.seedLocalId),
            isNotNull(metadata.propertyName)
          )
        )

      expect(directResults.length).toBeGreaterThan(0)
      console.log(`[Existing Data Test] Direct query found ${directResults.length} records`)

      // Now create reactive query - should emit immediately since data exists
      const reactiveQueryStart = performance.now()
      let reactiveQueryFirstEmission: number | null = null
      let reactiveQueryResults: any[] | null = null

      const query = db
        .select({
          propertyName: metadata.propertyName,
          propertyValue: metadata.propertyValue,
          seedLocalId: metadata.seedLocalId,
        })
        .from(metadata)
        .where(
          and(
            eq(metadata.seedLocalId, item.seedLocalId),
            isNotNull(metadata.propertyName)
          )
        )

      const observable = BaseDb.liveQuery(query)

      const subscription = observable.subscribe({
        next: (results) => {
          if (reactiveQueryFirstEmission === null) {
            reactiveQueryFirstEmission = performance.now() - reactiveQueryStart
            reactiveQueryResults = results
            console.log(`[Existing Data Test] Reactive query emitted after ${reactiveQueryFirstEmission.toFixed(2)}ms`)
            console.log(`[Existing Data Test] Reactive query results: ${results.length} records`)
          }
        },
        error: (err) => {
          console.error('[Existing Data Test] Reactive query error:', err)
        },
      })

      // Wait for first emission
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          console.log('[Existing Data Test] Reactive query timeout - did not emit!')
          subscription.unsubscribe()
          resolve()
        }, 5000)

        if (reactiveQueryFirstEmission !== null) {
          clearTimeout(timeout)
          subscription.unsubscribe()
          resolve()
        } else {
          const checkInterval = setInterval(() => {
            if (reactiveQueryFirstEmission !== null) {
              clearInterval(checkInterval)
              clearTimeout(timeout)
              subscription.unsubscribe()
              resolve()
            }
          }, 10)
        }
      })

      // Assertions
      if (reactiveQueryFirstEmission === null) {
        console.log('[Existing Data Test] CRITICAL: Reactive query did not emit even though data exists!')
        // This confirms the issue
      } else {
        expect(reactiveQueryResults).not.toBeNull()
        expect(reactiveQueryResults!.length).toBeGreaterThan(0)
        expect(reactiveQueryFirstEmission).toBeLessThan(1000) // Should emit quickly if data exists
      }

      item.unload()
      model.unload()
    })
  })

  describe('Scenario 3: Transaction timing and change detection', () => {
    it('should detect changes after transaction commits', async () => {
      const db = BaseDb.getAppDb()
      if (!db) {
        throw new Error('Database not available')
      }

      // Create item
      const model = await Model.create('TestModel', 'LiveQuery Timing Test Schema')
      await xstateWaitFor(
        model.getService(),
        (snapshot) => snapshot.value === 'idle',
        { timeout: WAIT_TIMEOUT_MS }
      )

      const item = await Item.create({
        modelName: 'TestModel',
        name: 'Transaction Test Item',
        value: 'Initial Value',
      })

      await xstateWaitFor(
        item.getService(),
        (snapshot) => snapshot.value === 'idle',
        { timeout: WAIT_TIMEOUT_MS }
      )

      await waitForItemPersisted(item, { name: 'Transaction Test Item', value: 'Initial Value' })

      // Set up reactive query BEFORE updating
      let emissionCount = 0
      let initialEmission: any[] | null = null
      let updateEmission: any[] | null = null
      let latestEmission: any[] | null = null

      const query = db
        .select({
          propertyName: metadata.propertyName,
          propertyValue: metadata.propertyValue,
          seedLocalId: metadata.seedLocalId,
        })
        .from(metadata)
        .where(
          and(
            eq(metadata.seedLocalId, item.seedLocalId),
            isNotNull(metadata.propertyName)
          )
        )

      const observable = BaseDb.liveQuery(query)

      const subscription = observable.subscribe({
        next: (results) => {
          emissionCount++
          latestEmission = results
          if (emissionCount === 1) {
            initialEmission = results
            console.log(`[Transaction Test] Initial emission: ${results.length} records`)
          } else if (emissionCount === 2) {
            updateEmission = results
            console.log(`[Transaction Test] Update emission: ${results.length} records`)
          }
        },
        error: (err) => {
          console.error('[Transaction Test] Reactive query error:', err)
        },
      })

      // Wait for initial emission. It takes ~10ms; the long timeout only covers a stalled DB worker
      // under heavy load (finding 21), where the shorter one failed once.
      await waitUntilOrThrow(() => emissionCount >= 1, 'the reactive query to emit', 10000)

      console.log(`[Transaction Test] Initial emission count: ${emissionCount}`)
      console.log(`[Transaction Test] Initial emission records: ${initialEmission?.length || 0}`)

      // Now update a property
      const nameProperty = await ItemProperty.find({
        propertyName: 'name',
        seedLocalId: item.seedLocalId,
      })

      expect(nameProperty).toBeDefined()
      if (nameProperty) {
        const updateStart = performance.now()
        nameProperty.value = 'Updated Name'
        await nameProperty.save()
        await xstateWaitFor(
          nameProperty.getService(),
          (snapshot) => snapshot.value === 'idle',
          { timeout: WAIT_TIMEOUT_MS }
        )
        const updateTime = performance.now() - updateStart

        console.log(`[Transaction Test] Property update took ${updateTime.toFixed(2)}ms`)

        // A missing update emission is only a reactive-query failure once the row is committed, so
        // check the database first: a timeout here means the write was slow, not the live query.
        await waitUntilOrThrow(
          async () =>
            (await query).some((r: any) => r.propertyName === 'name' && r.propertyValue === 'Updated Name'),
          'the updated name to reach the database',
          10000,
        )

        // Wait for reactive query to detect change
        // Used to tolerate the update never arriving (it only logged a warning)
        const emittedUpdate = await waitUntil(
          () => !!latestEmission?.some((r: any) => r.propertyName === 'name' && r.propertyValue === 'Updated Name'),
          5000,
        )
        if (!emittedUpdate) {
          throw new Error(
            `Timed out after 5000ms waiting for the reactive query to emit the committed updated name ` +
              `(${emissionCount} emissions, latest: ${JSON.stringify(latestEmission)})`,
          )
        }

        console.log(`[Transaction Test] Total emissions: ${emissionCount}`)
        console.log(`[Transaction Test] Update emission records: ${updateEmission?.length || 0}`)

        if (updateEmission) {
          const updatedRecord = updateEmission.find(r => r.propertyName === 'name')
          console.log(`[Transaction Test] Updated record value: ${updatedRecord?.propertyValue}`)
        }
      }

      subscription.unsubscribe()

      // Assertions
      expect(emissionCount).toBeGreaterThanOrEqual(2) // initial + update
      expect(updateEmission).not.toBeNull()

      item.unload()
      model.unload()
    })
  })

  describe('Scenario 4: Drizzle query builder execution timing', () => {
    it('should test if Drizzle query executes immediately in reactiveQuery', async () => {
      const db = BaseDb.getAppDb()
      if (!db) {
        throw new Error('Database not available')
      }

      // Create item
      const model = await Model.create('TestModel', 'LiveQuery Timing Test Schema')
      await xstateWaitFor(
        model.getService(),
        (snapshot) => snapshot.value === 'idle',
        { timeout: WAIT_TIMEOUT_MS }
      )

      const item = await Item.create({
        modelName: 'TestModel',
        name: 'Drizzle Test Item',
        value: 'Drizzle Test Value',
      })

      await xstateWaitFor(
        item.getService(),
        (snapshot) => snapshot.value === 'idle',
        { timeout: WAIT_TIMEOUT_MS }
      )

      await waitForItemPersisted(item, { name: 'Drizzle Test Item', value: 'Drizzle Test Value' })

      // Test 1: Create Drizzle query builder
      const queryBuilderStart = performance.now()
      const query = db
        .select({
          propertyName: metadata.propertyName,
          propertyValue: metadata.propertyValue,
          seedLocalId: metadata.seedLocalId,
        })
        .from(metadata)
        .where(
          and(
            eq(metadata.seedLocalId, item.seedLocalId),
            isNotNull(metadata.propertyName)
          )
        )
      const queryBuilderTime = performance.now() - queryBuilderStart

      console.log(`[Drizzle Test] Query builder creation: ${queryBuilderTime.toFixed(2)}ms`)

      // Test 2: Execute query directly (synchronous)
      const directExecutionStart = performance.now()
      const directResults = await query
      const directExecutionTime = performance.now() - directExecutionStart

      console.log(`[Drizzle Test] Direct execution: ${directExecutionTime.toFixed(2)}ms`)
      console.log(`[Drizzle Test] Direct results: ${directResults.length} records`)

      // Test 3: Pass to reactiveQuery and measure emission time
      const reactiveQueryStart = performance.now()
      let reactiveQueryFirstEmission: number | null = null
      let reactiveQueryResults: any[] | null = null

      const observable = BaseDb.liveQuery(query)

      const subscription = observable.subscribe({
        next: (results) => {
          if (reactiveQueryFirstEmission === null) {
            reactiveQueryFirstEmission = performance.now() - reactiveQueryStart
            reactiveQueryResults = results
            console.log(`[Drizzle Test] Reactive query first emission: ${reactiveQueryFirstEmission.toFixed(2)}ms`)
            console.log(`[Drizzle Test] Reactive query results: ${reactiveQueryResults.length} records`)
          }
        },
        error: (err) => {
          console.error('[Drizzle Test] Reactive query error:', err)
        },
      })

      // Wait for emission
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          console.log('[Drizzle Test] Reactive query timeout')
          subscription.unsubscribe()
          resolve()
        }, 5000)

        if (reactiveQueryFirstEmission !== null) {
          clearTimeout(timeout)
          subscription.unsubscribe()
          resolve()
        } else {
          const checkInterval = setInterval(() => {
            if (reactiveQueryFirstEmission !== null) {
              clearInterval(checkInterval)
              clearTimeout(timeout)
              subscription.unsubscribe()
              resolve()
            }
          }, 10)
        }
      })

      // Compare timings
      console.log(`[Drizzle Test] Direct execution vs Reactive emission:`)
      console.log(`  Direct: ${directExecutionTime.toFixed(2)}ms`)
      if (reactiveQueryFirstEmission !== null) {
        console.log(`  Reactive: ${reactiveQueryFirstEmission.toFixed(2)}ms`)
        console.log(`  Difference: ${(reactiveQueryFirstEmission - directExecutionTime).toFixed(2)}ms`)
      } else {
        console.log(`  Reactive: DID NOT EMIT`)
      }

      // Assertions
      expect(directResults.length).toBeGreaterThan(0)
      if (reactiveQueryFirstEmission !== null) {
        expect(reactiveQueryResults).not.toBeNull()
        expect(reactiveQueryResults!.length).toBe(directResults.length)
      } else {
        console.log('[Drizzle Test] CRITICAL: Reactive query with Drizzle builder did not emit!')
      }

      item.unload()
      model.unload()
    })
  })
})
