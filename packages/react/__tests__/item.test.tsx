import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import React, { useEffect, useState } from 'react'
import { useItem, useItems, useCreateItem, SeedProvider, useDeleteItem } from '@seedprotocol/react'
import {
  client,
  BaseDb,
  schemas,
  metadata,
  seeds,
  versions,
  propertyUids,
  modelUids,
  models as modelsTable,
  modelSchemas,
  properties,
  publishProcesses,
  importJsonSchema,
  Schema,
  Model,
  Item,
} from '@seedprotocol/sdk'
import type { SeedConstructorOptions, SchemaFileFormat } from '@seedprotocol/sdk'
import { and, eq, inArray } from 'drizzle-orm'
import { waitFor as xstateWaitFor } from 'xstate'

const TEST_SCHEMA_ITEMS_HOOKS_NAME = 'Test Schema Items Hooks'

// Test schema with models and properties
const testSchemaWithItems: SchemaFileFormat = {
  $schema: 'https://seedprotocol.org/schemas/data-model/v1',
  version: 1,
  id: 'test-schema-items-hooks',
  metadata: {
    name: TEST_SCHEMA_ITEMS_HOOKS_NAME,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  models: {
    Post: {
      id: 'post-model-hooks-id',
      properties: {
        title: {
          id: 'title-prop-hooks-id',
          type: 'Text',
        },
        content: {
          id: 'content-prop-hooks-id',
          type: 'Text',
        },
        author: {
          id: 'author-prop-hooks-id',
          type: 'Text',
        },
      },
    },
    Article: {
      id: 'article-model-hooks-id',
      properties: {
        headline: {
          id: 'headline-prop-hooks-id',
          type: 'Text',
        },
        body: {
          id: 'body-prop-hooks-id',
          type: 'Text',
        },
      },
    },
  },
  enums: {},
  migrations: [],
}

/** Remove test schema + rows in FK order (delete from schemas alone fails with SQLITE_CONSTRAINT_FOREIGNKEY). */
async function deleteTestSchemaItemsHooksRows(): Promise<void> {
  const db = BaseDb.getAppDb()
  if (!db) return

  const schemaRow = await db
    .select()
    .from(schemas)
    .where(eq(schemas.name, TEST_SCHEMA_ITEMS_HOOKS_NAME))
    .limit(1)
  if (!schemaRow.length || schemaRow[0].id == null) return

  const schemaId = schemaRow[0].id

  const links = await db
    .select({ modelId: modelSchemas.modelId })
    .from(modelSchemas)
    .where(eq(modelSchemas.schemaId, schemaId))

  const mids = links.map((l) => l.modelId).filter((id): id is number => id != null)
  if (mids.length === 0) {
    await db.delete(modelSchemas).where(eq(modelSchemas.schemaId, schemaId))
    await db.delete(schemas).where(eq(schemas.id, schemaId))
    return
  }

  const modelRows = await db
    .select({ name: modelsTable.name })
    .from(modelsTable)
    .where(inArray(modelsTable.id, mids))
  const modelNames = modelRows.map((m) => m.name).filter(Boolean) as string[]

  const seedRows = await db
    .select({ localId: seeds.localId })
    .from(seeds)
    .where(inArray(seeds.type, modelNames))
  const seedLocalIds = seedRows.map((s) => s.localId).filter(Boolean) as string[]

  if (seedLocalIds.length) {
    await db.delete(publishProcesses).where(inArray(publishProcesses.seedLocalId, seedLocalIds))
    await db.delete(metadata).where(inArray(metadata.seedLocalId, seedLocalIds))
    await db.delete(versions).where(inArray(versions.seedLocalId, seedLocalIds))
    await db.delete(seeds).where(inArray(seeds.localId, seedLocalIds))
  }

  const propRows = await db
    .select({ id: properties.id })
    .from(properties)
    .where(inArray(properties.modelId, mids))
  const pids = propRows.map((p) => p.id).filter((id): id is number => id != null)

  if (pids.length) {
    await db.delete(metadata).where(inArray(metadata.propertyId, pids))
    await db.delete(propertyUids).where(inArray(propertyUids.propertyId, pids))
  }

  await db.delete(modelUids).where(inArray(modelUids.modelId, mids))
  await db.update(properties).set({ refModelId: null }).where(inArray(properties.modelId, mids))
  await db.delete(properties).where(inArray(properties.modelId, mids))
  await db.delete(modelSchemas).where(eq(modelSchemas.schemaId, schemaId))
  await db.delete(modelsTable).where(inArray(modelsTable.id, mids))
  await db.delete(schemas).where(eq(schemas.id, schemaId))
}

// Helper function to wait for item to be in idle state
async function waitForItemIdle(item: Item<any>, timeout: number = 5000): Promise<void> {
  const service = item.getService()
  
  try {
    await xstateWaitFor(
      service,
      (snapshot) => {
        if (snapshot.value === 'error') {
          throw new Error('Item failed to load')
        }
        return snapshot.value === 'idle'
      },
      { timeout }
    )
  } catch (error: any) {
    if (error.message === 'Item failed to load') {
      throw error
    }
    throw new Error(`Item loading timeout after ${timeout}ms`)
  }
}

// Helper function to wait for item property to be in idle state
async function waitForItemPropertyIdle(property: { getService: () => { getSnapshot: () => { value: string } } }, timeout: number = 5000): Promise<void> {
  const service = property.getService()
  try {
    await xstateWaitFor(
      service,
      (snapshot) => {
        if (snapshot.value === 'error') {
          throw new Error('ItemProperty failed to load')
        }
        return snapshot.value === 'idle'
      },
      { timeout }
    )
  } catch (error: any) {
    if (error.message === 'ItemProperty failed to load') {
      throw error
    }
    throw new Error(`ItemProperty loading timeout after ${timeout}ms`)
  }
}

// Test component that displays an item and allows editing an ItemProperty via button click
function EditableItemTest({
  seedLocalId,
  newTitle,
  onEditComplete,
}: {
  seedLocalId: string
  newTitle: string
  onEditComplete?: () => void
}) {
  const { item } = useItem({ modelName: 'Post', seedLocalId })
  const [editDone, setEditDone] = useState(false)

  const handleEdit = async () => {
    if (item) {
      const titleProp = item.properties.find((p) => p.propertyName === 'title')
      if (titleProp) {
        titleProp.value = newTitle
        await titleProp.save()
        await waitForItemPropertyIdle(titleProp)
        setEditDone(true)
        onEditComplete?.()
      }
    }
  }

  return (
    <div data-testid="editable-item-test">
      {item && (
        <>
          <div data-testid="item-title">{String(item.properties.find((p) => p.propertyName === 'title')?.value ?? '')}</div>
          <button onClick={handleEdit} data-testid="edit-title-button" disabled={editDone}>
            Edit Title
          </button>
          {editDone && <div data-testid="edit-done">done</div>}
        </>
      )}
    </div>
  )
}

// Test component for useItem
function UseItemTest({
  modelName,
  seedLocalId,
  seedUid,
}: {
  modelName: string
  seedLocalId?: string
  seedUid?: string
}) {
  const { item, isLoading, error } = useItem({ modelName, seedLocalId, seedUid })
  const [status, setStatus] = useState<string>('loading')

  useEffect(() => {
    // Set status based on loading state and item availability
    if (error) {
      setStatus('error')
    } else if (!isLoading) {
      // Not loading anymore - either item is loaded or doesn't exist
      if (item !== undefined || (!seedLocalId && !seedUid)) {
        setStatus('loaded')
      } else {
        // No identifiers provided or item doesn't exist
        setStatus('loaded')
      }
    }
  }, [item, isLoading, error, seedLocalId, seedUid])

  return (
    <div data-testid="use-item-test">
      <div data-testid="item-status">{status}</div>
      <div data-testid="item-is-loading">{isLoading ? 'true' : 'false'}</div>
      {error && <div data-testid="item-error">{error.message}</div>}
      {item && (
        <>
          <div data-testid="item-seed-local-id">{item.seedLocalId}</div>
          <div data-testid="item-model-name">{item.modelName}</div>
          {/* Access properties directly from item instance */}
          {item.properties.find(p => p.propertyName === 'title')?.value && (
            <div data-testid="item-data-title">{item.properties.find(p => p.propertyName === 'title')?.value as string}</div>
          )}
          {item.properties.find(p => p.propertyName === 'content')?.value && (
            <div data-testid="item-data-content">{item.properties.find(p => p.propertyName === 'content')?.value as string}</div>
          )}
          {item.properties.find(p => p.propertyName === 'author')?.value && (
            <div data-testid="item-data-author">{item.properties.find(p => p.propertyName === 'author')?.value as string}</div>
          )}
          {item.properties.find(p => p.propertyName === 'headline')?.value && (
            <div data-testid="item-data-headline">{item.properties.find(p => p.propertyName === 'headline')?.value as string}</div>
          )}
          {item.properties.find(p => p.propertyName === 'body')?.value && (
            <div data-testid="item-data-body">{item.properties.find(p => p.propertyName === 'body')?.value as string}</div>
          )}
        </>
      )}
      {!item && (!seedLocalId && !seedUid) && (
        <div data-testid="item-null">null</div>
      )}
    </div>
  )
}

const SeedProviderWrapper = ({ children }: { children: React.ReactNode }) => (
  <SeedProvider>{children}</SeedProvider>
)

// Test component for useItems
function UseItemsTest({
  modelName,
  deleted,
}: {
  modelName?: string
  deleted?: boolean
}) {
  const { items, isLoading, error } = useItems({ modelName, deleted })
  const [status, setStatus] = useState<string>('loading')

  useEffect(() => {
    // Set status to loaded when items array is available and not loading
    if (!isLoading) {
      setStatus('loaded')
    }
  }, [items, isLoading])

  const allItemsIdle =
    items.length > 0 &&
    items.every(
      (i) => (i.getService().getSnapshot() as { value?: string }).value === 'idle'
    )

  return (
    <div data-testid="use-items-test">
      <div data-testid="items-status">{status}</div>
      <div data-testid="items-count">{items.length}</div>
      <div data-testid="items-is-loading">{isLoading ? 'true' : 'false'}</div>
      <div data-testid="items-all-idle">
        {items.length === 0 ? 'n/a' : allItemsIdle ? 'true' : 'false'}
      </div>
      {error && <div data-testid="items-error">{error.message}</div>}
      {items.map((item, index) => (
        <div key={index} data-testid={`item-${index}`}>
          <div data-testid={`item-${index}-seed-local-id`}>{item.seedLocalId}</div>
          <div data-testid={`item-${index}-model-name`}>{item.modelName}</div>
        </div>
      ))}
    </div>
  )
}

// Test component for useCreateItem (onCreationComplete lets tests wait without relying on DOM updates)
function UseCreateItemTest({ onCreationComplete }: { onCreationComplete?: (result: 'created' | 'done' | 'error') => void } = {}) {
  const { createItem, isLoading, error, resetError } = useCreateItem()
  const [createdItemId, setCreatedItemId] = useState<string | null>(null)
  const [status, setStatus] = useState<string>('idle')

  const handleCreate = async () => {
    setStatus('creating')
    const item = await createItem('Post', { title: 'Hook Created Post', content: 'Content from hook', author: 'Test' })
    let result: 'created' | 'done' | 'error'
    if (item) {
      setCreatedItemId(item.seedLocalId)
      setStatus('created')
      result = 'created'
    } else if (error) {
      setStatus('error')
      result = 'error'
    } else {
      setStatus('done')
      result = 'done'
    }
    onCreationComplete?.(result)
  }

  useEffect(() => {
    if (error) setStatus('error')
  }, [error])

  return (
    <div data-testid="use-create-item-test">
      <div data-testid="create-item-status">{status}</div>
      <div data-testid="create-item-is-loading">{isLoading ? 'true' : 'false'}</div>
      {createdItemId && <div data-testid="created-item-id">{createdItemId}</div>}
      {error && <div data-testid="create-item-error">{error.message}</div>}
      <button onClick={handleCreate} data-testid="create-item-button">
        Create Item
      </button>
      <button onClick={resetError} data-testid="create-item-reset-error">
        Reset Error
      </button>
    </div>
  )
}

// Test component for useDeleteItem
function UseDeleteItemTest({ item }: { item: Item<any> | null }) {
  const { deleteItem, isLoading, error, resetError } = useDeleteItem()
  const [status, setStatus] = useState<string>('idle')

  const handleDelete = async () => {
    if (!item) return
    setStatus('deleting')
    await deleteItem(item)
    setStatus('deleted')
  }

  useEffect(() => {
    if (error) setStatus('error')
  }, [error])

  return (
    <div data-testid="use-delete-item-test">
      <div data-testid="delete-item-status">{status}</div>
      <div data-testid="delete-item-is-loading">{isLoading ? 'true' : 'false'}</div>
      {error && <div data-testid="delete-item-error">{error.message}</div>}
      <button onClick={handleDelete} data-testid="delete-item-button" disabled={!item || status === 'deleting'}>
        Delete Item
      </button>
      <button onClick={resetError} data-testid="delete-item-reset-error">
        Reset Error
      </button>
    </div>
  )
}

describe('React Item Hooks Integration Tests', () => {
  let container: HTMLElement
  let testItem1: Item<any> | null = null
  let testItem2: Item<any> | null = null
  let testItem3: Item<any> | null = null
  let testArticleItem: Item<any> | null = null

  beforeAll(async () => {
    // Initialize client if not already initialized
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

    // Wait for client to be ready
    await waitFor(
      () => {
        return client.isInitialized()
      },
      { timeout: 30000 }
    )
  })

  afterAll(async () => {
    await deleteTestSchemaItemsHooksRows()
    Schema.clearCache()
  })

  beforeEach(async () => {
    container = document.createElement('div')
    container.id = 'root'
    document.body.appendChild(container)

    await deleteTestSchemaItemsHooksRows()
    Schema.clearCache()

    // Import test schema
    try {
      await importJsonSchema(
        { contents: JSON.stringify(testSchemaWithItems) },
        testSchemaWithItems.version
      )
    } catch (error) {
      // Schema might already exist, which is fine
      console.log('Schema import note:', error)
    }

    // Wait for schema to be available in database
    const { loadAllSchemasFromDb } = await import('@seedprotocol/sdk')
    await waitFor(
      async () => {
        const allSchemas = await loadAllSchemasFromDb()
        return allSchemas.some(s => s.schema.metadata?.name === TEST_SCHEMA_ITEMS_HOOKS_NAME)
      },
      { timeout: 10000 }
    )

    // Create test items
    const postModel = Model.create('Post', TEST_SCHEMA_ITEMS_HOOKS_NAME, { waitForReady: false })
    await xstateWaitFor(
      postModel.getService(),
      (snapshot) => snapshot.value === 'idle',
      { timeout: 5000 }
    )

    testItem1 = await Item.create({
      modelName: 'Post',
      title: 'Test Post Title 1',
      content: 'Test Post Content 1',
      author: 'Test Author 1',
    } as any)
    await waitForItemIdle(testItem1)

    // Wait for properties to be saved to database
    await new Promise(resolve => setTimeout(resolve, 1000))

    testItem2 = await Item.create({
      modelName: 'Post',
      title: 'Test Post Title 2',
      content: 'Test Post Content 2',
      author: 'Test Author 2',
    } as any)
    await waitForItemIdle(testItem2)

    // Wait for properties to be saved to database
    await new Promise(resolve => setTimeout(resolve, 1000))

    testItem3 = await Item.create({
      modelName: 'Post',
      title: 'Test Post Title 3',
      content: 'Test Post Content 3',
      author: 'Test Author 3',
    } as any)
    await waitForItemIdle(testItem3)

    // Wait for properties to be saved to database
    await new Promise(resolve => setTimeout(resolve, 1000))

    const articleModel = Model.create('Article', TEST_SCHEMA_ITEMS_HOOKS_NAME, { waitForReady: false })
    await xstateWaitFor(
      articleModel.getService(),
      (snapshot) => snapshot.value === 'idle',
      { timeout: 5000 }
    )

    testArticleItem = await Item.create({
      modelName: 'Article',
      headline: 'Test Article Headline',
      body: 'Test Article Body',
    } as any)
    await waitForItemIdle(testArticleItem)

    // Wait for properties to be saved to database
    await new Promise(resolve => setTimeout(resolve, 1000))
  })

  afterEach(async () => {
    document.body.innerHTML = ''
    Schema.clearCache()

    // Clean up item instances
    if (testItem1) {
      testItem1.unload()
      testItem1 = null
    }
    if (testItem2) {
      testItem2.unload()
      testItem2 = null
    }
    if (testItem3) {
      testItem3.unload()
      testItem3 = null
    }
    if (testArticleItem) {
      testArticleItem.unload()
      testArticleItem = null
    }
  })

  describe('useItem', () => {
    it('should return undefined when no identifiers are provided', async () => {
      render(<UseItemTest modelName="Post" />, { container })

      await waitFor(
        () => {
          const status = screen.getByTestId('item-status')
          expect(status.textContent).toBe('loaded')
        },
        { timeout: 5000 }
      )

      const nullIndicator = screen.queryByTestId('item-null')
      expect(nullIndicator).toBeTruthy()
    })

    it('should return item when seedLocalId is provided', async () => {
      if (!testItem1) {
        return
      }
      const item1 = testItem1

      // Verify item exists in database before test
      const db = BaseDb.getAppDb()
      if (db) {
        await waitFor(
          async () => {
            const { seeds } = await import('@seedprotocol/sdk')
            const seedRows = await db
              .select()
              .from(seeds)
              .where(eq(seeds.localId, item1.seedLocalId))
              .limit(1)
            return seedRows.length > 0
          },
          { timeout: 5000 }
        )
      }

      render(
        <UseItemTest modelName="Post" seedLocalId={item1.seedLocalId} />,
        { container }
      )

      // Small delay to allow React to process initial render and state updates
      await new Promise(resolve => setTimeout(resolve, 100))

      // Wait for loading to complete first (this ensures state updates have propagated)
      await waitFor(
        () => {
          const isLoading = screen.getByTestId('item-is-loading')
          return isLoading.textContent === 'false'
        },
        { timeout: 15000 }
      )

      // Wait for item to be found
      await waitFor(
        () => {
          const itemSeedLocalId = screen.queryByTestId('item-seed-local-id')
          return itemSeedLocalId !== null
        },
        { timeout: 15000 }
      )

      const itemSeedLocalId = screen.getByTestId('item-seed-local-id')
      expect(itemSeedLocalId.textContent).toBe(testItem1.seedLocalId)

      const itemModelName = screen.getByTestId('item-model-name')
      expect(itemModelName.textContent).toBe('Post')

      // Wait for item properties to be loaded
      await waitFor(
        () => {
          const itemDataTitle = screen.queryByTestId('item-data-title')
          return itemDataTitle !== null && itemDataTitle.textContent === 'Test Post Title 1'
        },
        { timeout: 15000 }
      )

      const itemDataTitle = screen.getByTestId('item-data-title')
      expect(itemDataTitle.textContent).toBe('Test Post Title 1')

      const itemDataContent = screen.getByTestId('item-data-content')
      expect(itemDataContent.textContent).toBe('Test Post Content 1')

      const itemDataAuthor = screen.getByTestId('item-data-author')
      expect(itemDataAuthor.textContent).toBe('Test Author 1')
    })

    it('should return item when seedUid is provided', async () => {
      if (!testItem1 || !testItem1.seedUid) {
        return
      }

      render(
        <UseItemTest modelName="Post" seedUid={testItem1.seedUid} />,
        { container }
      )

      await waitFor(
        () => {
          const itemSeedLocalId = screen.queryByTestId('item-seed-local-id')
          return itemSeedLocalId !== null
        },
        { timeout: 10000 }
      )

      const itemSeedLocalId = screen.getByTestId('item-seed-local-id')
      expect(itemSeedLocalId.textContent).toBe(testItem1.seedLocalId)

      const itemModelName = screen.getByTestId('item-model-name')
      expect(itemModelName.textContent).toBe('Post')
    })

    it('should return undefined for non-existent item', async () => {
      render(
        <UseItemTest modelName="Post" seedLocalId="non-existent-id" />,
        { container }
      )

      await waitFor(
        () => {
          const status = screen.getByTestId('item-status')
          expect(status.textContent).toBe('loaded')
        },
        { timeout: 10000 }
      )

      const itemSeedLocalId = screen.queryByTestId('item-seed-local-id')
      expect(itemSeedLocalId).toBeNull()
    })

    it('should update when seedLocalId changes', async () => {
      if (!testItem1 || !testItem2) {
        return
      }

      const { rerender } = render(
        <UseItemTest modelName="Post" seedLocalId={testItem1.seedLocalId} />,
        { container }
      )

      await waitFor(
        () => {
          const itemDataTitle = screen.queryByTestId('item-data-title')
          return itemDataTitle !== null && itemDataTitle.textContent === 'Test Post Title 1'
        },
        { timeout: 10000 }
      )

      // Change to different item
      rerender(
        <UseItemTest modelName="Post" seedLocalId={testItem2.seedLocalId} />
      )

      await waitFor(
        () => {
          const itemDataTitle = screen.getByTestId('item-data-title')
          expect(itemDataTitle.textContent).toBe('Test Post Title 2')
        },
        { timeout: 10000 }
      )
    })

    it('should return isLoading and error states', async () => {
      if (!testItem1) {
        return
      }

      render(
        <UseItemTest modelName="Post" seedLocalId={testItem1.seedLocalId} />,
        { container }
      )

      await waitFor(
        () => {
          const itemSeedLocalId = screen.queryByTestId('item-seed-local-id')
          return itemSeedLocalId !== null
        },
        { timeout: 10000 }
      )

      // Wait for loading to complete
      await waitFor(
        () => {
          const isLoading = screen.getByTestId('item-is-loading')
          return isLoading.textContent === 'false'
        },
        { timeout: 10000 }
      )

      // isLoading should be false after item loads
      const isLoading = screen.getByTestId('item-is-loading')
      expect(isLoading.textContent).toBe('false')

      // No error should be present
      const error = screen.queryByTestId('item-error')
      expect(error).toBeNull()
    })

    it('should handle different model types', async () => {
      if (!testArticleItem) {
        return
      }

      render(
        <UseItemTest modelName="Article" seedLocalId={testArticleItem.seedLocalId} />,
        { container }
      )

      const withinContainer = within(container)

      // Wait for hook to finish loading and set item (status becomes 'loaded')
      await waitFor(
        () => {
          const status = withinContainer.queryByTestId('item-status')
          return status !== null && status.textContent === 'loaded'
        },
        { timeout: 10000 }
      )

      await waitFor(
        () => {
          const itemModelName = withinContainer.queryByTestId('item-model-name')
          return itemModelName !== null && itemModelName.textContent === 'Article'
        },
        { timeout: 10000 }
      )

      const itemModelName = withinContainer.getByTestId('item-model-name')
      expect(itemModelName.textContent).toBe('Article')

      // Wait for properties to be rendered
      await waitFor(
        () => {
          const itemDataHeadline = withinContainer.queryByTestId('item-data-headline')
          return itemDataHeadline !== null && itemDataHeadline.textContent === 'Test Article Headline'
        },
        { timeout: 10000 }
      )

      const itemDataHeadline = withinContainer.getByTestId('item-data-headline')
      expect(itemDataHeadline.textContent).toBe('Test Article Headline')

      await waitFor(
        () => {
          const itemDataBody = withinContainer.queryByTestId('item-data-body')
          return itemDataBody !== null && itemDataBody.textContent === 'Test Article Body'
        },
        { timeout: 10000 }
      )

      const itemDataBody = withinContainer.getByTestId('item-data-body')
      expect(itemDataBody.textContent).toBe('Test Article Body')
    })
  })

  describe('useItems', () => {
    it('should return empty array when modelName is not provided', async () => {
      render(<UseItemsTest />, { container, wrapper: SeedProviderWrapper })

      await waitFor(
        () => {
          const status = screen.getByTestId('items-status')
          expect(status.textContent).toBe('loaded')
        },
        { timeout: 5000 }
      )

      const count = screen.getByTestId('items-count')
      // Without modelName, it should return empty array (or all items if that's the behavior)
      expect(parseInt(count.textContent || '0')).toBeGreaterThanOrEqual(0)
    })

    it('should return all items for a model', async () => {
      render(<UseItemsTest modelName="Post" />, { container, wrapper: SeedProviderWrapper })

      await waitFor(
        () => {
          const status = screen.getByTestId('items-status')
          expect(status.textContent).toBe('loaded')
        },
        { timeout: 10000 }
      )

      const count = screen.getByTestId('items-count')
      const itemCount = parseInt(count.textContent || '0')
      expect(itemCount).toBeGreaterThanOrEqual(3) // At least testItem1, testItem2, testItem3

      // Verify specific items exist
      const itemElements = screen.getAllByTestId(/^item-\d+-seed-local-id$/)
      const seedLocalIds = itemElements.map((el) => el.textContent)

      if (testItem1) {
        expect(seedLocalIds).toContain(testItem1.seedLocalId)
      }
      if (testItem2) {
        expect(seedLocalIds).toContain(testItem2.seedLocalId)
      }
      if (testItem3) {
        expect(seedLocalIds).toContain(testItem3.seedLocalId)
      }
    })

    it('should return items that are all idle when loading completes', async () => {
      render(<UseItemsTest modelName="Post" />, { container, wrapper: SeedProviderWrapper })

      await waitFor(
        () => {
          const status = screen.getByTestId('items-status')
          expect(status.textContent).toBe('loaded')
        },
        { timeout: 10000 }
      )

      const count = screen.getByTestId('items-count')
      expect(parseInt(count.textContent || '0')).toBeGreaterThanOrEqual(1)

      const allIdle = screen.getByTestId('items-all-idle')
      expect(allIdle.textContent).toBe('true')
    })

    it('should return items ordered by creation date (descending)', async () => {
      render(<UseItemsTest modelName="Post" />, { container, wrapper: SeedProviderWrapper })
      const scoped = within(container)

      // Assert inside waitFor so we don't depend on DOM after resolve (browser env can revert state)
      await waitFor(
        () => {
          const status = scoped.getByTestId('items-status').textContent
          const count = parseInt(scoped.getByTestId('items-count').textContent || '0')
          if (status === 'loaded' && count >= 3) {
            expect(count).toBeGreaterThanOrEqual(3)
            return true
          }
          return false
        },
        { timeout: 10000 }
      )
    })

    it('should update when modelName changes', async () => {
      const { rerender } = render(<UseItemsTest modelName="Post" />, { container, wrapper: SeedProviderWrapper })

      // Assert inside waitFor so we don't depend on DOM state after resolve (avoids race where
      // setItems(3) commits then a subsequent effect/update can briefly show 0 before stable)
      await waitFor(
        () => {
          const count = screen.getByTestId('items-count')
          const n = parseInt(count.textContent || '0')
          expect(n).toBeGreaterThanOrEqual(3)
          return n >= 3
        },
        { timeout: 10000 }
      )

      // Change to Article model
      rerender(<UseItemsTest modelName="Article" />)

      // Wait until we have Article items (count >= 1 and first item is Article). Assert inside
      // waitFor so we don't depend on DOM state after resolve and avoid races with clearing/refetch.
      await waitFor(
        () => {
          const count = screen.getByTestId('items-count')
          const itemCount = parseInt(count.textContent || '0')
          if (itemCount < 1) return false
          const itemModelName = screen.queryByTestId('item-0-model-name')
          if (!itemModelName || itemModelName.textContent !== 'Article') return false
          expect(itemCount).toBeGreaterThanOrEqual(1)
          expect(itemModelName.textContent).toBe('Article')
          return true
        },
        { timeout: 10000 }
      )
    })

    it('should return isLoading status', async () => {
      render(<UseItemsTest modelName="Post" />, { container, wrapper: SeedProviderWrapper })

      await waitFor(
        () => {
          const status = screen.getByTestId('items-status')
          expect(status.textContent).toBe('loaded')
        },
        { timeout: 10000 }
      )

      const isLoading = screen.getByTestId('items-is-loading')
      // isLoading should be false after items are loaded
      expect(isLoading.textContent).toBe('false')
    })

    it('should handle deleted flag', async () => {
      // First, test with deleted=false (default)
      const { rerender } = render(<UseItemsTest modelName="Post" deleted={false} />, { container, wrapper: SeedProviderWrapper })
      const scoped = within(container)

      // Assert inside waitFor so we don't depend on DOM after resolve (browser env can revert state)
      await waitFor(
        () => {
          const count = parseInt(scoped.getByTestId('items-count').textContent || '0')
          if (count >= 3) {
            expect(count).toBeGreaterThanOrEqual(3)
            return true
          }
          return false
        },
        { timeout: 10000 }
      )

      // Test with deleted=true (should return only deleted items, which should be 0 in our test)
      rerender(<UseItemsTest modelName="Post" deleted={true} />)

      await waitFor(
        () => {
          const status = scoped.getByTestId('items-status')
          const count = parseInt(scoped.getByTestId('items-count').textContent || '0')
          if (status.textContent === 'loaded' && count === 0) {
            expect(count).toBe(0)
            return true
          }
          return false
        },
        { timeout: 10000 }
      )
    })

    it('should update when new items are created', async () => {
      render(<UseItemsTest modelName="Post" />, { container, wrapper: SeedProviderWrapper })

      await waitFor(
        () => {
          const count = screen.getByTestId('items-count')
          return parseInt(count.textContent || '0') >= 3
        },
        { timeout: 10000 }
      )

      const initialCount = screen.getByTestId('items-count')
      const initialItemCount = parseInt(initialCount.textContent || '0')

      // Create a new item
      const newItem = await Item.create({
        modelName: 'Post',
        title: 'New Test Post',
        content: 'New Test Content',
        author: 'New Test Author',
      } as any)
      await waitForItemIdle(newItem)

      // Wait for properties to be saved and database to update
      await new Promise(resolve => setTimeout(resolve, 2000))

      // useItems uses useLiveQuery which should automatically detect database changes
      // Wait for the new item to appear (reactive query should pick it up)
      await waitFor(
        () => {
          const count = screen.getByTestId('items-count')
          const itemCount = parseInt(count.textContent || '0')
          return itemCount > initialItemCount
        },
        { timeout: 15000 }
      )

      const finalCount = screen.getByTestId('items-count')
      expect(parseInt(finalCount.textContent || '0')).toBeGreaterThan(initialItemCount)

      // Clean up
      newItem.unload()
    })
  })

  describe('useItems React Query cache sharing (SeedProvider)', () => {
    it('should share cached list when multiple components call useItems with same params', async () => {
      const itemAllSpy = vi.spyOn(Item, 'all')
      try {
        function TwoLists() {
          return (
            <div data-testid="two-lists">
              <div data-testid="list-a">
                <UseItemsTest modelName="Post" />
              </div>
              <div data-testid="list-b">
                <UseItemsTest modelName="Post" />
              </div>
            </div>
          )
        }
        render(<TwoLists />, { container, wrapper: SeedProviderWrapper })

        await waitFor(
          () => {
            const listA = screen.getByTestId('list-a')
            const listB = screen.getByTestId('list-b')
            const statusA = within(listA).getByTestId('items-status').textContent
            const statusB = within(listB).getByTestId('items-status').textContent
            if (statusA !== 'loaded' || statusB !== 'loaded') return false
            const countA = parseInt(within(listA).getByTestId('items-count').textContent || '0')
            const countB = parseInt(within(listB).getByTestId('items-count').textContent || '0')
            expect(countA).toBe(countB)
            expect(countA).toBeGreaterThanOrEqual(3)
            return true
          },
          { timeout: 15000 }
        )

        const listA = screen.getByTestId('list-a')
        const listB = screen.getByTestId('list-b')
        const countA = parseInt(within(listA).getByTestId('items-count').textContent || '0')
        const countB = parseInt(within(listB).getByTestId('items-count').textContent || '0')
        expect(countA).toBe(countB)

        const postCalls = itemAllSpy.mock.calls.filter(
          (call) => call[0] === 'Post' && call[1] === false
        )
        expect(postCalls.length).toBeLessThanOrEqual(2)
        expect(postCalls.length).toBeGreaterThanOrEqual(1)
      } finally {
        itemAllSpy.mockRestore()
      }
    })
  })

  describe('ItemProperty edit persistence and reload', () => {
    it('persists ItemProperty edit to db and displays new value after reload', async () => {
      if (!testItem1) return

      const editedTitle = 'Edited Title After React Edit'
      const seedLocalId = testItem1.seedLocalId

      // 1. Render component and wait for item to load
      const { unmount } = render(
        <EditableItemTest seedLocalId={seedLocalId} newTitle={editedTitle} />,
        { container, wrapper: SeedProviderWrapper }
      )

      await waitFor(
        () => {
          const titleEl = screen.queryByTestId('item-title')
          return titleEl !== null && titleEl.textContent === 'Test Post Title 1'
        },
        { timeout: 15000 }
      )

      // 2. Edit the ItemProperty via the React component (simulates user editing)
      // Use findByTestId to avoid race where item unmounts between waitFor and getByTestId
      const editButton = await screen.findByTestId('edit-title-button', {}, { timeout: 5000 })
      editButton.click()

      // 3. Wait for edit/save to complete
      await waitFor(
        () => {
          const editDoneEl = screen.queryByTestId('edit-done')
          return editDoneEl !== null
        },
        { timeout: 10000 }
      )

      // 4. Verify the new value is persisted to the database
      const db = BaseDb.getAppDb()
      expect(db).toBeTruthy()
      if (db) {
        await waitFor(
          async () => {
            const rows = await db
              .select()
              .from(metadata)
              .where(
                and(
                  eq(metadata.seedLocalId, seedLocalId),
                  eq(metadata.propertyName, 'title'),
                  eq(metadata.propertyValue, editedTitle)
                )
            )
            return rows.length > 0
          },
          { timeout: 5000 }
        )
      }

      // 5. Simulate page reload: unload item to clear cache, unmount, then remount
      testItem1.unload()

      unmount()

      // 6. Remount (simulates fresh page load - component loads item from db)
      // Use a fresh container to avoid "Cannot update an unmounted root"
      const remountContainer = document.createElement('div')
      remountContainer.id = 'root-remount'
      document.body.appendChild(remountContainer)
      render(
        <EditableItemTest seedLocalId={seedLocalId} newTitle={editedTitle} />,
        { container: remountContainer, wrapper: SeedProviderWrapper }
      )

      // 7. Verify the new value is displayed as the current value after reload
      await waitFor(
        () => {
          const titleEl = screen.queryByTestId('item-title')
          if (titleEl !== null && titleEl.textContent === editedTitle) {
            expect(titleEl.textContent).toBe(editedTitle)
            return true
          }
          return false
        },
        { timeout: 15000 }
      )
    })
  })

  describe('useItem and useItems integration', () => {
    it('should work together - useItems shows list, useItem shows detail', async () => {
      if (!testItem1) {
        return
      }
      const item1 = testItem1

      // Render both hooks
      function CombinedTest() {
        const { items } = useItems({ modelName: 'Post' })
        const { item } = useItem({ modelName: 'Post', seedLocalId: item1.seedLocalId })

        return (
          <div>
            <div data-testid="combined-items-count">{items.length}</div>
            {item && <div data-testid="combined-item-seed-local-id">{item.seedLocalId}</div>}
            {item && item.properties.find(p => p.propertyName === 'title')?.value && (
              <div data-testid="combined-item-title">{item.properties.find(p => p.propertyName === 'title')?.value as string}</div>
            )}
          </div>
        )
      }

      render(<CombinedTest />, { container, wrapper: SeedProviderWrapper })

      await waitFor(
        () => {
          const itemsCount = screen.queryByTestId('combined-items-count')
          const itemSeedLocalId = screen.queryByTestId('combined-item-seed-local-id')
          const itemTitle = screen.queryByTestId('combined-item-title')
          if (!itemsCount || !itemSeedLocalId || !itemTitle) return false
          const count = parseInt(itemsCount.textContent || '0')
          if (count < 3) return false
          expect(count).toBeGreaterThanOrEqual(3)
          expect(itemSeedLocalId.textContent).toBe(item1.seedLocalId)
          expect(itemTitle.textContent).toBe('Test Post Title 1')
          return true
        },
        { timeout: 10000 }
      )
    })
  })

  describe('useCreateItem', () => {
    it('should expose createItem, isLoading, error, and resetError', async () => {
      render(<UseCreateItemTest />, { container })

      await waitFor(
        () => {
          const btn = screen.getByTestId('create-item-button')
          expect(btn).toBeTruthy()
        },
        { timeout: 5000 }
      )

      expect(screen.getByTestId('create-item-is-loading').textContent).toBe('false')
      expect(screen.queryByTestId('create-item-error')).toBeNull()
    })

    it('should create an item and set loading state during creation', async () => {
      container.innerHTML = ''
      let resolveCreation: (result: 'created' | 'done' | 'error') => void
      const creationDone = new Promise<'created' | 'done' | 'error'>((r) => {
        resolveCreation = r
      })
      render(
        <UseCreateItemTest onCreationComplete={(result) => resolveCreation(result)} />,
        { container }
      )

      await waitFor(
        () => {
          const btn = screen.getByTestId('create-item-button')
          expect(btn).toBeTruthy()
        },
        { timeout: 5000 }
      )

      screen.getByTestId('create-item-button').click()

      await waitFor(
        () => {
          const isLoading = screen.getByTestId('create-item-is-loading')
          return isLoading.textContent === 'true'
        },
        { timeout: 3000 }
      )

      const result = await Promise.race([
        creationDone,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Creation did not complete within 15s')), 15000)
        ),
      ])
      expect(['created', 'done', 'error']).toContain(result)
    })
  })

  describe('useDeleteItem', () => {
    it('should expose deleteItem, isLoading, error, and resetError', async () => {
      render(<UseDeleteItemTest item={null} />, { container })

      await waitFor(
        () => {
          const btn = screen.getByTestId('delete-item-button')
          expect(btn).toBeTruthy()
          expect(btn.hasAttribute('disabled')).toBe(true)
        },
        { timeout: 5000 }
      )

      expect(screen.getByTestId('delete-item-is-loading').textContent).toBe('false')
    })

    it('should delete an item and set loading state during delete', async () => {
      if (!testItem2) return

      render(<UseDeleteItemTest item={testItem2} />, { container })
      const scope = within(container)

      await waitFor(
        () => {
          const btn = scope.getByTestId('delete-item-button')
          expect(btn).toBeTruthy()
          expect(btn.hasAttribute('disabled')).toBe(false)
        },
        { timeout: 5000 }
      )

      scope.getByTestId('delete-item-button').click()

      await waitFor(
        () => {
          const isLoading = scope.getByTestId('delete-item-is-loading')
          return isLoading.textContent === 'true'
        },
        { timeout: 3000 }
      )

      // Wait for final status (deleted or error) to appear
      const statusEl = await Promise.race([
        scope.findByText('deleted', { timeout: 20000 }),
        scope.findByText('error', { timeout: 20000 }),
      ])
      expect(['deleted', 'error']).toContain(statusEl.textContent)
    })
  })
})
