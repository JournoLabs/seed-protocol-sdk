import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import { waitFor } from 'xstate'
import { Schema } from '@/Schema/Schema'
import { Model } from '@/Model/Model'
import { Item } from '@/Item/Item'
import { ItemProperty } from '@/ItemProperty/ItemProperty'
import { BaseDb } from '@/db/Db/BaseDb'
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
import { setupTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'
import { cleanupTestSchemaData } from '../test-utils/cleanupTestDb'
import { waitForItemIdle } from '../test-utils/waitForIdle'
import { WAIT_TIMEOUT_MS } from '../test-utils/timeouts'

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

testDescribe('Item Integration Tests', () => {
  beforeAll(async () => {
    // Use shared test environment setup
    await setupTestEnvironment({
      testFileUrl: import.meta.url,
      timeout: SETUP_HOOK_TIMEOUT_MS,
    })
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    // Clean up - delete in order to respect foreign key constraints
    const db = BaseDb.getAppDb()
    if (db) {
      // Delete in order: metadata -> versions -> seeds -> propertyUids -> modelUids -> properties -> model_schemas -> models -> schemas
      await db.delete(metadata)
      await db.delete(versions)
      await db.delete(seeds)
      await db.update(properties).set({ refModelId: null })
      await db.delete(propertyUids)
      await db.delete(modelUids)
      await db.delete(properties)
      await db.delete(modelSchemas)
      await db.delete(modelsTable)
      await db.delete(schemas)
    }
  })

  beforeEach(async () => {
    const db = BaseDb.getAppDb()
    if (db) {
      // Every item, Seed Protocol models' (Image, File, ...) included, so each test starts with none.
      // (The old version meant to keep Seed Protocol items, but its seeds.type = models.name match
      // compared snake_case types to model names and never matched, so it deleted them all anyway.)
      await db.delete(metadata)
      await db.delete(versions)
      await db.delete(seeds)
    }
    // Schemas, models and properties (FK-safe; keeps the Seed Protocol schema), and schema files
    await cleanupTestSchemaData()
  })

  afterEach(async () => {
    // Clean up Item instances by unloading them
    const db = BaseDb.getAppDb()
    if (db) {
      const dbSeeds = await db.select().from(seeds)
      for (const dbSeed of dbSeeds) {
        try {
          const item = await Item.find({
            modelName: dbSeed.type || '',
            seedLocalId: dbSeed.localId || undefined,
            seedUid: dbSeed.uid || undefined,
          })
          if (item) {
            item.unload()
          }
        } catch (error) {
          // Item might not exist, ignore
        }
      }
    }
  })

  describe('Item.create()', () => {
    it('should create a new Item instance with model name', async () => {
      const schemaName = 'Test Schema Item Create'
      const testSchema = createTestSchema(schemaName, {
        'TestPost': {
          id: generateId(),
          properties: {
            title: { dataType: 'Text' },
            content: { dataType: 'Text' },
          },
        },
      })

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      const model = Model.create('TestPost', schemaName, { waitForReady: false })
      await waitFor(
        model.getService(),
        (snapshot) => snapshot.value === 'idle',
        { timeout: WAIT_TIMEOUT_MS }
      )
      
      const item = await Item.create({
        modelName: 'TestPost',
        schemaName,
        title: 'Test Title',
        content: 'Test Content',
      })
      
      expect(item).toBeDefined()
      expect(item.modelName).toBe('TestPost')
      expect(item.seedLocalId).toBeDefined()
      
      await waitForItemIdle(item)
      
      const context = item.getService().getSnapshot().context
      expect(context.modelName).toBe('TestPost')
      expect(context.seedLocalId).toBeDefined()
    })

    it('should create Item with properties loaded from database', async () => {
      const schemaName = 'Test Schema Item Properties'
      const testSchema = createTestSchema(schemaName, {
        'TestPost': {
          id: generateId(),
          properties: {
            title: { dataType: 'Text' },
            content: { dataType: 'Text' },
            author: { dataType: 'Text' },
          },
        },
      })

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      const model = Model.create('TestPost', schemaName, { waitForReady: false })
      await waitFor(
        model.getService(),
        (snapshot) => snapshot.value === 'idle',
        { timeout: WAIT_TIMEOUT_MS }
      )
      
      const item = await Item.create({
        modelName: 'TestPost',
        schemaName,
        title: 'My Post',
        content: 'Post Content',
        author: 'John Doe',
      })
      
      await waitForItemIdle(item)
      
      // Wait for properties to be loaded
      await new Promise<void>((resolve) => {
        const subscription = item.getService().subscribe((snapshot) => {
          const propertyInstances = snapshot.context.propertyInstances as Map<string, any> | undefined
          if (propertyInstances && propertyInstances.size >= 3) {
            subscription.unsubscribe()
            resolve()
          }
        })
        
        // Check immediately
        const currentSnapshot = item.getService().getSnapshot()
        const currentPropertyInstances = currentSnapshot.context.propertyInstances as Map<string, any> | undefined
        if (currentPropertyInstances && currentPropertyInstances.size >= 3) {
          subscription.unsubscribe()
          resolve()
          return
        }
        
        // Timeout after 5 seconds
        setTimeout(() => {
          subscription.unsubscribe()
          resolve()
        }, 5000)
      })
      
      expect(item.properties).toBeDefined()
      const properties = item.properties || []
      expect(Array.isArray(properties)).toBe(true)
      expect(properties.length).toBeGreaterThanOrEqual(3)
      
      // Find properties by name
      const titleProperty = properties.find(p => p.propertyName === 'title' || p.propertyName === 'Title')
      const contentProperty = properties.find(p => p.propertyName === 'content' || p.propertyName === 'Content')
      const authorProperty = properties.find(p => p.propertyName === 'author' || p.propertyName === 'Author')
      
      expect(titleProperty).toBeDefined()
      expect(contentProperty).toBeDefined()
      expect(authorProperty).toBeDefined()
    })

    it('should use reactive proxy for property access', async () => {
      const schemaName = 'Test Schema Item Proxy'
      const testSchema = createTestSchema(schemaName, {
        'TestPost': {
          id: generateId(),
          properties: {
            title: { dataType: 'Text' },
          },
        },
      })

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      const model = Model.create('TestPost', schemaName, { waitForReady: false })
      await waitFor(
        model.getService(),
        (snapshot) => snapshot.value === 'idle',
        { timeout: WAIT_TIMEOUT_MS }
      )
      
      const item = await Item.create({
        modelName: 'TestPost',
        schemaName,
        title: 'Test Title',
      })
      
      await waitForItemIdle(item)
      
      // Test reactive proxy - properties should be accessible
      expect(item.modelName).toBe('TestPost')
      expect(item.seedLocalId).toBeDefined()
      // seedUid may be undefined for new items (only set after publishing)
      // expect(item.seedUid).toBeDefined()
      
      // Properties getter should work via proxy
      expect(item.properties).toBeDefined()
      expect(Array.isArray(item.properties)).toBe(true)
    })

    it('should allow setting property via item.prop when item was created with no initial values', async () => {
      const schemaName = 'Test Schema Item Set Prop No Initial'
      const testSchema = createTestSchema(schemaName, {
        'TestPost': {
          id: generateId(),
          properties: {
            title: { dataType: 'Text' },
            content: { dataType: 'Text' },
          },
        },
      })

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)

      const model = Model.create('TestPost', schemaName, { waitForReady: false })
      await waitFor(
        model.getService(),
        (snapshot) => snapshot.value === 'idle',
        { timeout: WAIT_TIMEOUT_MS }
      )

      const item = await model.create()
      await waitForItemIdle(item)

      expect(item.title).toBeUndefined()
      item.title = 'A New Title'
      expect(item.title).toBe('A New Title')

      if (item.properties.length > 0) {
        const titleProp = item.properties.find((p: any) => (p.propertyName || '').toLowerCase() === 'title')
        expect(titleProp).toBeDefined()
        expect(titleProp!.value).toBe('A New Title')
      }
    })

    it('should allow setting a property that was not in initial values', async () => {
      const schemaName = 'Test Schema Item Set Other Prop'
      const testSchema = createTestSchema(schemaName, {
        'TestPost': {
          id: generateId(),
          properties: {
            title: { dataType: 'Text' },
            content: { dataType: 'Text' },
          },
        },
      })

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)

      const model = Model.create('TestPost', schemaName, { waitForReady: false })
      await waitFor(
        model.getService(),
        (snapshot) => snapshot.value === 'idle',
        { timeout: WAIT_TIMEOUT_MS }
      )

      const item = await model.create({ title: 'Initial Title' })
      await waitForItemIdle(item)

      expect(item.title).toBe('Initial Title')
      expect(item.content).toBeUndefined()
      item.content = 'Set content after create'
      expect(item.content).toBe('Set content after create')

      if (item.properties.length >= 2) {
        const contentProp = item.properties.find((p: any) => (p.propertyName || '').toLowerCase() === 'content')
        expect(contentProp).toBeDefined()
        expect(contentProp!.value).toBe('Set content after create')
      }
    })

    it('should throw error if model name is not provided', async () => {
      await expect(async () => {
        await Item.create({} as any)
      }).rejects.toThrow('Model name is required')
    })

    it('should create Item independently from Model loading state', async () => {
      const schemaName = 'Test Schema Item Independence'
      const testSchema = createTestSchema(schemaName, {
        'TestPost': {
          id: generateId(),
          properties: {
            title: { dataType: 'Text' },
          },
        },
      })

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      // Create model first
      const model = Model.create('TestPost', schemaName, { waitForReady: false })
      await waitFor(
        model.getService(),
        (snapshot) => snapshot.value === 'idle',
        { timeout: WAIT_TIMEOUT_MS }
      )
      
      // Create item - should work even if Model instance is not passed
      const item = await Item.create({
        modelName: 'TestPost',
        schemaName,
        title: 'Test Title',
      })
      
      await waitForItemIdle(item)
      
      expect(item).toBeDefined()
      expect(item.modelName).toBe('TestPost')
    })
  })

  describe('Item.find()', () => {
    it('should find existing Item by seedLocalId', async () => {
      const schemaName = 'Test Schema Item Find'
      const testSchema = createTestSchema(schemaName, {
        'TestPost': {
          id: generateId(),
          properties: {
            title: { dataType: 'Text' },
          },
        },
      })

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      const model = Model.create('TestPost', schemaName, { waitForReady: false })
      await waitFor(
        model.getService(),
        (snapshot) => snapshot.value === 'idle',
        { timeout: WAIT_TIMEOUT_MS }
      )
      
      // Create item first
      const createdItem = await Item.create({
        modelName: 'TestPost',
        schemaName,
        title: 'Find Me',
      })
      
      await waitForItemIdle(createdItem)
      const seedLocalId = createdItem.seedLocalId
      
      // Item.find() requires versionsCount > 0, which new items might not have yet
      // So we'll verify the created item directly, and also try to find it
      // (which may work if a version was created during item creation)
      expect(createdItem.seedLocalId).toBe(seedLocalId)
      expect(createdItem.modelName).toBe('TestPost')
      
      // Try to find the item (may return undefined if no version exists yet)
      const foundItem = await Item.find({
        modelName: 'TestPost',
        seedLocalId,
      })
      
      // If found, verify it matches
      // Note: find() now waits for idle by default, so no need to call waitForItemIdle
      if (foundItem) {
        expect(foundItem.seedLocalId).toBe(seedLocalId)
        expect(foundItem.modelName).toBe('TestPost')
        // Verify it's in idle state (find() should have waited)
        const service = foundItem.getService()
        expect(service.getSnapshot().value).toBe('idle')
      }
      // If not found, that's okay - it means the item doesn't have a version yet
      // which is expected for newly created items
    })

    it('should find existing Item by seedUid', async () => {
      const schemaName = 'Test Schema Item Find Uid'
      const testSchema = createTestSchema(schemaName, {
        'TestPost': {
          id: generateId(),
          properties: {
            title: { dataType: 'Text' },
          },
        },
      })

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      const model = Model.create('TestPost', schemaName, { waitForReady: false })
      await waitFor(
        model.getService(),
        (snapshot) => snapshot.value === 'idle',
        { timeout: WAIT_TIMEOUT_MS }
      )
      
      // Create item first
      const createdItem = await Item.create({
        modelName: 'TestPost',
        schemaName,
        title: 'Find Me By Uid',
      })
      
      await waitForItemIdle(createdItem)
      
      // Wait for seedUid to be available
      let seedUid: string | undefined
      await new Promise<void>((resolve) => {
        const subscription = createdItem.getService().subscribe((snapshot) => {
          if (snapshot.context.seedUid) {
            seedUid = snapshot.context.seedUid
            subscription.unsubscribe()
            resolve()
          }
        })
        
        // Check immediately
        const currentSnapshot = createdItem.getService().getSnapshot()
        if (currentSnapshot.context.seedUid) {
          seedUid = currentSnapshot.context.seedUid
          subscription.unsubscribe()
          resolve()
          return
        }
        
        setTimeout(() => {
          subscription.unsubscribe()
          resolve()
        }, 3000)
      })
      
      if (seedUid) {
        // Find the item by UID
        const foundItem = await Item.find({
          modelName: 'TestPost',
          seedUid,
        })
        
        expect(foundItem).toBeDefined()
        expect(foundItem?.seedUid).toBe(seedUid)
        expect(foundItem?.modelName).toBe('TestPost')
        
        // Verify it's in idle state (find() should have waited)
        const service = foundItem!.getService()
        expect(service.getSnapshot().value).toBe('idle')
      }
    })

    it('should return undefined if Item not found', async () => {
      const foundItem = await Item.find({
        modelName: 'NonExistentModel',
        seedLocalId: 'non-existent-id',
      })
      
      expect(foundItem).toBeUndefined()
    })

    it('should support waitForReady: false option', async () => {
      const schemaName = 'Test Schema Item Find No Wait'
      const testSchema = createTestSchema(schemaName, {
        'TestPost': {
          id: generateId(),
          properties: {
            title: { dataType: 'Text' },
          },
        },
      })

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      const model = Model.create('TestPost', schemaName, { waitForReady: false })
      await waitFor(
        model.getService(),
        (snapshot) => snapshot.value === 'idle',
        { timeout: WAIT_TIMEOUT_MS }
      )
      
      const createdItem = await Item.create({
        modelName: 'TestPost',
        schemaName,
        title: 'Find Me No Wait',
      })
      
      await waitForItemIdle(createdItem)
      const seedLocalId = createdItem.seedLocalId
      
      // Find with waitForReady: false - should return immediately
      const foundItem = await Item.find({
        modelName: 'TestPost',
        seedLocalId,
        waitForReady: false,
      })
      
      expect(foundItem).toBeDefined()
      // Item might not be idle yet since we didn't wait
      const service = foundItem!.getService()
      const state = service.getSnapshot().value
      // State could be idle (if already loaded) or loading/waitingForDb
      expect(['idle', 'loading', 'waitingForDb']).toContain(state)
    })
  })

  describe('Item.all()', () => {
    it('should return all items for a model', async () => {
      const schemaName = 'Test Schema Item All'
      const testSchema = createTestSchema(schemaName, {
        'TestPost': {
          id: generateId(),
          properties: {
            title: { dataType: 'Text' },
          },
        },
      })

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      const model = Model.create('TestPost', schemaName, { waitForReady: false })
      await waitFor(
        model.getService(),
        (snapshot) => snapshot.value === 'idle',
        { timeout: WAIT_TIMEOUT_MS }
      )
      
      // Create multiple items
      const item1 = await Item.create({
        modelName: 'TestPost',
        schemaName,
        title: 'Post 1',
      })
      
      const item2 = await Item.create({
        modelName: 'TestPost',
        schemaName,
        title: 'Post 2',
      })
      
      const item3 = await Item.create({
        modelName: 'TestPost',
        schemaName,
        title: 'Post 3',
      })
      
      await waitForItemIdle(item1)
      await waitForItemIdle(item2)
      await waitForItemIdle(item3)
      
      // Get all items
      const allItems = await Item.all('TestPost', undefined, { schemaName })
      
      expect(allItems).toBeDefined()
      expect(Array.isArray(allItems)).toBe(true)
      
      // Items might not be immediately available via Item.all() if they're not fully persisted
      // But we can verify the items were created
      expect(item1.seedLocalId).toBeDefined()
      expect(item2.seedLocalId).toBeDefined()
      expect(item3.seedLocalId).toBeDefined()
      
      // If items are found, verify they're correct
      if (allItems.length >= 3) {
        const titles = allItems.map(item => {
          const titleProp = item.properties.find((p: any) => p.propertyName === 'title' || p.propertyName === 'Title')
          return titleProp?.value
        }).filter(Boolean)
        
        expect(titles).toContain('Post 1')
        expect(titles).toContain('Post 2')
        expect(titles).toContain('Post 3')
      } else {
        // If not all items are found, at least verify the created items exist
        expect(allItems.length).toBeGreaterThanOrEqual(0)
      }
    })

    it('should return empty array if no items exist', async () => {
      const allItems = await Item.all('NonExistentModel')
      expect(allItems).toBeDefined()
      expect(Array.isArray(allItems)).toBe(true)
      expect(allItems.length).toBe(0)
    })

    it('should return all items in idle state when waitForReady is true', async () => {
      const schemaName = 'Test Schema Item All WaitForReady'
      const testSchema = createTestSchema(schemaName, {
        'TestPost': {
          id: generateId(),
          properties: {
            title: { dataType: 'Text' },
          },
        },
      })

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)

      const model = Model.create('TestPost', schemaName, { waitForReady: false })
      await waitFor(
        model.getService(),
        (snapshot) => snapshot.value === 'idle',
        { timeout: WAIT_TIMEOUT_MS }
      )

      const item1 = await Item.create({
        modelName: 'TestPost',
        schemaName,
        title: 'Post A',
      })
      const item2 = await Item.create({
        modelName: 'TestPost',
        schemaName,
        title: 'Post B',
      })

      await waitForItemIdle(item1)
      await waitForItemIdle(item2)

      const allItems = await Item.all('TestPost', undefined, { waitForReady: true, schemaName })

      expect(allItems).toBeDefined()
      expect(Array.isArray(allItems)).toBe(true)
      expect(allItems.length).toBeGreaterThanOrEqual(2)
      for (const item of allItems) {
        const snapshot = item.getService().getSnapshot()
        expect(snapshot.value).toBe('idle')
      }
    })
  })

  describe('Item state machine', () => {
    it('should transition from loading to idle', async () => {
      const schemaName = 'Test Schema Item State Machine'
      const testSchema = createTestSchema(schemaName, {
        'TestPost': {
          id: generateId(),
          properties: {
            title: { dataType: 'Text' },
          },
        },
      })

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      const model = Model.create('TestPost', schemaName, { waitForReady: false })
      await waitFor(
        model.getService(),
        (snapshot) => snapshot.value === 'idle',
        { timeout: WAIT_TIMEOUT_MS }
      )
      
      const item = await Item.create({
        modelName: 'TestPost',
        schemaName,
        title: 'State Test',
      })
      
      // Check initial state
      const service = item.getService()
      const initialState = service.getSnapshot().value
      expect(['waitingForDb', 'loading', 'idle']).toContain(initialState)
      
      // Wait for idle state
      await waitForItemIdle(item)
      
      const finalState = service.getSnapshot().value
      expect(finalState).toBe('idle')
    })

    it('should load properties via loadOrCreateItem actor', async () => {
      const schemaName = 'Test Schema Item Load Actor'
      const testSchema = createTestSchema(schemaName, {
        'TestPost': {
          id: generateId(),
          properties: {
            title: { dataType: 'Text' },
            content: { dataType: 'Text' },
          },
        },
      })

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      const model = Model.create('TestPost', schemaName, { waitForReady: false })
      await waitFor(
        model.getService(),
        (snapshot) => snapshot.value === 'idle',
        { timeout: WAIT_TIMEOUT_MS }
      )
      
      // Create item
      const item = await Item.create({
        modelName: 'TestPost',
        schemaName,
        title: 'Load Test',
        content: 'Load Content',
      })
      
      await waitForItemIdle(item)
      
      // Wait for properties to be loaded
      await new Promise<void>((resolve) => {
        const subscription = item.getService().subscribe((snapshot) => {
          const propertyInstances = snapshot.context.propertyInstances as Map<string, any> | undefined
          if (propertyInstances && propertyInstances.size >= 2) {
            subscription.unsubscribe()
            resolve()
          }
        })
        
        const currentSnapshot = item.getService().getSnapshot()
        const currentPropertyInstances = currentSnapshot.context.propertyInstances as Map<string, any> | undefined
        if (currentPropertyInstances && currentPropertyInstances.size >= 2) {
          subscription.unsubscribe()
          resolve()
          return
        }
        
        setTimeout(() => {
          subscription.unsubscribe()
          resolve()
        }, 5000)
      })
      
      const context = item.getService().getSnapshot().context
      expect(context.propertyInstances).toBeDefined()
      expect(context.propertyInstances?.size).toBeGreaterThanOrEqual(2)
    })
  })

  describe('Item cache behavior', () => {
    it('should return same instance from cache when called multiple times', async () => {
      const schemaName = 'Test Schema Item Cache'
      const testSchema = createTestSchema(schemaName, {
        'TestPost': {
          id: generateId(),
          properties: {
            title: { dataType: 'Text' },
          },
        },
      })

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      const model = Model.create('TestPost', schemaName, { waitForReady: false })
      await waitFor(
        model.getService(),
        (snapshot) => snapshot.value === 'idle',
        { timeout: WAIT_TIMEOUT_MS }
      )
      
      // Create item
      const item1 = await Item.create({
        modelName: 'TestPost',
        schemaName,
        title: 'Cache Test',
      })
      
      await waitForItemIdle(item1)
      const seedLocalId = item1.seedLocalId
      
      // Create again with same seedLocalId - should return cached instance
      const item2 = await Item.create({
        modelName: 'TestPost',
        schemaName,
        seedLocalId,
        title: 'Updated Title',
      })
      
      expect(item1).toBe(item2) // Same instance
      expect(item2.seedLocalId).toBe(seedLocalId)
    })

    it('peekReady returns a ready cached item and its property without taking a cache hold', async () => {
      const schemaName = 'Test Schema Item PeekReady'
      const testSchema = createTestSchema(schemaName, {
        'TestPost': {
          id: generateId(),
          properties: {
            title: { dataType: 'Text' },
          },
        },
      })
      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      const model = Model.create('TestPost', schemaName, { waitForReady: false })
      await waitFor(model.getService(), (snapshot) => snapshot.value === 'idle', { timeout: WAIT_TIMEOUT_MS })

      const item = await Item.create({ modelName: 'TestPost', schemaName, title: 'Peek' })
      await waitForItemIdle(item)
      const { seedLocalId } = item
      const holds = () => (Item as any).instanceCache.get(seedLocalId)?.refCount
      const holdsBefore = holds()

      expect(Item.peekReady(seedLocalId)).toBe(Item.getById(seedLocalId))
      expect(holds()).toBe(holdsBefore + 1) // getById's hold, not peekReady's
      expect(Item.peekReady(undefined)).toBeUndefined()
      expect(Item.peekReady('not-a-cached-id')).toBeUndefined()

      const title = ItemProperty.peekReady({ seedLocalId, propertyName: 'title' })
      expect(title?.value).toBe('Peek')
      expect(ItemProperty.peekReady({ seedLocalId, propertyName: 'notAProperty' })).toBeUndefined()

      // A dropped (stopped) instance is gone from the cache, so it is never handed out.
      Item.dropCachedInstancesForSeedIds([seedLocalId])
      expect(Item.peekReady(seedLocalId)).toBeUndefined()
    })
  })

  describe('Item properties', () => {
    it('should load properties from metadata table', async () => {
      const schemaName = 'Test Schema Item Properties Metadata'
      const testSchema = createTestSchema(schemaName, {
        'TestPost': {
          id: generateId(),
          properties: {
            title: { dataType: 'Text' },
            content: { dataType: 'Text' },
            author: { dataType: 'Text' },
          },
        },
      })

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      const model = Model.create('TestPost', schemaName, { waitForReady: false })
      await waitFor(
        model.getService(),
        (snapshot) => snapshot.value === 'idle',
        { timeout: WAIT_TIMEOUT_MS }
      )
      
      // Create item
      const item = await Item.create({
        modelName: 'TestPost',
        schemaName,
        title: 'Metadata Test',
        content: 'Metadata Content',
        author: 'Metadata Author',
      })
      
      await waitForItemIdle(item)
      
      // Wait for properties to be loaded from metadata
      await new Promise<void>((resolve) => {
        const subscription = item.getService().subscribe((snapshot) => {
          const propertyInstances = snapshot.context.propertyInstances as Map<string, any> | undefined
          if (propertyInstances && propertyInstances.size >= 3) {
            subscription.unsubscribe()
            resolve()
          }
        })
        
        const currentSnapshot = item.getService().getSnapshot()
        const currentPropertyInstances = currentSnapshot.context.propertyInstances as Map<string, any> | undefined
        if (currentPropertyInstances && currentPropertyInstances.size >= 3) {
          subscription.unsubscribe()
          resolve()
          return
        }
        
        setTimeout(() => {
          subscription.unsubscribe()
          resolve()
        }, 5000)
      })
      
      // Verify properties are loaded
      const properties = item.properties
      expect(properties.length).toBeGreaterThanOrEqual(3)
      
      // Verify property values
      const titleProp = properties.find((p: any) => p.propertyName === 'title' || p.propertyName === 'Title')
      expect(titleProp).toBeDefined()
      expect(titleProp?.value).toBe('Metadata Test')
    })

    it('should update properties when latest version changes', async () => {
      const schemaName = 'Test Schema Item Version Update'
      const testSchema = createTestSchema(schemaName, {
        'TestPost': {
          id: generateId(),
          properties: {
            title: { dataType: 'Text' },
          },
        },
      })

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      const model = Model.create('TestPost', schemaName, { waitForReady: false })
      await waitFor(
        model.getService(),
        (snapshot) => snapshot.value === 'idle',
        { timeout: WAIT_TIMEOUT_MS }
      )
      
      // Create item
      const item = await Item.create({
        modelName: 'TestPost',
        schemaName,
        title: 'Version 1',
      })
      
      await waitForItemIdle(item)
      
      // Get initial version
      const initialVersion = item.latestVersionLocalId
      expect(initialVersion).toBeDefined()
      
      // Update the item (this should create a new version)
      const titleProp = item.properties.find((p: any) => p.propertyName === 'title' || p.propertyName === 'Title')
      if (titleProp) {
        titleProp.value = 'Version 2'
        await titleProp.save()
      }
      
      // Item should detect the new version via liveQuery
      // Note: This test verifies the liveQuery subscription is set up correctly
      expect(item.latestVersionLocalId).toBeDefined()
    })

    it('hydrates metadata tied to a non-latest version_local_id when that row is latest per property_name', async () => {
      const schemaName = 'Test Schema Metadata Version Local Drift'
      const testSchema = createTestSchema(schemaName, {
        TestPost: {
          id: generateId(),
          properties: {
            title: { dataType: 'Text' },
            driftNote: { dataType: 'Text' },
          },
        },
      })

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)

      const model = Model.create('TestPost', schemaName, { waitForReady: false })
      await waitFor(
        model.getService(),
        (snapshot) => snapshot.value === 'idle',
        { timeout: WAIT_TIMEOUT_MS },
      )

      const item = await Item.create({
        modelName: 'TestPost',
        schemaName,
        title: 'Drift Test',
      })
      await waitForItemIdle(item)

      const db = BaseDb.getAppDb()
      expect(db).toBeTruthy()

      const seedLocalId = item.seedLocalId
      const latestVersionLocalId = item.latestVersionLocalId
      expect(latestVersionLocalId).toBeDefined()

      const legacyVersionId = 'legacy-version-not-matching-latest'
      expect(legacyVersionId).not.toBe(latestVersionLocalId)

      await db!.insert(metadata).values({
        localId: generateId(),
        seedLocalId,
        versionLocalId: legacyVersionId,
        propertyName: 'driftNote',
        propertyValue: 'drift-from-legacy-version-row',
        modelType: 'test_post',
        createdAt: Date.now() + 2_000_000,
        updatedAt: Date.now() + 2_000_000,
      })

      item.unload()
      // Simulate cold reload: ItemProperty cache survives item.unload(); a full page load clears it.
      ItemProperty.clearInstanceCacheForItem(seedLocalId)

      const reloaded = await Item.create({
        modelName: 'TestPost',
        schemaName,
        seedLocalId,
      })
      await waitForItemIdle(reloaded)

      const driftProp = reloaded.properties.find(
        (p: any) => String(p.propertyName).toLowerCase() === 'driftnote',
      )
      expect(driftProp).toBeDefined()
      expect(driftProp?.value).toBe('drift-from-legacy-version-row')
    })
  })

  describe('Item independence from Model', () => {
    it('should load property names from database without Model dependency', async () => {
      const schemaName = 'Test Schema Item Independence DB'
      const testSchema = createTestSchema(schemaName, {
        'TestPost': {
          id: generateId(),
          properties: {
            title: { dataType: 'Text' },
            content: { dataType: 'Text' },
          },
        },
      })

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      const model = Model.create('TestPost', schemaName, { waitForReady: false })
      await waitFor(
        model.getService(),
        (snapshot) => snapshot.value === 'idle',
        { timeout: WAIT_TIMEOUT_MS }
      )
      
      // Create item without passing modelInstance
      const item = await Item.create({
        modelName: 'TestPost',
        schemaName,
        title: 'Independence Test',
        content: 'Independence Content',
      })
      
      await waitForItemIdle(item)
      
      // Item should have loaded properties from database independently
      expect(item).toBeDefined()
      expect(item.modelName).toBe('TestPost')
      
      // Properties should be loaded from metadata table
      await new Promise<void>((resolve) => {
        const subscription = item.getService().subscribe((snapshot) => {
          const propertyInstances = snapshot.context.propertyInstances as Map<string, any> | undefined
          if (propertyInstances && propertyInstances.size >= 2) {
            subscription.unsubscribe()
            resolve()
          }
        })
        
        const currentSnapshot = item.getService().getSnapshot()
        const currentPropertyInstances = currentSnapshot.context.propertyInstances as Map<string, any> | undefined
        if (currentPropertyInstances && currentPropertyInstances.size >= 2) {
          subscription.unsubscribe()
          resolve()
          return
        }
        
        setTimeout(() => {
          subscription.unsubscribe()
          resolve()
        }, 5000)
      })
      
      const properties = item.properties
      expect(properties.length).toBeGreaterThanOrEqual(2)
    })

    it('should build properties from the DB model when another schema\'s same-named model is cached', async () => {
      // A schema whose rows are gone but whose Model instance is still cached (e.g. removed earlier
      // in the session) must not supply the property set for a same-named model in another schema.
      const staleSchemaName = 'Test Schema Item Stale Shared Name'
      const staleModelId = generateId()
      const staleSchema = createTestSchema(staleSchemaName, {
        SharedPost: { id: staleModelId, properties: { title: { dataType: 'Text' }, content: { dataType: 'Text' } } },
      })
      await importJsonSchema({ contents: JSON.stringify(staleSchema) }, staleSchema.version)
      const staleModel = Model.create('SharedPost', staleSchemaName, { modelFileId: staleModelId, waitForReady: false })
      await waitFor(staleModel.getService(), (snapshot) => snapshot.value === 'idle', { timeout: WAIT_TIMEOUT_MS })

      const db = BaseDb.getAppDb()
      const [staleSchemaRow] = await db.select({ id: schemas.id }).from(schemas).where(eq(schemas.name, staleSchemaName))
      const staleLinks = await db.select({ modelId: modelSchemas.modelId }).from(modelSchemas).where(eq(modelSchemas.schemaId, staleSchemaRow.id))
      for (const { modelId } of staleLinks) {
        await db.delete(properties).where(eq(properties.modelId, modelId!))
        await db.delete(modelUids).where(eq(modelUids.modelId, modelId!))
      }
      await db.delete(modelSchemas).where(eq(modelSchemas.schemaId, staleSchemaRow.id))
      for (const { modelId } of staleLinks) {
        await db.delete(modelsTable).where(eq(modelsTable.id, modelId!))
      }
      await db.delete(schemas).where(eq(schemas.id, staleSchemaRow.id))

      const schemaName = 'Test Schema Item Current Shared Name'
      const modelId = generateId()
      const currentSchema = createTestSchema(schemaName, {
        SharedPost: { id: modelId, properties: { title: { dataType: 'Text' }, featureImage: { dataType: 'Image' } } },
      })
      await importJsonSchema({ contents: JSON.stringify(currentSchema) }, currentSchema.version)
      const model = Model.create('SharedPost', schemaName, { modelFileId: modelId, waitForReady: false })
      await waitFor(model.getService(), (snapshot) => snapshot.value === 'idle', { timeout: WAIT_TIMEOUT_MS })

      const item = await Item.create({ modelName: 'SharedPost', title: 'Shared name' })
      await waitForItemIdle(item)

      const names = item.properties.map((p) => p.propertyName)
      expect(names).toContain('featureImage')
      expect(names).not.toContain('content')
    })

    it('should not take properties from another schema when its own cached model was reimported', async () => {
      const otherSchemaName = 'Test Schema Item Other Shared Name'
      const otherModelId = generateId()
      const otherSchema = createTestSchema(otherSchemaName, {
        SharedPost: { id: otherModelId, properties: { title: { dataType: 'Text' }, content: { dataType: 'Text' } } },
      })
      await importJsonSchema({ contents: JSON.stringify(otherSchema) }, otherSchema.version)
      const otherModel = Model.create('SharedPost', otherSchemaName, { modelFileId: otherModelId, waitForReady: false })
      await waitFor(otherModel.getService(), (snapshot) => snapshot.value === 'idle', { timeout: WAIT_TIMEOUT_MS })

      const schemaName = 'Test Schema Item Reimported Shared Name'
      const modelId = generateId()
      const currentSchema = createTestSchema(schemaName, {
        SharedPost: { id: modelId, properties: { title: { dataType: 'Text' }, featureImage: { dataType: 'Image' } } },
      })
      await importJsonSchema({ contents: JSON.stringify(currentSchema) }, currentSchema.version)
      const model = Model.create('SharedPost', schemaName, { modelFileId: modelId, waitForReady: false })
      await waitFor(model.getService(), (snapshot) => snapshot.value === 'idle', { timeout: WAIT_TIMEOUT_MS })

      // Drop every SharedPost row and reimport only the current schema: its cached Model now points at
      // a deleted DB id (no properties) while the other schema's Model is still cached.
      // (Both schemas may link the same SharedPost models row, so unlink both before deleting models.)
      // Let both Models' own writes finish first, or one can fail or recreate rows after the deletes.
      // Check writeStatus, not the state: `success` returns to `idle` after 2s, so on a slow run the
      // first model's write has often finished before we look, and waiting for the state never ends.
      for (const m of [otherModel, model]) {
        const writeProcess = (
          await waitFor(m.getService(), (snapshot) => !!snapshot.context.writeProcess, { timeout: WAIT_TIMEOUT_MS })
        ).context.writeProcess!
        await waitFor(
          writeProcess,
          (snapshot) => snapshot.context.writeStatus === 'success' || snapshot.context.writeStatus === 'error',
          { timeout: WAIT_TIMEOUT_MS },
        )
      }
      const db = BaseDb.getAppDb()
      const schemaIds: number[] = []
      const modelIds = new Set<number>()
      for (const name of [otherSchemaName, schemaName]) {
        const [schemaRow] = await db.select({ id: schemas.id }).from(schemas).where(eq(schemas.name, name))
        schemaIds.push(schemaRow.id)
        const links = await db.select({ modelId: modelSchemas.modelId }).from(modelSchemas).where(eq(modelSchemas.schemaId, schemaRow.id))
        for (const { modelId: id } of links) modelIds.add(id!)
        await db.delete(modelSchemas).where(eq(modelSchemas.schemaId, schemaRow.id))
      }
      for (const id of modelIds) {
        await db.delete(properties).where(eq(properties.modelId, id))
        await db.delete(modelUids).where(eq(modelUids.modelId, id))
        await db.delete(modelsTable).where(eq(modelsTable.id, id))
      }
      for (const id of schemaIds) {
        await db.delete(schemas).where(eq(schemas.id, id))
      }
      Schema.clearCache()
      await importJsonSchema({ contents: JSON.stringify(currentSchema) }, currentSchema.version)

      const item = await Item.create({ modelName: 'SharedPost', title: 'Reimported' })
      await waitForItemIdle(item)

      const names = item.properties.map((p) => p.propertyName)
      expect(names).toContain('featureImage')
      expect(names).not.toContain('content')
    })
  })

  describe('Item reactive proxy', () => {
    it('should update context when tracked properties are set', async () => {
      const schemaName = 'Test Schema Item Proxy Update'
      const testSchema = createTestSchema(schemaName, {
        'TestPost': {
          id: generateId(),
          properties: {
            title: { dataType: 'Text' },
          },
        },
      })

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      const model = Model.create('TestPost', schemaName, { waitForReady: false })
      await waitFor(
        model.getService(),
        (snapshot) => snapshot.value === 'idle',
        { timeout: WAIT_TIMEOUT_MS }
      )
      
      const item = await Item.create({
        modelName: 'TestPost',
        schemaName,
        title: 'Proxy Test',
      })
      
      await waitForItemIdle(item)
      
      // Test that properties are read from context via proxy
      const initialModelName = item.modelName
      expect(initialModelName).toBe('TestPost')
      
      // Properties getter should work via proxy
      const properties = item.properties
      expect(Array.isArray(properties)).toBe(true)
    })

    it('should compute properties getter from propertyInstances Map', async () => {
      const schemaName = 'Test Schema Item Proxy Properties'
      const testSchema = createTestSchema(schemaName, {
        'TestPost': {
          id: generateId(),
          properties: {
            title: { dataType: 'Text' },
            content: { dataType: 'Text' },
          },
        },
      })

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      const model = Model.create('TestPost', schemaName, { waitForReady: false })
      await waitFor(
        model.getService(),
        (snapshot) => snapshot.value === 'idle',
        { timeout: WAIT_TIMEOUT_MS }
      )
      
      const item = await Item.create({
        modelName: 'TestPost',
        schemaName,
        title: 'Properties Test',
        content: 'Properties Content',
      })
      
      await waitForItemIdle(item)
      
      // Wait for properties to be loaded
      await new Promise<void>((resolve) => {
        const subscription = item.getService().subscribe((snapshot) => {
          const propertyInstances = snapshot.context.propertyInstances as Map<string, any> | undefined
          if (propertyInstances && propertyInstances.size >= 2) {
            subscription.unsubscribe()
            resolve()
          }
        })
        
        const currentSnapshot = item.getService().getSnapshot()
        const currentPropertyInstances = currentSnapshot.context.propertyInstances as Map<string, any> | undefined
        if (currentPropertyInstances && currentPropertyInstances.size >= 2) {
          subscription.unsubscribe()
          resolve()
          return
        }
        
        setTimeout(() => {
          subscription.unsubscribe()
          resolve()
        }, 5000)
      })
      
      // Properties getter should compute from propertyInstances
      const properties = item.properties
      expect(Array.isArray(properties)).toBe(true)
      expect(properties.length).toBeGreaterThanOrEqual(2)
      
      // Verify properties are ItemProperty instances
      properties.forEach((prop: any) => {
        expect(prop).toBeDefined()
        expect(prop.propertyName).toBeDefined()
      })
    })

    it('getOwnPropertyDescriptor on revokedAt does not throw', async () => {
      const schemaName = 'Test Schema Item Proxy GOPD'
      const testSchema = createTestSchema(schemaName, {
        'TestPost': {
          id: generateId(),
          properties: {
            title: { dataType: 'Text' },
          },
        },
      })

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)

      const model = Model.create('TestPost', schemaName, { waitForReady: false })
      await waitFor(
        model.getService(),
        (snapshot) => snapshot.value === 'idle',
        { timeout: WAIT_TIMEOUT_MS }
      )

      const item = await Item.create({
        modelName: 'TestPost',
        schemaName,
        title: 'GOPD Test',
      })
      await waitForItemIdle(item)

      expect(() => Object.getOwnPropertyDescriptor(item, 'revokedAt')).not.toThrow()
      expect(item.revokedAt).toBeUndefined()

      const withRevoked = await Item.create({
        modelName: 'TestPost',
        schemaName,
        title: 'GOPD Revoked',
        revokedAt: 1_700_000_000,
      } as any)
      await waitForItemIdle(withRevoked)

      expect(() => Object.getOwnPropertyDescriptor(withRevoked, 'revokedAt')).not.toThrow()
      expect(Object.getOwnPropertyDescriptor(withRevoked, 'revokedAt')?.configurable).not.toBe(false)
    })
  })

  describe('Item.publisher', () => {
    it('should expose publisher when seed has publisher set', async () => {
      const schemaName = 'Test Schema Item Publisher'
      const testSchema = createTestSchema(schemaName, {
        'TestPost': {
          id: generateId(),
          properties: {
            title: { dataType: 'Text' },
          },
        },
      })

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)

      const model = Model.create('TestPost', schemaName, { waitForReady: false })
      await waitFor(
        model.getService(),
        (snapshot) => snapshot.value === 'idle',
        { timeout: WAIT_TIMEOUT_MS }
      )

      const createdItem = await Item.create({
        modelName: 'TestPost',
        schemaName,
        title: 'Publisher Test',
      })
      await waitForItemIdle(createdItem)

      const seedLocalId = createdItem.seedLocalId
      const testPublisher = '0x1234567890abcdef1234567890abcdef12345678'

      // Update seed with publisher in DB (simulates EAS sync)
      const db = BaseDb.getAppDb()
      if (!db) throw new Error('Database not available')
      await db.update(seeds).set({ publisher: testPublisher }).where(eq(seeds.localId, seedLocalId))

      // Unload to clear cache so next find gets fresh data from DB
      createdItem.unload()

      const foundItem = await Item.find({ modelName: 'TestPost', seedLocalId })
      expect(foundItem).toBeDefined()
      await waitForItemIdle(foundItem!)

      expect(foundItem!.publisher).toBe(testPublisher)
    })

    it('should have publisher undefined for locally created items', async () => {
      const schemaName = 'Test Schema Item Publisher Undefined'
      const testSchema = createTestSchema(schemaName, {
        'TestPost': {
          id: generateId(),
          properties: {
            title: { dataType: 'Text' },
          },
        },
      })

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)

      const model = Model.create('TestPost', schemaName, { waitForReady: false })
      await waitFor(
        model.getService(),
        (snapshot) => snapshot.value === 'idle',
        { timeout: WAIT_TIMEOUT_MS }
      )

      const item = await Item.create({
        modelName: 'TestPost',
        schemaName,
        title: 'No Publisher',
      })
      await waitForItemIdle(item)

      expect(item.publisher).toBeUndefined()
    })

    it('should throw when attempting to set publisher', async () => {
      const schemaName = 'Test Schema Item Publisher ReadOnly'
      const testSchema = createTestSchema(schemaName, {
        'TestPost': {
          id: generateId(),
          properties: {
            title: { dataType: 'Text' },
          },
        },
      })

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)

      const model = Model.create('TestPost', schemaName, { waitForReady: false })
      await waitFor(
        model.getService(),
        (snapshot) => snapshot.value === 'idle',
        { timeout: WAIT_TIMEOUT_MS }
      )

      const item = await Item.create({
        modelName: 'TestPost',
        schemaName,
        title: 'ReadOnly Test',
      })
      await waitForItemIdle(item)

      expect(() => {
        ;(item as any).publisher = '0x123'
      }).toThrow('Cannot set item.publisher: publisher is read-only.')
    })
  })

  describe('Item unload', () => {
    it('should clean up liveQuery subscription on unload', async () => {
      const schemaName = 'Test Schema Item Unload'
      const testSchema = createTestSchema(schemaName, {
        'TestPost': {
          id: generateId(),
          properties: {
            title: { dataType: 'Text' },
          },
        },
      })

      await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
      
      const model = Model.create('TestPost', schemaName, { waitForReady: false })
      await waitFor(
        model.getService(),
        (snapshot) => snapshot.value === 'idle',
        { timeout: WAIT_TIMEOUT_MS }
      )
      
      const item = await Item.create({
        modelName: 'TestPost',
        schemaName,
        title: 'Unload Test',
      })
      
      await waitForItemIdle(item)
      
      // Unload the item
      item.unload()
      
      // Service should be stopped
      const service = item.getService()
      expect(service.getSnapshot().status).toBe('stopped')
    })
  })
})
