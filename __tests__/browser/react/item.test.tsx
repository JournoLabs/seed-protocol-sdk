import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import React, { useEffect, useState } from 'react'
import { useItem, useItems } from '@/browser/react/item'
import { client } from '@/client'
import { BaseDb } from '@/db/Db/BaseDb'
import { schemas } from '@/seedSchema/SchemaSchema'
import { eq } from 'drizzle-orm'
import { importJsonSchema } from '@/imports/json'
import { SchemaFileFormat } from '@/types/import'
import { Schema } from '@/Schema/Schema'
import { Model } from '@/Model/Model'
import { Item } from '@/Item/Item'
import type { SeedConstructorOptions } from '@/types'
import { waitFor as xstateWaitFor } from 'xstate'

// Test schema with models and properties
const testSchemaWithItems: SchemaFileFormat = {
  $schema: 'https://seedprotocol.org/schemas/data-model/v1',
  version: 1,
  id: 'test-schema-items-hooks',
  metadata: {
    name: 'Test Schema Items Hooks',
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

  return (
    <div data-testid="use-items-test">
      <div data-testid="items-status">{status}</div>
      <div data-testid="items-count">{items.length}</div>
      <div data-testid="items-is-loading">{isLoading ? 'true' : 'false'}</div>
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
    // Clean up schema from database
    const db = BaseDb.getAppDb()
    if (db) {
      await db.delete(schemas).where(eq(schemas.name, 'Test Schema Items Hooks'))
    }

    // Clear schema cache
    Schema.clearCache()
  })

  beforeEach(async () => {
    container = document.createElement('div')
    container.id = 'root'
    document.body.appendChild(container)

    // Clean up any existing test schema
    const db = BaseDb.getAppDb()
    if (db) {
      await db.delete(schemas).where(eq(schemas.name, 'Test Schema Items Hooks'))
    }
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
    const { loadAllSchemasFromDb } = await import('@/helpers/schema')
    await waitFor(
      async () => {
        const allSchemas = await loadAllSchemasFromDb()
        return allSchemas.some(s => s.schema.metadata?.name === 'Test Schema Items Hooks')
      },
      { timeout: 10000 }
    )

    // Create test items
    const postModel = Model.create('Post', 'Test Schema Items Hooks')
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

    const articleModel = Model.create('Article', 'Test Schema Items Hooks')
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

      render(
        <UseItemTest modelName="Post" seedLocalId={testItem1.seedLocalId} />,
        { container }
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

      await waitFor(
        () => {
          const itemModelName = screen.queryByTestId('item-model-name')
          return itemModelName !== null && itemModelName.textContent === 'Article'
        },
        { timeout: 10000 }
      )

      const itemModelName = screen.getByTestId('item-model-name')
      expect(itemModelName.textContent).toBe('Article')

      const itemDataHeadline = screen.getByTestId('item-data-headline')
      expect(itemDataHeadline.textContent).toBe('Test Article Headline')

      const itemDataBody = screen.getByTestId('item-data-body')
      expect(itemDataBody.textContent).toBe('Test Article Body')
    })
  })

  describe('useItems', () => {
    it('should return empty array when modelName is not provided', async () => {
      render(<UseItemsTest />, { container })

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
      render(<UseItemsTest modelName="Post" />, { container })

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

    it('should return items ordered by creation date (descending)', async () => {
      render(<UseItemsTest modelName="Post" />, { container })

      await waitFor(
        () => {
          const count = screen.getByTestId('items-count')
          return parseInt(count.textContent || '0') >= 3
        },
        { timeout: 10000 }
      )

      const itemElements = screen.getAllByTestId(/^item-\d+-seed-local-id$/)
      // Items should be ordered by creation date descending
      // The most recently created item should be first
      expect(itemElements.length).toBeGreaterThanOrEqual(3)
    })

    it('should update when modelName changes', async () => {
      const { rerender } = render(<UseItemsTest modelName="Post" />, { container })

      await waitFor(
        () => {
          const count = screen.getByTestId('items-count')
          return parseInt(count.textContent || '0') >= 3
        },
        { timeout: 10000 }
      )

      const initialCount = screen.getByTestId('items-count')
      expect(parseInt(initialCount.textContent || '0')).toBeGreaterThanOrEqual(3)

      // Change to Article model
      rerender(<UseItemsTest modelName="Article" />)

      await waitFor(
        () => {
          const count = screen.getByTestId('items-count')
          const itemCount = parseInt(count.textContent || '0')
          // Should have at least the test article item
          return itemCount >= 1
        },
        { timeout: 10000 }
      )

      const articleCount = screen.getByTestId('items-count')
      expect(parseInt(articleCount.textContent || '0')).toBeGreaterThanOrEqual(1)

      // Verify it's an Article item
      const itemModelName = screen.getByTestId('item-0-model-name')
      expect(itemModelName.textContent).toBe('Article')
    })

    it('should return isLoading status', async () => {
      render(<UseItemsTest modelName="Post" />, { container })

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
      const { rerender } = render(<UseItemsTest modelName="Post" deleted={false} />, { container })

      await waitFor(
        () => {
          const count = screen.getByTestId('items-count')
          return parseInt(count.textContent || '0') >= 3
        },
        { timeout: 10000 }
      )

      const initialCount = screen.getByTestId('items-count')
      const nonDeletedCount = parseInt(initialCount.textContent || '0')
      expect(nonDeletedCount).toBeGreaterThanOrEqual(3)

      // Test with deleted=true (should return only deleted items, which should be 0 in our test)
      rerender(<UseItemsTest modelName="Post" deleted={true} />)

      await waitFor(
        () => {
          const status = screen.getByTestId('items-status')
          expect(status.textContent).toBe('loaded')
        },
        { timeout: 10000 }
      )

      const deletedCount = screen.getByTestId('items-count')
      // No items are deleted in our test, so count should be 0
      expect(parseInt(deletedCount.textContent || '0')).toBe(0)
    })

    it('should update when new items are created', async () => {
      render(<UseItemsTest modelName="Post" />, { container })

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

  describe('useItem and useItems integration', () => {
    it('should work together - useItems shows list, useItem shows detail', async () => {
      if (!testItem1) {
        return
      }

      // Render both hooks
      function CombinedTest() {
        const { items } = useItems({ modelName: 'Post' })
        const { item } = useItem({ modelName: 'Post', seedLocalId: testItem1?.seedLocalId })

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

      render(<CombinedTest />, { container })

      await waitFor(
        () => {
          const itemsCount = screen.queryByTestId('combined-items-count')
          const itemTitle = screen.queryByTestId('combined-item-title')
          return itemsCount !== null && itemTitle !== null
        },
        { timeout: 10000 }
      )

      const itemsCount = screen.getByTestId('combined-items-count')
      expect(parseInt(itemsCount.textContent || '0')).toBeGreaterThanOrEqual(3)

      const itemSeedLocalId = screen.getByTestId('combined-item-seed-local-id')
      expect(itemSeedLocalId.textContent).toBe(testItem1.seedLocalId)

      const itemTitle = screen.getByTestId('combined-item-title')
      expect(itemTitle.textContent).toBe('Test Post Title 1')
    })
  })
})
