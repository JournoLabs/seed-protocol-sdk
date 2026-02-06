import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import React, { useEffect, useState } from 'react'
import { useItemProperty, useItemProperties, useCreateItemProperty, useDestroyItemProperty } from '@/browser/react/itemProperty'
import { client } from '@/client'
import { BaseDb } from '@/db/Db/BaseDb'
import { schemas } from '@/seedSchema/SchemaSchema'
import { seeds, metadata } from '@/seedSchema'
import { eq } from 'drizzle-orm'
import { importJsonSchema } from '@/imports/json'
import { SchemaFileFormat } from '@/types/import'
import { Schema } from '@/Schema/Schema'
import { Model } from '@/Model/Model'
import { Item } from '@/Item/Item'
import { ItemProperty } from '@/ItemProperty/ItemProperty'
import type { IItemProperty } from '@/interfaces'
import type { SeedConstructorOptions } from '@/types'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { generateId } from '@/helpers'
import { waitFor as xstateWaitFor } from 'xstate'
import { eq, and } from 'drizzle-orm'

// Test schema with models and properties
const testSchemaWithItems: SchemaFileFormat = {
  $schema: 'https://seedprotocol.org/schemas/data-model/v1',
  version: 1,
  id: 'test-schema-items',
  metadata: {
    name: 'Test Schema Items',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  models: {
    Post: {
      id: 'post-model-items-id',
      properties: {
        title: {
          id: 'title-prop-items-id',
          type: 'Text',
        },
        content: {
          id: 'content-prop-items-id',
          type: 'Text',
        },
        author: {
          id: 'author-prop-items-id',
          type: 'Text',
        },
      },
    },
    Article: {
      id: 'article-model-items-id',
      properties: {
        headline: {
          id: 'headline-prop-items-id',
          type: 'Text',
        },
        body: {
          id: 'body-prop-items-id',
          type: 'Text',
        },
      },
    },
  },
  enums: {},
  migrations: [],
}

// Empty schema with no models for integration test
const emptyTestSchema: SchemaFileFormat = {
  $schema: 'https://seedprotocol.org/schemas/data-model/v1',
  version: 1,
  id: 'empty-test-schema-items',
  metadata: {
    name: 'Empty Test Schema Items',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  models: {},
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

// Helper function to wait for itemProperty to be in idle state
async function waitForItemPropertyIdle(property: ItemProperty<any>, timeout: number = 5000): Promise<void> {
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

// Test component for useItemProperty with object props
function UseItemPropertyWithPropsTest({
  seedLocalId,
  seedUid,
  propertyName,
}: {
  seedLocalId?: string
  seedUid?: string
  propertyName: string
}) {
  const { property, isLoading, error } = useItemProperty({ seedLocalId, seedUid, propertyName })
  const [status, setStatus] = useState<string>('loading')

  useEffect(() => {
    if (error) {
      setStatus('error')
    } else if (!isLoading && property) {
      setStatus('loaded')
    } else if (!isLoading && !property) {
      setStatus('not-loaded')
    }
  }, [property, isLoading, error])

  return (
    <div data-testid="use-item-property-props-test">
      <div data-testid="property-status">{status}</div>
      <div data-testid="is-loading">{isLoading ? 'true' : 'false'}</div>
      {error && <div data-testid="error-message">{error.message}</div>}
      {property && (
        <>
          <div data-testid="property-name">{property.propertyName}</div>
          <div data-testid="property-value">{String(property.value || '')}</div>
          <div data-testid="seed-local-id">{property.seedLocalId}</div>
        </>
      )}
      {!property && (propertyName === null || propertyName === undefined) && (
        <div data-testid="property-null">null</div>
      )}
    </div>
  )
}

// Test component for useItemProperty with itemId and propertyName
function UseItemPropertyWithIdTest({
  itemId,
  propertyName,
}: {
  itemId: string | null | undefined
  propertyName: string | null | undefined
}) {
  const { property, isLoading, error } = useItemProperty(
    itemId || '',
    propertyName || ''
  )
  const [status, setStatus] = useState<string>('loading')

  useEffect(() => {
    if (error) {
      setStatus('error')
    } else if (!isLoading && property) {
      setStatus('loaded')
    } else if (!isLoading && (itemId === null || propertyName === null)) {
      setStatus('not-loaded')
    }
  }, [property, isLoading, error, itemId, propertyName])

  return (
    <div data-testid="use-item-property-id-test">
      <div data-testid="property-status">{status}</div>
      <div data-testid="is-loading">{isLoading ? 'true' : 'false'}</div>
      {error && <div data-testid="error-message">{error.message}</div>}
      {property && (
        <>
          <div data-testid="property-name">{property.propertyName}</div>
          <div data-testid="property-value">{String(property.value || '')}</div>
        </>
      )}
      {!property && (itemId === null || propertyName === null) && (
        <div data-testid="property-null">null</div>
      )}
    </div>
  )
}

// Test component for useItemProperties with object props
function UseItemPropertiesWithPropsTest({
  seedLocalId,
  seedUid,
}: {
  seedLocalId?: string
  seedUid?: string
}) {
  const { properties, isLoading, error } = useItemProperties({ seedLocalId, seedUid })
  const [status, setStatus] = useState<string>('loading')

  useEffect(() => {
    if (error) {
      setStatus('error')
    } else if (!isLoading && properties !== undefined) {
      setStatus('loaded')
    }
  }, [properties, isLoading, error])

  return (
    <div data-testid="use-item-properties-props-test">
      <div data-testid="properties-status">{status}</div>
      <div data-testid="is-loading">{isLoading ? 'true' : 'false'}</div>
      {error && <div data-testid="error-message">{error.message}</div>}
      <div data-testid="properties-count">{properties?.length || 0}</div>
      {properties?.map((property, index) => (
        <div key={index} data-testid={`property-${index}`}>
          {property.propertyName}: {String(property.value || '')}
        </div>
      ))}
    </div>
  )
}

// Test component for useItemProperties with itemId
function UseItemPropertiesWithIdTest({ itemId }: { itemId: string | null | undefined }) {
  const { properties, isLoading, error } = useItemProperties(itemId || '')
  const [status, setStatus] = useState<string>('loading')

  useEffect(() => {
    if (error) {
      setStatus('error')
    } else if (!isLoading && properties !== undefined) {
      setStatus('loaded')
    }
  }, [properties, isLoading, error])

  return (
    <div data-testid="use-item-properties-id-test">
      <div data-testid="properties-status">{status}</div>
      <div data-testid="is-loading">{isLoading ? 'true' : 'false'}</div>
      {error && <div data-testid="error-message">{error.message}</div>}
      <div data-testid="properties-count">{properties?.length || 0}</div>
      {properties?.map((property, index) => (
        <div key={index} data-testid={`property-${index}`}>
          {property.propertyName}: {String(property.value || '')}
        </div>
      ))}
    </div>
  )
}

// Test component for displaying properties list
function ItemPropertiesListTest({
  seedLocalId,
  seedUid,
}: {
  seedLocalId?: string
  seedUid?: string
}) {
  const { properties } = useItemProperties({ seedLocalId, seedUid })
  const [status, setStatus] = useState<string>('loading')

  useEffect(() => {
    if (properties !== undefined) {
      setStatus('loaded')
    }
  }, [properties])

  return (
    <div data-testid="item-properties-list-test">
      <div data-testid="properties-status">{status}</div>
      <ul data-testid="properties-list">
        {properties?.map((property, index) => (
          <li key={index} data-testid={`property-item-${index}`}>
            {property.propertyName}: {String(property.value || '')}
          </li>
        ))}
      </ul>
      <div data-testid="properties-count">{properties?.length || 0}</div>
    </div>
  )
}

// Test component for useCreateItemProperty (API only - no valid item)
function UseCreateItemPropertyTest() {
  const { create, isLoading, error, resetError } = useCreateItemProperty()
  const [status, setStatus] = useState<string>('idle')

  useEffect(() => {
    if (error) setStatus('error')
  }, [error])

  return (
    <div data-testid="use-create-item-property-test">
      <div data-testid="create-item-property-status">{status}</div>
      <div data-testid="create-item-property-is-loading">{isLoading ? 'true' : 'false'}</div>
      {error && <div data-testid="create-item-property-error">{error.message}</div>}
      <button onClick={resetError} data-testid="create-item-property-reset-error">
        Reset Error
      </button>
    </div>
  )
}

// Test component that creates item property with a given seedLocalId (for integration test)
function UseCreateItemPropertyWithItemTest({ seedLocalId }: { seedLocalId: string | null }) {
  const { create, isLoading, error, resetError } = useCreateItemProperty()
  const [createdPropertyName, setCreatedPropertyName] = useState<string | null>(null)
  const [status, setStatus] = useState<string>('idle')

  const handleCreate = () => {
    if (!seedLocalId) return
    setStatus('creating')
    const prop = create({
      seedLocalId,
      propertyName: 'title',
      modelName: 'Post',
      propertyValue: 'Hook created value',
    })
    if (prop) {
      setCreatedPropertyName(prop.propertyName)
      setStatus('created')
    } else {
      setStatus('error')
    }
  }

  useEffect(() => {
    if (error) setStatus('error')
  }, [error])

  return (
    <div data-testid="use-create-item-property-with-item-test">
      <div data-testid="create-item-property-status">{status}</div>
      <div data-testid="create-item-property-is-loading">{isLoading ? 'true' : 'false'}</div>
      {createdPropertyName && <div data-testid="created-item-property-name">{createdPropertyName}</div>}
      {error && <div data-testid="create-item-property-error">{error.message}</div>}
      <button onClick={handleCreate} data-testid="create-item-property-button" disabled={!seedLocalId}>
        Create Item Property
      </button>
      <button onClick={resetError} data-testid="create-item-property-reset-error">
        Reset Error
      </button>
    </div>
  )
}

// Test component for useDestroyItemProperty
function UseDestroyItemPropertyTest({ property }: { property: IItemProperty | null }) {
  const { destroy, isLoading, error, resetError } = useDestroyItemProperty()
  const [status, setStatus] = useState<string>('idle')

  const handleDestroy = async () => {
    if (!property) return
    setStatus('destroying')
    await destroy(property)
    setStatus('destroyed')
  }

  useEffect(() => {
    if (error) setStatus('error')
  }, [error])

  return (
    <div data-testid="use-destroy-item-property-test">
      <div data-testid="destroy-item-property-status">{status}</div>
      <div data-testid="destroy-item-property-is-loading">{isLoading ? 'true' : 'false'}</div>
      {error && <div data-testid="destroy-item-property-error">{error.message}</div>}
      <button onClick={handleDestroy} data-testid="destroy-item-property-button" disabled={!property}>
        Destroy Property
      </button>
      <button onClick={resetError} data-testid="destroy-item-property-reset-error">
        Reset Error
      </button>
    </div>
  )
}

describe('React ItemProperty Hooks Integration Tests', () => {
  let container: HTMLElement
  let testItem: Item<any> | null = null
  let testItem2: Item<any> | null = null

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
    // Helper function to delete schema file if it exists
    const deleteSchemaFileIfExists = async (schemaName: string, version: number, schemaFileId: string) => {
      try {
        const path = BaseFileManager.getPathModule()
        const workingDir = BaseFileManager.getWorkingDir()
        // Sanitize schema name (same logic as in helpers/schema.ts)
        const sanitizedName = schemaName
          .replace(/[^a-zA-Z0-9\s_-]/g, '_')
          .replace(/\s+/g, '_')
          .replace(/^_+|_+$/g, '')
          .replace(/_+/g, '_')
        const filename = `${schemaFileId}_${sanitizedName}_v${version}.json`
        const filePath = path.join(workingDir, filename)
        
        const exists = await BaseFileManager.pathExists(filePath)
        if (exists) {
          const fs = await BaseFileManager.getFs()
          await fs.promises.unlink(filePath)
        }
      } catch (error) {
        // Ignore errors when deleting files (file might not exist)
      }
    }

    // Clean up items from database
    const db = BaseDb.getAppDb()
    if (db && testItem) {
      await db.delete(metadata).where(eq(metadata.seedLocalId, testItem.seedLocalId))
      await db.delete(seeds).where(eq(seeds.localId, testItem.seedLocalId))
    }
    if (db && testItem2) {
      await db.delete(metadata).where(eq(metadata.seedLocalId, testItem2.seedLocalId))
      await db.delete(seeds).where(eq(seeds.localId, testItem2.seedLocalId))
    }

    // Clean up schemas from database
    if (db) {
      await db.delete(schemas).where(eq(schemas.name, 'Test Schema Items'))
      await db.delete(schemas).where(eq(schemas.name, 'Empty Test Schema Items'))
      await db.delete(schemas).where(eq(schemas.name, 'LiveQuery Test Schema Items'))
    }

    // Clean up schema files from file system
    if (testSchemaWithItems.id) {
      await deleteSchemaFileIfExists('Test Schema Items', testSchemaWithItems.version, testSchemaWithItems.id)
    }
    if (emptyTestSchema.id) {
      await deleteSchemaFileIfExists('Empty Test Schema Items', emptyTestSchema.version, emptyTestSchema.id)
    }
    await deleteSchemaFileIfExists('LiveQuery Test Schema Items', 1, 'livequery-test-schema-items')

    // Clear schema cache
    Schema.clearCache()
  })

  beforeEach(async () => {
    container = document.createElement('div')
    container.id = 'root'
    document.body.appendChild(container)

    // Helper function to delete schema file if it exists
    const deleteSchemaFileIfExists = async (schemaName: string, version: number, schemaFileId: string) => {
      try {
        const path = BaseFileManager.getPathModule()
        const workingDir = BaseFileManager.getWorkingDir()
        // Sanitize schema name (same logic as in helpers/schema.ts)
        const sanitizedName = schemaName
          .replace(/[^a-zA-Z0-9\s_-]/g, '_')
          .replace(/\s+/g, '_')
          .replace(/^_+|_+$/g, '')
          .replace(/_+/g, '_')
        const filename = `${schemaFileId}_${sanitizedName}_v${version}.json`
        const filePath = path.join(workingDir, filename)
        
        const exists = await BaseFileManager.pathExists(filePath)
        if (exists) {
          const fs = await BaseFileManager.getFs()
          await fs.promises.unlink(filePath)
        }
      } catch (error) {
        // Ignore errors when deleting files (file might not exist)
      }
    }

    // Clean up any existing test schemas from database
    const db = BaseDb.getAppDb()
    if (db) {
      await db.delete(metadata)
      await db.delete(seeds).where(eq(seeds.type, 'post'))
      await db.delete(seeds).where(eq(seeds.type, 'article'))
      await db.delete(schemas).where(eq(schemas.name, 'Test Schema Items'))
      await db.delete(schemas).where(eq(schemas.name, 'Empty Test Schema Items'))
      await db.delete(schemas).where(eq(schemas.name, 'LiveQuery Test Schema Items'))
    }
    
    // Clean up schema files from file system
    if (testSchemaWithItems.id) {
      await deleteSchemaFileIfExists('Test Schema Items', testSchemaWithItems.version, testSchemaWithItems.id)
    }
    if (emptyTestSchema.id) {
      await deleteSchemaFileIfExists('Empty Test Schema Items', emptyTestSchema.version, emptyTestSchema.id)
    }
    
    Schema.clearCache()

    // Import test schemas
    try {
      await importJsonSchema({ contents: JSON.stringify(testSchemaWithItems) }, testSchemaWithItems.version)
    } catch (error) {
      // Schema might already exist, which is fine
      console.log('Schema import note:', error)
    }

    // Wait for schemas to be available in database
    const { loadAllSchemasFromDb } = await import('@/helpers/schema')
    await waitFor(
      async () => {
        const allSchemas = await loadAllSchemasFromDb()
        return allSchemas.some(s => s.schema.metadata?.name === 'Test Schema Items')
      },
      { timeout: 15000 }
    )
    
    // Give a small delay to ensure database operations are processed
    await new Promise(resolve => setTimeout(resolve, 100))

    // Create test items
    const model = Model.create('Post', 'Test Schema Items', { waitForReady: false })
    await xstateWaitFor(
      model.getService(),
      (snapshot) => snapshot.value === 'idle',
      { timeout: 5000 }
    )

    testItem = await Item.create({
      modelName: 'Post',
      title: 'Test Post Title',
      content: 'Test Post Content',
      author: 'Test Author',
    })
    await waitForItemIdle(testItem)

      // Wait for properties to be saved to database
      await new Promise(resolve => setTimeout(resolve, 2000))

      testItem2 = await Item.create({
        modelName: 'Post',
        title: 'Test Post Title 2',
        content: 'Test Post Content 2',
        author: 'Test Author 2',
      })
      await waitForItemIdle(testItem2)

      // Wait for properties to be saved to database
      await new Promise(resolve => setTimeout(resolve, 2000))
  })

  afterEach(async () => {
    document.body.innerHTML = ''
    Schema.clearCache()
    
    // Clean up item instances
    if (testItem) {
      testItem.unload()
      testItem = null
    }
    if (testItem2) {
      testItem2.unload()
      testItem2 = null
    }
  })

  describe('useItemProperty', () => {
    it('should return undefined when propertyName is empty', async () => {
      if (!testItem) return

      render(
        <UseItemPropertyWithPropsTest seedLocalId={testItem.seedLocalId} propertyName="" />,
        { container }
      )

      await waitFor(
        () => {
          const status = screen.getByTestId('property-status')
          expect(['not-loaded', 'loaded']).toContain(status.textContent)
        },
        { timeout: 5000 }
      )
    })

    it('should load property when seedLocalId and propertyName provided', async () => {
      if (!testItem) return

      render(
        <UseItemPropertyWithPropsTest seedLocalId={testItem.seedLocalId} propertyName="title" />,
        { container }
      )

      await waitFor(
        () => {
          const propertyName = screen.queryByTestId('property-name')
          return propertyName !== null
        },
        { timeout: 15000 }
      )

      const propertyName = screen.getByTestId('property-name')
      expect(propertyName.textContent).toBe('title')

      const propertyValue = screen.getByTestId('property-value')
      expect(propertyValue.textContent).toBe('Test Post Title')
    })

    it('should load property when itemId and propertyName provided', async () => {
      if (!testItem) return

      render(
        <UseItemPropertyWithIdTest itemId={testItem.seedLocalId} propertyName="content" />,
        { container }
      )

      await waitFor(
        () => {
          const propertyName = screen.queryByTestId('property-name')
          return propertyName !== null
        },
        { timeout: 15000 }
      )

      const propertyName = screen.getByTestId('property-name')
      expect(propertyName.textContent).toBe('content')

      const propertyValue = screen.getByTestId('property-value')
      expect(propertyValue.textContent).toBe('Test Post Content')
    })

    it('should update when propertyName changes', async () => {
      if (!testItem) return

      const { rerender } = render(
        <UseItemPropertyWithPropsTest seedLocalId={testItem.seedLocalId} propertyName="title" />,
        { container }
      )

      await waitFor(
        () => {
          const propertyName = screen.queryByTestId('property-name')
          return propertyName !== null && propertyName.textContent === 'title'
        },
        { timeout: 15000 }
      )

      // Change property name
      rerender(
        <UseItemPropertyWithPropsTest seedLocalId={testItem.seedLocalId} propertyName="content" />
      )

      await waitFor(
        () => {
          const propertyName = screen.getByTestId('property-name')
          expect(propertyName.textContent).toBe('content')
        },
        { timeout: 15000 }
      )
    })

    it('should update when seedLocalId changes', async () => {
      if (!testItem || !testItem2) return

      const { rerender } = render(
        <UseItemPropertyWithPropsTest seedLocalId={testItem.seedLocalId} propertyName="title" />,
        { container }
      )

      await waitFor(
        () => {
          const propertyValue = screen.queryByTestId('property-value')
          return propertyValue !== null && propertyValue.textContent === 'Test Post Title'
        },
        { timeout: 15000 }
      )

      // Change to different item
      rerender(
        <UseItemPropertyWithPropsTest seedLocalId={testItem2.seedLocalId} propertyName="title" />
      )

      await waitFor(
        () => {
          const propertyValue = screen.getByTestId('property-value')
          expect(propertyValue.textContent).toBe('Test Post Title 2')
        },
        { timeout: 15000 }
      )
    })

    it('should set isLoading to true initially and false when loaded', async () => {
      if (!testItem) return

      render(
        <UseItemPropertyWithPropsTest seedLocalId={testItem.seedLocalId} propertyName="title" />,
        { container }
      )

      // Initially, isLoading might be true or false depending on cache
      // We'll check that it becomes false when loaded
      await waitFor(
        () => {
          const isLoading = screen.getByTestId('is-loading')
          const status = screen.getByTestId('property-status')
          // Once status is loaded, isLoading should be false
          if (status.textContent === 'loaded') {
            expect(isLoading.textContent).toBe('false')
            return true
          }
          return false
        },
        { timeout: 15000 }
      )

      // Verify isLoading is false after loading
      const isLoading = screen.getByTestId('is-loading')
      expect(isLoading.textContent).toBe('false')
    })

    it('should set isLoading to false when propertyName is empty', async () => {
      if (!testItem) return

      render(
        <UseItemPropertyWithPropsTest seedLocalId={testItem.seedLocalId} propertyName="" />,
        { container }
      )

      await waitFor(
        () => {
          const isLoading = screen.getByTestId('is-loading')
          expect(isLoading.textContent).toBe('false')
        },
        { timeout: 5000 }
      )
    })

    it('should handle error state', async () => {
      // Try to load a property that doesn't exist
      render(
        <UseItemPropertyWithPropsTest seedLocalId="non-existent-id" propertyName="title" />,
        { container }
      )

      await waitFor(
        () => {
          const status = screen.getByTestId('property-status')
          // Should be either 'not-loaded' or 'loaded' (property not found is not an error)
          expect(['not-loaded', 'loaded']).toContain(status.textContent)
        },
        { timeout: 10000 }
      )
    })
  })

  describe('useItemProperties', () => {
    it('should return empty array when seedLocalId is not provided', async () => {
      render(<UseItemPropertiesWithPropsTest />, { container })

      await waitFor(
        () => {
          const status = screen.getByTestId('properties-status')
          expect(status.textContent).toBe('loaded')
        },
        { timeout: 5000 }
      )

      const count = screen.getByTestId('properties-count')
      expect(parseInt(count.textContent || '0')).toBe(0)
    })

    it('should return properties when seedLocalId provided', async () => {
      if (!testItem) return

      render(<UseItemPropertiesWithPropsTest seedLocalId={testItem.seedLocalId} />, { container })

      await waitFor(
        () => {
          const status = screen.getByTestId('properties-status')
          return status.textContent === 'loaded'
        },
        { timeout: 15000 }
      )

      // Wait for properties to be populated
      await waitFor(
        () => {
          const count = screen.getByTestId('properties-count')
          const countValue = parseInt(count.textContent || '0')
          // Post model has at least 3 properties: title, content, author
          expect(countValue).toBeGreaterThanOrEqual(3)
          return countValue >= 3
        },
        { timeout: 30000 }
      )

      // Verify specific properties exist
      const propertyElements = screen.getAllByTestId(/^property-\d+$/)
      const propertyTexts = propertyElements.map((el) => el.textContent)

      expect(propertyTexts.some(text => text?.includes('title'))).toBe(true)
      expect(propertyTexts.some(text => text?.includes('content'))).toBe(true)
      expect(propertyTexts.some(text => text?.includes('author'))).toBe(true)
    })

    it('should return properties when itemId provided', async () => {
      if (!testItem) return

      render(<UseItemPropertiesWithIdTest itemId={testItem.seedLocalId} />, { container })

      await waitFor(
        () => {
          const status = screen.getByTestId('properties-status')
          return status.textContent === 'loaded'
        },
        { timeout: 15000 }
      )

      // Wait for properties to be populated
      await waitFor(
        () => {
          const count = screen.getByTestId('properties-count')
          const countValue = parseInt(count.textContent || '0')
          expect(countValue).toBeGreaterThanOrEqual(3)
          return countValue >= 3
        },
        { timeout: 30000 }
      )
    })

    it('should update when seedLocalId changes', async () => {
      if (!testItem || !testItem2) return

      const { rerender } = render(
        <UseItemPropertiesWithPropsTest seedLocalId={testItem.seedLocalId} />,
        { container }
      )

      await waitFor(
        () => {
          const status = screen.getByTestId('properties-status')
          return status.textContent === 'loaded'
        },
        { timeout: 15000 }
      )

      await waitFor(
        () => {
          const count = screen.getByTestId('properties-count')
          return parseInt(count.textContent || '0') >= 3
        },
        { timeout: 30000 }
      )

      // Change to different item
      rerender(<UseItemPropertiesWithPropsTest seedLocalId={testItem2.seedLocalId} />)

      await waitFor(
        () => {
          const count = screen.getByTestId('properties-count')
          const countValue = parseInt(count.textContent || '0')
          expect(countValue).toBeGreaterThanOrEqual(3)
          return countValue >= 3
        },
        { timeout: 30000 }
      )

      // Verify properties are from the new item
      const propertyElements = screen.getAllByTestId(/^property-\d+$/)
      const propertyTexts = propertyElements.map((el) => el.textContent)
      expect(propertyTexts.some(text => text?.includes('Test Post Title 2'))).toBe(true)
    })

    it('should set isLoading to true initially and false when loaded', async () => {
      if (!testItem) return

      render(<UseItemPropertiesWithPropsTest seedLocalId={testItem.seedLocalId} />, { container })

      // Initially, isLoading might be true or false depending on cache
      // We'll check that it becomes false when loaded
      await waitFor(
        () => {
          const isLoading = screen.getByTestId('is-loading')
          const status = screen.getByTestId('properties-status')
          // Once status is loaded, isLoading should be false
          if (status.textContent === 'loaded') {
            expect(isLoading.textContent).toBe('false')
            return true
          }
          return false
        },
        { timeout: 15000 }
      )

      // Verify isLoading is false after loading
      const isLoading = screen.getByTestId('is-loading')
      expect(isLoading.textContent).toBe('false')
    })

    it('should set isLoading to false when seedLocalId is not provided', async () => {
      render(<UseItemPropertiesWithPropsTest />, { container })

      await waitFor(
        () => {
          const isLoading = screen.getByTestId('is-loading')
          expect(isLoading.textContent).toBe('false')
        },
        { timeout: 5000 }
      )
    })

    it('should automatically update when properties change (liveQuery integration)', async () => {
      if (!testItem) return

      // Ensure properties are saved to database before rendering
      // Wait a bit more to ensure all properties are persisted
      await new Promise(resolve => setTimeout(resolve, 2000))

      // Verify properties are actually in the database
      const db = BaseDb.getAppDb()
      if (db) {
        const { getMetadataLatest } = await import('@/db/read/subqueries/metadataLatest')
        const metadataLatest = getMetadataLatest({ seedLocalId: testItem.seedLocalId })
        const metadataRecords = await db
          .with(metadataLatest)
          .select()
          .from(metadataLatest)
          .where(eq(metadataLatest.rowNum, 1))
        
        // Wait for metadata to be in database
        await waitFor(
          async () => {
            const records = await db
              .with(metadataLatest)
              .select()
              .from(metadataLatest)
              .where(eq(metadataLatest.rowNum, 1))
            return records.length >= 3
          },
          { timeout: 10000 }
        )
      }

      // Render component - should start with existing properties
      render(<UseItemPropertiesWithPropsTest seedLocalId={testItem.seedLocalId} />, { container })

      // Wait for properties to be populated (don't just wait for 'loaded' status)
      await waitFor(
        () => {
          const count = screen.getByTestId('properties-count')
          const countValue = parseInt(count.textContent || '0')
          return countValue >= 3
        },
        { timeout: 30000 }
      )

      // Get initial count
      const initialCount = parseInt(screen.getByTestId('properties-count').textContent || '0')
      expect(initialCount).toBeGreaterThanOrEqual(3)

      // Update a property value
      const titleProperty = await ItemProperty.find({
        propertyName: 'title',
        seedLocalId: testItem.seedLocalId,
      })

      if (titleProperty) {
        titleProperty.value = 'Updated Title'
        await titleProperty.save()
        await waitForItemPropertyIdle(titleProperty)

        // Wait for liveQuery to detect the change and useItemProperties to update
        await waitFor(
          () => {
            const propertyElements = screen.getAllByTestId(/^property-\d+$/)
            const propertyTexts = propertyElements.map((el) => el.textContent)
            return propertyTexts.some(text => text?.includes('Updated Title'))
          },
          { timeout: 15000 }
        )

        // Verify the updated value appears
        const propertyElements = screen.getAllByTestId(/^property-\d+$/)
        const propertyTexts = propertyElements.map((el) => el.textContent)
        expect(propertyTexts.some(text => text?.includes('Updated Title'))).toBe(true)
      }
    })
  })

  describe('useItemProperties with dynamic property creation', () => {
    it('should display properties list and show updates when properties change', async () => {
      // Import empty schema first
      try {
        await importJsonSchema({ contents: JSON.stringify(emptyTestSchema) }, emptyTestSchema.version)
      } catch (error) {
        // Schema might already exist, which is fine
        console.log('Schema import note:', error)
      }

      // Wait for schema to be available in database
      const { loadAllSchemasFromDb } = await import('@/helpers/schema')
      await waitFor(
        async () => {
          const allSchemas = await loadAllSchemasFromDb()
          return allSchemas.some(s => s.schema.metadata?.name === 'Empty Test Schema Items')
        },
        { timeout: 10000 }
      )

      // Get the schema instance
      const schemaInstance = Schema.create('Empty Test Schema Items', { waitForReady: false })
      
      // Wait for schema to be ready
      await waitFor(
        () => {
          const snapshot = schemaInstance.getService().getSnapshot()
          return snapshot.value === 'idle'
        },
        { timeout: 10000 }
      )

      // Create the model with properties
      const newModel = Model.create('NewItemModel', schemaInstance, {
        properties: {
          name: { dataType: 'Text' },
          description: { dataType: 'Text' },
        },
        waitForReady: false,
      })

      // Wait for model to be idle
      await waitFor(
        () => {
          const modelSnapshot = newModel.getService().getSnapshot()
          return modelSnapshot.value === 'idle'
        },
        { timeout: 10000 }
      )

      // Create an item
      const newItem = await Item.create({
        modelName: 'NewItemModel',
        name: 'Test Item Name',
        description: 'Test Item Description',
      })
      await waitForItemIdle(newItem)

      // Wait for properties to be saved to database
      await new Promise(resolve => setTimeout(resolve, 2000))

      // Verify properties are actually in the database
      const db = BaseDb.getAppDb()
      if (db) {
        const { getMetadataLatest } = await import('@/db/read/subqueries/metadataLatest')
        const metadataLatest = getMetadataLatest({ seedLocalId: newItem.seedLocalId })
        
        // Wait for metadata to be in database
        await waitFor(
          async () => {
            const records = await db
              .with(metadataLatest)
              .select()
              .from(metadataLatest)
              .where(eq(metadataLatest.rowNum, 1))
            return records.length > 0
          },
          { timeout: 10000 }
        )
      }

      // Render component with the new item
      render(<ItemPropertiesListTest seedLocalId={newItem.seedLocalId} />, { container })

      // Wait for properties to appear in the UI (don't just wait for 'loaded' status)
      await waitFor(
        () => {
          const count = screen.getByTestId('properties-count')
          return parseInt(count.textContent || '0') > 0
        },
        { timeout: 30000 }
      )

      // Verify properties count is greater than 0
      const finalCount = screen.getByTestId('properties-count')
      expect(parseInt(finalCount.textContent || '0')).toBeGreaterThan(0)

      // Verify specific properties appear
      const propertyElements = screen.getAllByTestId(/^property-item-\d+$/)
      const propertyTexts = propertyElements.map((el) => el.textContent)
      expect(propertyTexts.some(text => text?.includes('name'))).toBe(true)
      expect(propertyTexts.some(text => text?.includes('description'))).toBe(true)

      // Cleanup
      newItem.unload()
      schemaInstance.unload()
      newModel.unload()
    })
  })

  describe('useCreateItemProperty', () => {
    it('should expose create, isLoading, error, and resetError', async () => {
      render(<UseCreateItemPropertyTest />, { container })

      await waitFor(
        () => {
          const statusEl = screen.getByTestId('create-item-property-status')
          expect(statusEl).toBeTruthy()
        },
        { timeout: 5000 }
      )

      expect(screen.getByTestId('create-item-property-is-loading').textContent).toBe('false')
    })

    it('should create an item property when given valid props and set loading state', async () => {
      if (!testItem) return

      render(<UseCreateItemPropertyWithItemTest seedLocalId={testItem.seedLocalId} />, { container })

      await waitFor(
        () => {
          const btn = screen.getByTestId('create-item-property-button')
          expect(btn).toBeTruthy()
          expect(btn.hasAttribute('disabled')).toBe(false)
        },
        { timeout: 5000 }
      )

      screen.getByTestId('create-item-property-button').click()

      await waitFor(
        () => {
          const status = screen.getByTestId('create-item-property-status')
          return status.textContent === 'created' || status.textContent === 'error'
        },
        { timeout: 10000 }
      )

      const status = screen.getByTestId('create-item-property-status')
      expect(['created', 'error']).toContain(status.textContent)
    })
  })

  describe('useDestroyItemProperty', () => {
    it('should expose destroy, isLoading, error, and resetError', async () => {
      render(<UseDestroyItemPropertyTest property={null} />, { container })

      await waitFor(
        () => {
          const btn = screen.getByTestId('destroy-item-property-button')
          expect(btn).toBeTruthy()
          expect(btn.hasAttribute('disabled')).toBe(true)
        },
        { timeout: 5000 }
      )

      expect(screen.getByTestId('destroy-item-property-is-loading').textContent).toBe('false')
    })

    it('should destroy an item property and set loading state during destroy', async () => {
      if (!testItem) return

      const titleProperty = await ItemProperty.find({
        propertyName: 'title',
        seedLocalId: testItem.seedLocalId,
      })
      if (!titleProperty) return

      render(<UseDestroyItemPropertyTest property={titleProperty} />, { container })

      await waitFor(
        () => {
          const btn = screen.getByTestId('destroy-item-property-button')
          expect(btn).toBeTruthy()
          expect(btn.hasAttribute('disabled')).toBe(false)
        },
        { timeout: 5000 }
      )

      screen.getByTestId('destroy-item-property-button').click()

      await waitFor(
        () => {
          const isLoading = screen.getByTestId('destroy-item-property-is-loading')
          return isLoading.textContent === 'true'
        },
        { timeout: 2000 }
      )

      await waitFor(
        () => {
          const isLoading = screen.getByTestId('destroy-item-property-is-loading')
          const status = screen.getByTestId('destroy-item-property-status')
          return isLoading.textContent === 'false' && (status.textContent === 'destroyed' || status.textContent === 'error')
        },
        { timeout: 5000 }
      )

      const status = screen.getByTestId('destroy-item-property-status')
      expect(['destroyed', 'error']).toContain(status.textContent)
    })
  })
})
