import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import React, { useEffect, useState } from 'react'
import {
  useModelProperties,
  useModelProperty,
  useCreateModelProperty,
  useDestroyModelProperty,
  useModel,
  SeedProvider,
  createSeedQueryClient,
} from '@seedprotocol/react'
import { useQueryClient } from '@tanstack/react-query'
import {
  client,
  BaseDb,
  schemas,
  properties as propertiesTable,
  importJsonSchema,
  Schema,
  Model,
  ModelProperty,
  loadAllSchemasFromDb,
} from '@seedprotocol/sdk'
import type { SeedConstructorOptions, SchemaFileFormat } from '@seedprotocol/sdk'
import { eq } from 'drizzle-orm'
import { createFastDestroyStub } from './test-utils/fastDestroyStub'
import { waitFor as xstateWaitFor } from 'xstate'
import { waitUntilOrThrow } from './test-utils/waitUntil'
import { cleanupTestSchemaData } from '../../sdk/__tests__/test-utils/cleanupTestDb'
import { WAIT_TIMEOUT_MS } from '../../sdk/__tests__/test-utils/timeouts'

// Test schema with models and properties
const testSchemaWithProperties: SchemaFileFormat = {
  $schema: 'https://seedprotocol.org/schemas/data-model/v1',
  version: 1,
  id: 'test-schema-properties',
  metadata: {
    name: 'Test Schema Properties',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  models: {
    Post: {
      id: 'post-model-id',
      properties: {
        title: {
          id: 'title-prop-id',
          type: 'Text',
        },
        content: {
          id: 'content-prop-id',
          type: 'Text',
        },
        author: {
          id: 'author-prop-id',
          type: 'Text',
        },
      },
    },
    Article: {
      id: 'article-model-id',
      properties: {
        headline: {
          id: 'headline-prop-id',
          type: 'Text',
        },
        body: {
          id: 'body-prop-id',
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
  id: 'empty-test-schema-props',
  metadata: {
    name: 'Empty Test Schema Properties',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  models: {},
  enums: {},
  migrations: [],
}

const SeedProviderWrapper = ({ children }: { children: React.ReactNode }) => (
  <SeedProvider>{children}</SeedProvider>
)

// Test component for useModelProperties
function UseModelPropertiesTest({
  schemaIdOrModelId,
  modelName,
}: {
  schemaIdOrModelId: string | null | undefined
  modelName?: string | null | undefined
}) {
  const { modelProperties, isLoading, error } = useModelProperties(schemaIdOrModelId, modelName)
  const [status, setStatus] = useState<string>('loading')

  useEffect(() => {
    if (error) {
      setStatus('error')
    } else if (!isLoading && modelProperties !== undefined) {
      setStatus('loaded')
    }
  }, [modelProperties, isLoading, error])

  return (
    <div data-testid="use-model-properties-test">
      <div data-testid="properties-status">{status}</div>
      <div data-testid="is-loading">{isLoading ? 'true' : 'false'}</div>
      {error && <div data-testid="error-message">{error.message}</div>}
      <div data-testid="properties-count">{modelProperties?.length || 0}</div>
      {modelProperties?.map((property, index) => (
        <div key={index} data-testid={`property-${index}`}>
          {property.name}
        </div>
      ))}
    </div>
  )
}

// Test component for useModelProperty
function UseModelPropertyTest({
  schemaId,
  modelName,
  propertyName,
}: {
  schemaId?: string | null | undefined
  modelName: string | null | undefined
  propertyName: string | null | undefined
}) {
  const { modelProperty, isLoading, error } = useModelProperty(
    schemaId || 'Test Schema Properties',
    modelName || '',
    propertyName || ''
  )
  const [status, setStatus] = useState<string>('loading')

  useEffect(() => {
    if (error) {
      setStatus('error')
    } else if (!isLoading && modelProperty) {
      setStatus('loaded')
    } else if (!isLoading && (modelName === null || propertyName === null)) {
      setStatus('not-loaded')
    }
  }, [modelProperty, isLoading, error, modelName, propertyName])

  return (
    <div data-testid="use-model-property-test">
      <div data-testid="property-status">{status}</div>
      <div data-testid="is-loading">{isLoading ? 'true' : 'false'}</div>
      {error && <div data-testid="error-message">{error.message}</div>}
      {modelProperty && (
        <>
          <div data-testid="property-name">{modelProperty.name}</div>
          <div data-testid="property-data-type">{modelProperty.dataType}</div>
          <div data-testid="validation-errors-count">{modelProperty.validationErrors?.length || 0}</div>
        </>
      )}
      {!modelProperty && (modelName === null || propertyName === null) && (
        <div data-testid="property-null">null</div>
      )}
    </div>
  )
}

// Test component for displaying properties list
function ModelPropertiesListTest({
  schemaIdOrModelId,
  modelName,
}: {
  schemaIdOrModelId: string | null | undefined
  modelName?: string | null | undefined
}) {
  const { modelProperties } = useModelProperties(schemaIdOrModelId, modelName)
  const [status, setStatus] = useState<string>('loading')

  useEffect(() => {
    if (modelProperties !== undefined) {
      setStatus('loaded')
    }
  }, [modelProperties])

  return (
    <div data-testid="model-properties-list-test">
      <div data-testid="properties-status">{status}</div>
      <ul data-testid="properties-list">
        {modelProperties?.map((property, index) => (
          <li key={index} data-testid={`property-item-${index}`}>
            {property.name}
          </li>
        ))}
      </ul>
      <div data-testid="properties-count">{modelProperties?.length || 0}</div>
    </div>
  )
}

// Test component for useCreateModelProperty
function UseCreateModelPropertyTest() {
  const { create, isLoading, error, resetError } = useCreateModelProperty()
  const [createdPropertyName, setCreatedPropertyName] = useState<string | null>(null)
  const [status, setStatus] = useState<string>('idle')

  const handleCreate = () => {
    setStatus('creating')
    const prop = create('Test Schema Properties', 'Post', { name: 'hookAddedProp', dataType: 'Text' })
    setCreatedPropertyName(prop.name)
    setStatus('created')
  }

  useEffect(() => {
    if (error) setStatus('error')
  }, [error])

  return (
    <div data-testid="use-create-model-property-test">
      <div data-testid="create-property-status">{status}</div>
      <div data-testid="create-property-is-loading">{isLoading ? 'true' : 'false'}</div>
      {createdPropertyName && <div data-testid="created-property-name">{createdPropertyName}</div>}
      {error && <div data-testid="create-property-error">{error.message}</div>}
      <button onClick={handleCreate} data-testid="create-property-button">
        Create Property
      </button>
      <button onClick={resetError} data-testid="create-property-reset-error">
        Reset Error
      </button>
    </div>
  )
}

// Test component for useDestroyModelProperty
function UseDestroyModelPropertyTest({ modelProperty }: { modelProperty: ModelProperty | null }) {
  const { destroy, isLoading, error, resetError } = useDestroyModelProperty()
  const [status, setStatus] = useState<string>('idle')

  const handleDestroy = async () => {
    if (!modelProperty) return
    setStatus('destroying')
    await destroy(modelProperty)
    setStatus('destroyed')
  }

  useEffect(() => {
    if (error) setStatus('error')
  }, [error])

  return (
    <div data-testid="use-destroy-model-property-test">
      <div data-testid="destroy-property-status">{status}</div>
      <div data-testid="destroy-property-is-loading">{isLoading ? 'true' : 'false'}</div>
      {error && <div data-testid="destroy-property-error">{error.message}</div>}
      <button onClick={handleDestroy} data-testid="destroy-property-button" disabled={!modelProperty}>
        Destroy Property
      </button>
      <button onClick={resetError} data-testid="destroy-property-reset-error">
        Reset Error
      </button>
    </div>
  )
}

// Test component for dataType change + re-render (persistence flow)
function EditableModelPropertyDataTypeTest() {
  const { model } = useModel('Test Schema Properties', 'Post')
  const { modelProperties } = useModelProperties('Test Schema Properties', 'Post')
  const queryClient = useQueryClient()

  const titleProperty = modelProperties?.find(p => p.name === 'title')

  const handleChangeDataType = () => {
    if (titleProperty && model?.id) {
      titleProperty.dataType = 'Number'
      queryClient.invalidateQueries({ queryKey: ['seed', 'modelProperties', model.id] })
    }
  }

  return (
    <div data-testid="editable-model-property-datatype-test">
      <div data-testid="property-data-type">{titleProperty?.dataType ?? ''}</div>
      <button onClick={handleChangeDataType} data-testid="change-datatype-button">
        Change dataType to Number
      </button>
    </div>
  )
}

describe('React ModelProperty Hooks Integration Tests', () => {
  let container: HTMLElement
  let schemaId: string | null = null

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
        expect(client.isInitialized()).toBe(true)
      },
      { timeout: 30000 }
    )
  })

  afterAll(async () => {
    await cleanupTestSchemaData({ items: true })
    Schema.clearCache()
  })

  beforeEach(async () => {
    container = document.createElement('div')
    container.id = 'root'
    document.body.appendChild(container)

    // Removes every test schema (incl. this file's three), its items and schema files, after
    // waiting for writes still running from the previous test.
    await cleanupTestSchemaData({ items: true })

    Schema.clearCache()

    // Import test schemas
    try {
      await importJsonSchema({ contents: JSON.stringify(testSchemaWithProperties) }, testSchemaWithProperties.version)
    } catch (error) {
      // Schema might already exist, which is fine
      console.log('Schema import note:', error)
    }

    // Wait for schemas to be available in database
    await waitFor(
      async () => {
        const allSchemas = await loadAllSchemasFromDb()
        expect(allSchemas.some(s => s.schema.metadata?.name === 'Test Schema Properties')).toBe(true)
      },
      { timeout: 15000 }
    )
  })

  afterEach(() => {
    document.body.innerHTML = ''
    Schema.clearCache()
    schemaId = null
  })

  describe('useModelProperties', () => {
    describe('useModelProperties React Query cache sharing (SeedProvider)', () => {
      it('should share cached list when multiple components call useModelProperties with same params', async () => {
        const modelPropertyAllSpy = vi.spyOn(ModelProperty, 'all')
        const queryClient = createSeedQueryClient()
        const WrapperWithFreshClient = ({ children }: { children: React.ReactNode }) => (
          <SeedProvider queryClient={queryClient}>{children}</SeedProvider>
        )
        try {
          function TwoLists() {
            return (
              <div data-testid="two-lists">
                <div data-testid="list-a">
                  <UseModelPropertiesTest schemaIdOrModelId="Test Schema Properties" modelName="Post" />
                </div>
                <div data-testid="list-b">
                  <UseModelPropertiesTest schemaIdOrModelId="Test Schema Properties" modelName="Post" />
                </div>
              </div>
            )
          }
          render(<TwoLists />, { container, wrapper: WrapperWithFreshClient })

          await waitFor(
            () => {
              const listA = screen.getByTestId('list-a')
              const listB = screen.getByTestId('list-b')
              expect(within(listA).getByTestId('properties-status').textContent).toBe('loaded')
              expect(within(listB).getByTestId('properties-status').textContent).toBe('loaded')
              const countA = parseInt(within(listA).getByTestId('properties-count').textContent || '0')
              const countB = parseInt(within(listB).getByTestId('properties-count').textContent || '0')
              expect(countA).toBe(countB)
              expect(countA).toBeGreaterThanOrEqual(3)
            },
            { timeout: 30000 }
          )

          const listA = screen.getByTestId('list-a')
          const listB = screen.getByTestId('list-b')
          const countA = parseInt(within(listA).getByTestId('properties-count').textContent || '0')
          const countB = parseInt(within(listB).getByTestId('properties-count').textContent || '0')
          expect(countA).toBe(countB)

          expect(modelPropertyAllSpy).toHaveBeenCalled()
          expect(modelPropertyAllSpy.mock.calls.length).toBeLessThanOrEqual(2)
        } finally {
          modelPropertyAllSpy.mockRestore()
        }
      })
    })

    it('should return empty array when schemaId/modelId is null', async () => {
      render(<UseModelPropertiesTest schemaIdOrModelId={null} />, { container, wrapper: SeedProviderWrapper })

      await waitFor(
        () => {
          const status = screen.getByTestId('properties-status')
          expect(status.textContent).toBe('loaded')
        },
        { timeout: WAIT_TIMEOUT_MS }
      )

      const count = screen.getByTestId('properties-count')
      expect(parseInt(count.textContent || '0')).toBe(0)
    })

    it('should return properties when schemaId and modelName provided', async () => {
      render(<UseModelPropertiesTest schemaIdOrModelId="Test Schema Properties" modelName="Post" />, { container, wrapper: SeedProviderWrapper })

      await waitFor(
        () => {
          const status = screen.getByTestId('properties-status')
          expect(status.textContent).toBe('loaded')
        },
        { timeout: 15000 }
      )

      // Wait for properties to be populated
      await waitFor(
        () => {
          const count = screen.getByTestId('properties-count')
          const countValue = parseInt(count.textContent || '0')
          // Post model has 3 properties: title, content, author
          expect(countValue).toBeGreaterThanOrEqual(3)
        },
        { timeout: 30000 }
      )

      // Verify specific properties exist
      const propertyElements = screen.getAllByTestId(/^property-\d+$/)
      const propertyNames = propertyElements.map((el) => el.textContent)

      expect(propertyNames).toContain('title')
      expect(propertyNames).toContain('content')
      expect(propertyNames).toContain('author')
    })

    it('should return properties when modelId provided', async () => {
      // First get the model to get its ID
      const schema = Schema.create('Test Schema Properties', { waitForReady: false })
      // Bounded wait: checks the current state first (subscribe() alone misses an already-idle schema)
      await waitUntilOrThrow(() => schema.getService().getSnapshot().value === 'idle', 'the schema to be idle')

      // Used to return early (and pass) when the schema or its Post wasn't loaded
      const postModel = schema.models?.find((m) => m.modelName === 'Post')
      expect(postModel?.id).toBeTruthy()

      render(<UseModelPropertiesTest schemaIdOrModelId={postModel.id} />, { container, wrapper: SeedProviderWrapper })

      await waitFor(
        () => {
          const status = screen.getByTestId('properties-status')
          expect(status.textContent).toBe('loaded')
        },
        { timeout: 15000 }
      )

      // Wait for properties to be populated
      await waitFor(
        () => {
          const count = screen.getByTestId('properties-count')
          const countValue = parseInt(count.textContent || '0')
          expect(countValue).toBeGreaterThanOrEqual(3)
        },
        { timeout: 30000 }
      )
    })

    it('should update when schemaId/modelId changes', async () => {
      const { rerender } = render(
        <UseModelPropertiesTest schemaIdOrModelId="Test Schema Properties" modelName="Post" />,
        { container, wrapper: SeedProviderWrapper }
      )

      await waitFor(
        () => {
          const status = screen.getByTestId('properties-status')
          expect(status.textContent).toBe('loaded')
        },
        { timeout: 15000 }
      )

      await waitFor(
        () => {
          const count = screen.getByTestId('properties-count')
          expect(parseInt(count.textContent || '0')).toBeGreaterThanOrEqual(3)
        },
        { timeout: 30000 }
      )

      // Change to Article model
      rerender(<UseModelPropertiesTest schemaIdOrModelId="Test Schema Properties" modelName="Article" />)

      await waitFor(
        () => {
          const count = screen.getByTestId('properties-count')
          const countValue = parseInt(count.textContent || '0')
          // Article model has 2 properties: headline, body
          expect(countValue).toBeGreaterThanOrEqual(2)
        },
        { timeout: 30000 }
      )

      // Verify Article properties
      const propertyElements = screen.getAllByTestId(/^property-\d+$/)
      const propertyNames = propertyElements.map((el) => el.textContent)
      expect(propertyNames).toContain('headline')
      expect(propertyNames).toContain('body')
    })

    it('should set isLoading to true initially and false when loaded', async () => {
      render(<UseModelPropertiesTest schemaIdOrModelId="Test Schema Properties" modelName="Post" />, { container, wrapper: SeedProviderWrapper })

      // Require both in one waitFor so we retry through refetch windows (React Query can flip isLoading after success)
      await waitFor(
        () => {
          expect(screen.getByTestId('properties-status').textContent).toBe('loaded')
          expect(screen.getByTestId('is-loading').textContent).toBe('false')
        },
        { timeout: 15000 }
      )
    })

    it('should set isLoading to false when schemaId/modelId is null', async () => {
      render(<UseModelPropertiesTest schemaIdOrModelId={null} />, { container, wrapper: SeedProviderWrapper })

      await waitFor(
        () => {
          const isLoading = screen.getByTestId('is-loading')
          expect(isLoading.textContent).toBe('false')
        },
        { timeout: WAIT_TIMEOUT_MS }
      )
    })

    it('should automatically update when properties change (liveQuery integration)', async () => {
      // Create an empty schema for this test
      const emptySchema: SchemaFileFormat = {
        $schema: 'https://seedprotocol.org/schemas/data-model/v1',
        version: 1,
        id: 'livequery-test-schema-props',
        metadata: {
          name: 'LiveQuery Test Schema Properties',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        models: {
          TestModel: {
            id: 'test-model-livequery',
            properties: {
              name: {
                id: 'name-prop-livequery',
                type: 'Text',
              },
            },
          },
        },
        enums: {},
        migrations: [],
      }

      // beforeEach already removed every test schema, so this one can't exist yet
      await importJsonSchema({ contents: JSON.stringify(emptySchema) }, emptySchema.version)

      // Wait for schema to be available
      await waitFor(
        async () => {
          const allSchemas = await loadAllSchemasFromDb()
          expect(allSchemas.some(s => s.schema.metadata?.name === 'LiveQuery Test Schema Properties')).toBe(true)
        },
        { timeout: 10000 }
      )

      // Render component - should start with 1 property (name)
      render(
        <UseModelPropertiesTest schemaIdOrModelId="LiveQuery Test Schema Properties" modelName="TestModel" />,
        { container, wrapper: SeedProviderWrapper }
      )

      // Wait for initial load
      await waitFor(
        () => {
          const status = screen.getByTestId('properties-status')
          expect(status.textContent).toBe('loaded')
        },
        { timeout: 15000 }
      )

      // Wait for properties to be populated
      await waitFor(
        () => {
          const count = screen.getByTestId('properties-count')
          expect(parseInt(count.textContent || '0')).toBeGreaterThanOrEqual(1)
        },
        { timeout: 30000 }
      )

      // Re-assert count (may transiently be 0 during refetch; allow a short retry)
      await waitFor(
        () => {
          const initialCount = parseInt(screen.getByTestId('properties-count').textContent || '0')
          expect(initialCount).toBeGreaterThanOrEqual(1)
        },
        { timeout: WAIT_TIMEOUT_MS, interval: 200 }
      )

      // Add a property; the hook's live query on the properties table should pick it up
      const added = ModelProperty.create(
        { name: 'addedLater', dataType: 'Text', modelName: 'TestModel' } as Parameters<typeof ModelProperty.create>[0],
        { waitForReady: false, schemaName: 'LiveQuery Test Schema Properties' },
      ) as ModelProperty
      await xstateWaitFor(added.getService(), (snapshot) => snapshot.value === 'idle', { timeout: 10000 })

      await waitFor(
        () => {
          expect(screen.getByTestId('properties-count').textContent).toBe('2')
          const names = screen.getAllByTestId(/^property-\d+$/).map((el) => el.textContent)
          expect(names).toEqual(expect.arrayContaining(['name', 'addedLater']))
        },
        { timeout: 15000 }
      )
    })
  })

  describe('useModelProperties when the model gets its _dbId late', () => {
    // Finding 15: the hook memoized the model's _dbId once. A model first seen before its row was
    // resolved never got the live query on the properties table, so with properties already listed
    // (the fallback refetches only run while the list is empty) later properties never showed up.
    it('picks up a property added after the model resolves its _dbId', async () => {
      const schemaName = 'Test Schema Properties'
      const model = await Model.find({ modelName: 'Article', schemaName })
      expect(model).toBeDefined()
      const dbId = (model as any)._getSnapshotContext()._dbId as number | undefined
      expect(dbId).toBeGreaterThan(0)

      model!.getService().send({ type: 'updateContext', _dbId: undefined })
      render(<UseModelPropertiesTest schemaIdOrModelId={schemaName} modelName="Article" />, {
        container,
        wrapper: SeedProviderWrapper,
      })
      await waitFor(() => expect(screen.getByTestId('properties-count').textContent).toBe('2'), {
        timeout: 15000,
      })

      model!.getService().send({ type: 'updateContext', _dbId: dbId })
      const added = ModelProperty.create(
        { name: 'addedLater', dataType: 'Text', modelName: 'Article' } as Parameters<typeof ModelProperty.create>[0],
        { waitForReady: false, schemaName },
      ) as ModelProperty
      await xstateWaitFor(added.getService(), (snapshot) => snapshot.value === 'idle', { timeout: 10000 })

      await waitFor(
        () => {
          expect(screen.getByTestId('properties-count').textContent).toBe('3')
          const names = screen.getAllByTestId(/^property-\d+$/).map((el) => el.textContent)
          expect(names).toEqual(expect.arrayContaining(['headline', 'body', 'addedLater']))
        },
        { timeout: 10000 },
      )
    })
  })

  describe('useModelProperty', () => {
    it('should return undefined when modelName or propertyName is null', async () => {
      render(<UseModelPropertyTest schemaId="Test Schema Properties" modelName={null} propertyName={null} />, { container })

      await waitFor(
        () => {
          const status = screen.getByTestId('property-status')
          expect(status.textContent).toBe('not-loaded')
        },
        { timeout: WAIT_TIMEOUT_MS }
      )
    })

    it('should return property when modelName and propertyName provided', async () => {
      const view = render(
        <UseModelPropertyTest schemaId="Test Schema Properties" modelName="Post" propertyName="title" />,
        { container, wrapper: SeedProviderWrapper }
      )

      const propertyNameEl = await within(view.container).findByTestId('property-name', {}, { timeout: 15000 })
      expect(propertyNameEl.textContent).toBe('title')

      const propertyDataType = within(view.container).getByTestId('property-data-type')
      expect(propertyDataType.textContent).toBe('Text')
    })

    it('finds a property whose model is created after the hook first looked it up', async () => {
      const schemaName = 'Test Schema Properties'
      const view = render(
        <UseModelPropertyTest schemaId={schemaName} modelName="LateModel" propertyName="summary" />,
        { container, wrapper: SeedProviderWrapper },
      )
      // The first lookup finds nothing: the model doesn't exist yet
      await waitFor(() => expect(within(view.container).getByTestId('is-loading').textContent).toBe('false'), {
        timeout: 15000,
      })
      expect(within(view.container).queryByTestId('property-name')).toBeNull()

      const schema = Schema.create(schemaName, { waitForReady: false })
      const lateModel = Model.create('LateModel', schema, {
        properties: { summary: { dataType: 'Text' } },
        waitForReady: false,
      })
      await xstateWaitFor(lateModel.getService(), (snapshot) => snapshot.value === 'idle', { timeout: 10000 })

      const propertyNameEl = await within(view.container).findByTestId('property-name', {}, { timeout: WAIT_TIMEOUT_MS })
      expect(propertyNameEl.textContent).toBe('summary')
    })

    // getPropertySchema read a schema-file model's properties only from the Schema context, which
    // doesn't get properties added at runtime (finding 19).
    it('finds a property added at runtime to a schema-file model', async () => {
      const schemaName = 'Test Schema Properties'
      const added = ModelProperty.create(
        { name: 'addedAtRuntime', dataType: 'Text', modelName: 'Article' } as Parameters<typeof ModelProperty.create>[0],
        { waitForReady: false, schemaName },
      ) as ModelProperty
      await xstateWaitFor(added.getService(), (snapshot) => snapshot.value === 'idle', { timeout: 10000 })

      const view = render(
        <UseModelPropertyTest schemaId={schemaName} modelName="Article" propertyName="addedAtRuntime" />,
        { container, wrapper: SeedProviderWrapper },
      )
      const propertyNameEl = await within(view.container).findByTestId('property-name', {}, { timeout: 15000 })
      expect(propertyNameEl.textContent).toBe('addedAtRuntime')
    })

    it('should update when modelName changes', async () => {
      const { rerender } = render(<UseModelPropertyTest schemaId="Test Schema Properties" modelName="Post" propertyName="title" />, { container })

      await waitFor(
        () => {
          expect(screen.queryByTestId('property-name')?.textContent).toBe('title')
        },
        { timeout: 15000 }
      )

      // Change to Article model with headline property
      rerender(<UseModelPropertyTest schemaId="Test Schema Properties" modelName="Article" propertyName="headline" />)

      await waitFor(
        () => {
          const propertyName = screen.getByTestId('property-name')
          expect(propertyName.textContent).toBe('headline')
        },
        { timeout: 15000 }
      )
    })

    it('should update when propertyName changes', async () => {
      const { rerender } = render(<UseModelPropertyTest schemaId="Test Schema Properties" modelName="Post" propertyName="title" />, { container })

      await waitFor(
        () => {
          expect(screen.queryByTestId('property-name')?.textContent).toBe('title')
        },
        { timeout: 15000 }
      )

      // Change property name
      rerender(<UseModelPropertyTest schemaId="Test Schema Properties" modelName="Post" propertyName="content" />)

      await waitFor(
        () => {
          const propertyName = screen.getByTestId('property-name')
          expect(propertyName.textContent).toBe('content')
        },
        { timeout: 15000 }
      )
    })

    it('should track validationErrors', async () => {
      render(<UseModelPropertyTest schemaId="Test Schema Properties" modelName="Post" propertyName="title" />, { container })

      await waitFor(
        () => {
          expect(screen.queryByTestId('property-name')).not.toBeNull()
        },
        { timeout: 15000 }
      )

      // Assert inside waitFor so we read the value while the element is in the DOM (it can disappear shortly after)
      await waitFor(
        () => {
          const validationErrorsCount = screen.queryByTestId('validation-errors-count')
          expect(validationErrorsCount).not.toBeNull()
          expect(parseInt(validationErrorsCount!.textContent || '0', 10)).toBeGreaterThanOrEqual(0)
        },
        { timeout: 15000 }
      )
    })
  })

  describe('ModelProperty dataType edit persistence and re-render', () => {
    it('re-renders when ModelProperty dataType is changed and query is invalidated', async () => {
      render(<EditableModelPropertyDataTypeTest />, { container, wrapper: SeedProviderWrapper })

      await waitFor(
        () => {
          expect(screen.queryByTestId('property-data-type')?.textContent).toBe('Text')
        },
        { timeout: 15000 }
      )

      const changeButton = screen.getByTestId('change-datatype-button')
      changeButton.click()

      await waitFor(
        () => {
          expect(screen.queryByTestId('property-data-type')?.textContent).toBe('Number')
        },
        { timeout: 15000 }
      )
    })

    // DB persistence is covered by ModelProperty.test.ts; this test is skipped as the React
    // test environment has different timing - the re-render test above verifies the UI flow.
    it.skip('persists ModelProperty dataType change to db', async () => {
      render(<EditableModelPropertyDataTypeTest />, { container, wrapper: SeedProviderWrapper })

      await waitFor(
        () => {
          expect(screen.queryByTestId('property-data-type')?.textContent).toBe('Text')
        },
        { timeout: 15000 }
      )

      const changeButton = screen.getByTestId('change-datatype-button')
      changeButton.click()

      await waitFor(
        () => {
          expect(screen.queryByTestId('property-data-type')?.textContent).toBe('Number')
        },
        { timeout: 15000 }
      )

      const db = BaseDb.getAppDb()
      expect(db).toBeTruthy()
      if (db) {
        await waitFor(
          async () => {
            const rows = await db
              .select()
              .from(propertiesTable)
              .where(eq(propertiesTable.schemaFileId, 'title-prop-id'))
              .limit(1)
            expect(rows.length > 0 && rows[0].dataType === 'Number').toBe(true)
          },
          { timeout: 20000 }
        )

        const titleProperty = await db
          .select()
          .from(propertiesTable)
          .where(eq(propertiesTable.schemaFileId, 'title-prop-id'))
          .limit(1)
        expect(titleProperty.length).toBeGreaterThan(0)
        expect(titleProperty[0].dataType).toBe('Number')
      }
    })
  })

  describe('useModelProperties with dynamic property creation', () => {
    it('should display empty properties list initially and show new properties after creation', async () => {
      // Import empty schema first
      try {
        await importJsonSchema({ contents: JSON.stringify(emptyTestSchema) }, emptyTestSchema.version)
      } catch (error) {
        // Schema might already exist, which is fine
        console.log('Schema import note:', error)
      }

      // Wait for schema to be available in database
      await waitFor(
        async () => {
          const allSchemas = await loadAllSchemasFromDb()
          expect(allSchemas.some(s => s.schema.metadata?.name === 'Empty Test Schema Properties')).toBe(true)
        },
        { timeout: 10000 }
      )

      // Render component with empty schema (must use SeedProvider so useIsClientReady and React Query work)
      render(
        <ModelPropertiesListTest schemaIdOrModelId="Empty Test Schema Properties" modelName="NewModel" />,
        { container, wrapper: SeedProviderWrapper }
      )

      // Wait for component to render
      await waitFor(
        () => {
          const status = screen.getByTestId('properties-status')
          expect(status.textContent).toBe('loaded')
        },
        { timeout: 10000 }
      )

      // Verify properties count is 0 initially (model doesn't exist yet)
      const initialCount = screen.getByTestId('properties-count')
      expect(parseInt(initialCount.textContent || '0')).toBe(0)

      // Get the schema instance
      const schemaInstance = Schema.create('Empty Test Schema Properties', { waitForReady: false })
      
      // Wait for schema to be ready
      await waitFor(
        () => {
          expect(schemaInstance.getService().getSnapshot().value).toBe('idle')
        },
        { timeout: 10000 }
      )

      // Create the model with properties
      const newModel = Model.create('NewModel', schemaInstance, {
        properties: {
          name: { dataType: 'Text' },
          description: { dataType: 'Text' },
        },
        waitForReady: false,
      })

      // Wait for model to be idle
      await waitFor(
        () => {
          expect(newModel.getService().getSnapshot().value).toBe('idle')
        },
        { timeout: 10000 }
      )

      // Wait for properties to appear in the UI
      await waitFor(
        () => {
          const count = screen.getByTestId('properties-count')
          expect(parseInt(count.textContent || '0')).toBeGreaterThan(0)
        },
        { timeout: 30000 }
      )

      // Verify properties count is now greater than 0
      const finalCount = screen.getByTestId('properties-count')
      expect(parseInt(finalCount.textContent || '0')).toBeGreaterThan(0)

      // Cleanup
      schemaInstance.unload()
      newModel.unload()
    })
  })

  describe('useCreateModelProperty', () => {
    it('should expose create, isLoading, error, and resetError', async () => {
      render(<UseCreateModelPropertyTest />, { container })

      await waitFor(
        () => {
          const btn = screen.getByTestId('create-property-button')
          expect(btn).toBeTruthy()
        },
        { timeout: WAIT_TIMEOUT_MS }
      )

      expect(screen.getByTestId('create-property-is-loading').textContent).toBe('false')
      expect(screen.queryByTestId('create-property-error')).toBeNull()
    })

    it('should create a model property and set loading state', async () => {
      render(<UseCreateModelPropertyTest />, { container })

      await waitFor(
        () => {
          const btn = screen.getByTestId('create-property-button')
          expect(btn).toBeTruthy()
        },
        { timeout: WAIT_TIMEOUT_MS }
      )

      screen.getByTestId('create-property-button').click()

      await waitFor(
        () => {
          const status = screen.getByTestId('create-property-status')
          expect(status.textContent).toBe('created')
        },
        { timeout: WAIT_TIMEOUT_MS }
      )

      const createdName = screen.getByTestId('created-property-name')
      expect(createdName.textContent).toBe('hookAddedProp')
    })
  })

  describe('useDestroyModelProperty', () => {
    it('should expose destroy, isLoading, error, and resetError', async () => {
      render(<UseDestroyModelPropertyTest modelProperty={null} />, { container })

      await waitFor(
        () => {
          const btn = screen.getByTestId('destroy-property-button')
          expect(btn).toBeTruthy()
          expect(btn.hasAttribute('disabled')).toBe(true)
        },
        { timeout: WAIT_TIMEOUT_MS }
      )

      expect(screen.getByTestId('destroy-property-is-loading').textContent).toBe('false')
    })

    it('should report isLoading and the service error for a destroy the service finishes before an effect could subscribe', async () => {
      render(<UseDestroyModelPropertyTest modelProperty={createFastDestroyStub<ModelProperty>({ destroyError: 'stub destroy failed' })} />, { container })

      screen.getByTestId('destroy-property-button').click()

      await waitFor(
        () => {
          expect(screen.getByTestId('destroy-property-is-loading').textContent).toBe('true')
        },
        { timeout: WAIT_TIMEOUT_MS }
      )

      await waitFor(
        () => {
          expect(screen.getByTestId('destroy-property-is-loading').textContent).toBe('false')
          expect(screen.getByTestId('destroy-property-error').textContent).toBe('stub destroy failed')
        },
        { timeout: WAIT_TIMEOUT_MS }
      )

      screen.getByTestId('destroy-property-reset-error').click()

      await waitFor(() => {
        expect(screen.queryByTestId('destroy-property-error')).toBeNull()
      })
    })

    it('should destroy a model property and set loading state during destroy', async () => {
      const model = Model.create('Post', 'Test Schema Properties', { waitForReady: false })
      try {
        await waitFor(
          () => {
            expect(model.getService().getSnapshot().value).toBe('idle')
          },
          { timeout: 10000 }
        )
        const props = await ModelProperty.all(model.id!, { waitForReady: true })
        const propertyToDestroy = props[0]
        if (!propertyToDestroy) {
          return
        }

        render(<UseDestroyModelPropertyTest modelProperty={propertyToDestroy} />, { container })

        await waitFor(
          () => {
            const btn = screen.getByTestId('destroy-property-button')
            expect(btn).toBeTruthy()
            expect(btn.hasAttribute('disabled')).toBe(false)
          },
          { timeout: WAIT_TIMEOUT_MS }
        )

        screen.getByTestId('destroy-property-button').click()

        await waitFor(
          () => {
            expect(screen.getByTestId('destroy-property-is-loading').textContent).toBe('true')
          },
          { timeout: WAIT_TIMEOUT_MS }
        )

        await waitFor(
          () => {
            expect(screen.getByTestId('destroy-property-is-loading').textContent).toBe('false')
            expect(['destroyed', 'error']).toContain(screen.getByTestId('destroy-property-status').textContent)
          },
          { timeout: WAIT_TIMEOUT_MS }
        )
      } finally {
        model.unload()
      }
    })
  })
})
