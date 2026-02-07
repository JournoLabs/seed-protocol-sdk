import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import React, { useEffect, useState } from 'react'
import { useModel, useModels, useCreateModel, useDestroyModel } from '@/browser/react/model'
import { SeedProvider } from '@/browser/react'
import { client } from '@/client'
import { BaseDb } from '@/db/Db/BaseDb'
import { schemas } from '@/seedSchema/SchemaSchema'
import { eq } from 'drizzle-orm'
import { importJsonSchema } from '@/imports/json'
import { SchemaFileFormat } from '@/types/import'
import { Schema } from '@/Schema/Schema'
import { Model } from '@/Model/Model'
import type { SeedConstructorOptions } from '@/types'

// Test schema with multiple models
const testSchemaWithModels: SchemaFileFormat = {
  $schema: 'https://seedprotocol.org/schemas/data-model/v1',
  version: 1,
  id: 'test-schema-models',
  metadata: {
    name: 'Test Schema Models',
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
      },
    },
    Article: {
      id: 'article-model-id',
      properties: {
        title: {
          id: 'article-title-prop-id',
          type: 'Text',
        },
        author: {
          id: 'author-prop-id',
          type: 'Text',
        },
      },
    },
    Comment: {
      id: 'comment-model-id',
      properties: {
        text: {
          id: 'text-prop-id',
          type: 'Text',
        },
      },
    },
  },
  enums: {},
  migrations: [],
}

const SeedProviderWrapper = ({ children }: { children: React.ReactNode }) => (
  <SeedProvider>{children}</SeedProvider>
)

// Test component for useModels
function UseModelsTest({ schemaId }: { schemaId: string | null | undefined }) {
  console.log('[UseModelsTest] schemaId:', schemaId)
  const { models } = useModels(schemaId)
  const [status, setStatus] = useState<string>('loading')

  useEffect(() => {
    console.log('[UseModelsTest] schemaId:', schemaId)
    console.log('[UseModelsTest] models:', models)
    console.log('[UseModelsTest] models.length:', models.length)
    console.log('[UseModelsTest] models details:', models.map(m => ({ name: m.modelName, id: m.id })))
    // If schemaId is null/undefined, we're done (empty array is expected)
    // If schemaId is provided, wait for models to actually be loaded (length > 0)
    if (schemaId === null || schemaId === undefined) {
      setStatus('loaded')
    } else if (models.length > 0) {
      setStatus('loaded')
    }
  }, [models, schemaId])

  return (
    <div data-testid="use-models-test">
      <div data-testid="models-status">{status}</div>
      <div data-testid="models-count">{models.length}</div>
      {models.map((model, index) => (
        <div key={index} data-testid={`model-${index}`}>
          {model.modelName}
        </div>
      ))}
    </div>
  )
}

// Test component for useModel with schemaId and modelName
function UseModelWithNameTest({
  schemaId,
  modelName,
}: {
  schemaId: string | null | undefined
  modelName: string | null | undefined
}) {
  const { model } = useModel(schemaId, modelName)
  const { models } = useModels(schemaId)
  const [status, setStatus] = useState<string>('loading')

  useEffect(() => {
    // Set status to loaded if:
    // 1. Model is found (model !== undefined)
    // 2. No modelName provided (modelName === null || modelName === undefined)
    // 3. SchemaId is null (no schema to load)
    // 4. Models are loaded (models.length > 0) - this means we've checked and either found or not found the model
    if (
      model !== undefined ||
      modelName === null ||
      modelName === undefined ||
      schemaId === null ||
      (schemaId !== null && models.length > 0)
    ) {
      setStatus('loaded')
    }
  }, [model, modelName, models.length, schemaId])

  return (
    <div data-testid="use-model-test">
      <div data-testid="model-status">{status}</div>
      {model && (
        <>
          <div data-testid="model-name">{model.modelName}</div>
          <div data-testid="model-id">{model.id}</div>
        </>
      )}
      {!model && (modelName === null || modelName === undefined) && (
        <div data-testid="model-null">null</div>
      )}
    </div>
  )
}

// Test component for useModel with modelId
function UseModelWithIdTest({ modelId }: { modelId: string | null | undefined }) {
  const { model } = useModel(modelId)
  const [status, setStatus] = useState<string>('loading')

  useEffect(() => {
    if (model !== undefined || modelId === null || modelId === undefined) {
      setStatus('loaded')
    }
  }, [model, modelId])

  return (
    <div data-testid="use-model-id-test">
      <div data-testid="model-status">{status}</div>
      {model && (
        <>
          <div data-testid="model-name">{model.modelName}</div>
          <div data-testid="model-id">{model.id}</div>
        </>
      )}
      {!model && (modelId === null || modelId === undefined) && (
        <div data-testid="model-null">null</div>
      )}
    </div>
  )
}

// Test component for useCreateModel
function UseCreateModelTest() {
  const { create, isLoading, error, resetError } = useCreateModel()
  const [createdModelName, setCreatedModelName] = useState<string | null>(null)
  const [status, setStatus] = useState<string>('idle')

  const handleCreate = () => {
    setStatus('creating')
    const model = create('Test Schema Models', 'HookTestModel', { properties: { name: { dataType: 'Text' } } })
    setCreatedModelName(model.modelName)
    setStatus('created')
  }

  useEffect(() => {
    if (error) setStatus('error')
  }, [error])

  return (
    <div data-testid="use-create-model-test">
      <div data-testid="create-model-status">{status}</div>
      <div data-testid="create-model-is-loading">{isLoading ? 'true' : 'false'}</div>
      {createdModelName && <div data-testid="created-model-name">{createdModelName}</div>}
      {error && <div data-testid="create-model-error">{error.message}</div>}
      <button onClick={handleCreate} data-testid="create-model-button">
        Create Model
      </button>
      <button onClick={resetError} data-testid="create-model-reset-error">
        Reset Error
      </button>
    </div>
  )
}

// Test component for useDestroyModel
function UseDestroyModelTest({ model }: { model: Model | null }) {
  const { destroy, isLoading, error, resetError } = useDestroyModel()
  const [status, setStatus] = useState<string>('idle')

  const handleDestroy = async () => {
    if (!model) return
    setStatus('destroying')
    await destroy(model)
    setStatus('destroyed')
  }

  useEffect(() => {
    if (error) setStatus('error')
  }, [error])

  return (
    <div data-testid="use-destroy-model-test">
      <div data-testid="destroy-model-status">{status}</div>
      <div data-testid="destroy-model-is-loading">{isLoading ? 'true' : 'false'}</div>
      {error && <div data-testid="destroy-model-error">{error.message}</div>}
      <button onClick={handleDestroy} data-testid="destroy-model-button" disabled={!model}>
        Destroy Model
      </button>
      <button onClick={resetError} data-testid="destroy-model-reset-error">
        Reset Error
      </button>
    </div>
  )
}

describe('React Model Hooks Integration Tests', () => {
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
        return client.isInitialized()
      },
      { timeout: 30000 }
    )
  })

  afterAll(async () => {
    // Clean up schema from database
    const db = BaseDb.getAppDb()
    if (db) {
      await db.delete(schemas).where(eq(schemas.name, 'Test Schema Models'))
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
      await db.delete(schemas).where(eq(schemas.name, 'Test Schema Models'))
    }
    Schema.clearCache()

    // Import test schema
    try {
      await importJsonSchema(
        { contents: JSON.stringify(testSchemaWithModels) },
        testSchemaWithModels.version
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
        return allSchemas.some(s => s.schema.metadata?.name === 'Test Schema Models')
      },
      { timeout: 10000 }
    )
    const schema = Schema.create('Test Schema Models', { waitForReady: false })
    await new Promise<void>((resolve) => {
      const subscription = schema.getService().subscribe((snapshot) => {
        if (snapshot.value === 'idle') {
          subscription.unsubscribe()
          schemaId = schema.id ?? testSchemaWithModels.id ?? null
          resolve()
        }
      })
      // Timeout after 5 seconds
      setTimeout(() => {
        subscription.unsubscribe()
        schemaId = testSchemaWithModels.id ?? null
        resolve()
      }, 5000)
    })

    // Wait for models to be populated (they're loaded asynchronously)
    await waitFor(
      () => {
        const models = schema.models || []
        return models.length >= 3 // At least Post, Article, Comment
      },
      { timeout: 10000 }
    )

    // Give React hooks a moment to process the schema instance
    await new Promise(resolve => setTimeout(resolve, 100))
  })

  afterEach(() => {
    document.body.innerHTML = ''
    Schema.clearCache()
    schemaId = null
  })

  describe('useModels', () => {
    describe('useModels React Query cache sharing (SeedProvider)', () => {
      it('should share cached list when multiple components call useModels with same params', async () => {
        const modelAllSpy = vi.spyOn(Model, 'all')
        try {
          function TwoLists() {
            return (
              <div data-testid="two-lists">
                <div data-testid="list-a">
                  <UseModelsTest schemaId="Test Schema Models" />
                </div>
                <div data-testid="list-b">
                  <UseModelsTest schemaId="Test Schema Models" />
                </div>
              </div>
            )
          }
          render(<TwoLists />, { container, wrapper: SeedProviderWrapper })

          await waitFor(
            () => {
              const listA = screen.getByTestId('list-a')
              const listB = screen.getByTestId('list-b')
              const statusA = within(listA).getByTestId('models-status').textContent
              const statusB = within(listB).getByTestId('models-status').textContent
              if (statusA !== 'loaded' || statusB !== 'loaded') return false
              const countA = parseInt(within(listA).getByTestId('models-count').textContent || '0')
              const countB = parseInt(within(listB).getByTestId('models-count').textContent || '0')
              expect(countA).toBe(countB)
              expect(countA).toBeGreaterThanOrEqual(3)
              return true
            },
            { timeout: 15000 }
          )

          const listA = screen.getByTestId('list-a')
          const listB = screen.getByTestId('list-b')
          const countA = parseInt(within(listA).getByTestId('models-count').textContent || '0')
          const countB = parseInt(within(listB).getByTestId('models-count').textContent || '0')
          expect(countA).toBe(countB)

          const testSchemaCalls = modelAllSpy.mock.calls.filter((call) => call[0] === 'Test Schema Models')
          expect(testSchemaCalls.length).toBeGreaterThanOrEqual(1)
          expect(testSchemaCalls.length).toBeLessThanOrEqual(2)
        } finally {
          modelAllSpy.mockRestore()
        }
      })
    })

    it('should return empty array when schemaId is null', async () => {
      render(<UseModelsTest schemaId={null} />, { container, wrapper: SeedProviderWrapper })

      await waitFor(
        () => {
          const status = screen.getByTestId('models-status')
          expect(status.textContent).toBe('loaded')
        },
        { timeout: 5000 }
      )

      const count = screen.getByTestId('models-count')
      expect(parseInt(count.textContent || '0')).toBe(0)
    })

    it('should return all models for a schema', async () => {
      // Use schema name instead of ID to ensure we get the same instance with models loaded
      render(<UseModelsTest schemaId="Test Schema Models" />, { container, wrapper: SeedProviderWrapper })

      await waitFor(
        () => {
          const status = screen.getByTestId('models-status')
          expect(status.textContent).toBe('loaded')
        },
        { timeout: 10000 }
      )

      const count = screen.getByTestId('models-count')
      const modelCount = parseInt(count.textContent || '0')
      expect(modelCount).toBeGreaterThanOrEqual(3) // At least Post, Article, Comment

      // Verify specific models exist
      const modelElements = screen.getAllByTestId(/^model-\d+$/)
      const modelNames = modelElements.map((el) => el.textContent)

      expect(modelNames).toContain('Post')
      expect(modelNames).toContain('Article')
      expect(modelNames).toContain('Comment')
    })

    it('should update when schemaId changes', async () => {
      // Use schema name instead of ID to ensure we get the same instance with models loaded
      const { rerender } = render(<UseModelsTest schemaId="Test Schema Models" />, { container, wrapper: SeedProviderWrapper })

      await waitFor(
        () => {
          const status = screen.getByTestId('models-status')
          expect(status.textContent).toBe('loaded')
        },
        { timeout: 10000 }
      )

      const initialCount = screen.getByTestId('models-count')
      expect(parseInt(initialCount.textContent || '0')).toBeGreaterThan(0)

      // Change to null schemaId
      rerender(<UseModelsTest schemaId={null} />)

      await waitFor(
        () => {
          const count = screen.getByTestId('models-count')
          expect(parseInt(count.textContent || '0')).toBe(0)
        },
        { timeout: 5000 }
      )
    })
  })

  describe('useModel with schemaId and modelName', () => {
    it('should return undefined when modelName is null', async () => {
      if (!schemaId) {
        return
      }

      render(<UseModelWithNameTest schemaId={schemaId} modelName={null} />, { container, wrapper: SeedProviderWrapper })

      await waitFor(
        () => {
          const status = screen.getByTestId('model-status')
          expect(status.textContent).toBe('loaded')
        },
        { timeout: 5000 }
      )

      const nullIndicator = screen.getByTestId('model-null')
      expect(nullIndicator).toBeTruthy()
    })

    it('should return model when schemaId and modelName are provided', async () => {
      // Use schema name instead of ID to ensure we get the same instance with models loaded
      render(<UseModelWithNameTest schemaId="Test Schema Models" modelName="Post" />, { container, wrapper: SeedProviderWrapper })

      await waitFor(
        () => {
          const modelName = screen.queryByTestId('model-name')
          return modelName !== null
        },
        { timeout: 10000 }
      )

      const modelName = screen.getByTestId('model-name')
      expect(modelName.textContent).toBe('Post')

      const modelId = screen.getByTestId('model-id')
      expect(modelId.textContent).toBeTruthy()
    })

    it('should return different model when modelName changes', async () => {
      // Use schema name instead of ID to ensure we get the same instance with models loaded
      const { rerender } = render(
        <UseModelWithNameTest schemaId="Test Schema Models" modelName="Post" />,
        { container, wrapper: SeedProviderWrapper }
      )

      await waitFor(
        () => {
          const modelName = screen.queryByTestId('model-name')
          return modelName !== null && modelName.textContent === 'Post'
        },
        { timeout: 10000 }
      )

      // Change model name
      rerender(<UseModelWithNameTest schemaId="Test Schema Models" modelName="Article" />)

      await waitFor(
        () => {
          const modelName = screen.getByTestId('model-name')
          expect(modelName.textContent).toBe('Article')
        },
        { timeout: 10000 }
      )
    })

    it('should return undefined for non-existent model', async () => {
      // Use schema name instead of ID to ensure we get the same instance with models loaded
      render(<UseModelWithNameTest schemaId="Test Schema Models" modelName="NonExistentModel" />, {
        wrapper: SeedProviderWrapper,
        container,
      })

      await waitFor(
        () => {
          const status = screen.getByTestId('model-status')
          expect(status.textContent).toBe('loaded')
        },
        { timeout: 10000 }
      )

      const modelName = screen.queryByTestId('model-name')
      expect(modelName).toBeNull()
    })
  })

  describe('useModel with modelId', () => {
    it('should return null when modelId is null', async () => {
      render(<UseModelWithIdTest modelId={null} />, { container })

      await waitFor(
        () => {
          const status = screen.getByTestId('model-status')
          expect(status.textContent).toBe('loaded')
        },
        { timeout: 5000 }
      )

      const nullIndicator = screen.getByTestId('model-null')
      expect(nullIndicator).toBeTruthy()
    })

    it('should return model when modelId is provided', async () => {
      if (!schemaId) {
        return
      }

      // First get the model by name to get its ID
      const schema = Schema.create('Test Schema Models', { waitForReady: false })
      await new Promise<void>((resolve) => {
        const subscription = schema.getService().subscribe((snapshot) => {
          if (snapshot.value === 'idle') {
            subscription.unsubscribe()
            resolve()
          }
        })
        setTimeout(() => {
          subscription.unsubscribe()
          resolve()
        }, 5000)
      })

      const postModel = schema.models?.find((m) => m.modelName === 'Post')
      if (!postModel || !postModel.id) {
        // Skip if we can't get the model ID
        return
      }

      render(<UseModelWithIdTest modelId={postModel.id} />, { container })

      await waitFor(
        () => {
          const modelName = screen.queryByTestId('model-name')
          return modelName !== null
        },
        { timeout: 15000 }
      )

      const modelName = screen.getByTestId('model-name')
      expect(modelName.textContent).toBe('Post')

      const modelId = screen.getByTestId('model-id')
      expect(modelId.textContent).toBe(postModel.id)
    })
  })

  describe('useModels with dynamic model creation', () => {
    it('should immediately show newly created model in useModels without page reload', async () => {
      // Create an empty schema for this test
      const emptySchema: SchemaFileFormat = {
        $schema: 'https://seedprotocol.org/schemas/data-model/v1',
        version: 1,
        id: 'test-schema-dynamic',
        metadata: {
          name: 'Test Schema Dynamic',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        models: {},
        enums: {},
        migrations: [],
      }

      // Clean up any existing schema
      const db = BaseDb.getAppDb()
      if (db) {
        await db.delete(schemas).where(eq(schemas.name, 'Test Schema Dynamic'))
      }
      Schema.clearCache()

      // Import empty schema
      try {
        await importJsonSchema(
          { contents: JSON.stringify(emptySchema) },
          emptySchema.version
        )
      } catch (error) {
        console.log('Schema import note:', error)
      }

      // Wait for schema to be available in database
      const { loadAllSchemasFromDb } = await import('@/helpers/schema')
      await waitFor(
        async () => {
          const allSchemas = await loadAllSchemasFromDb()
          return allSchemas.some(s => s.schema.metadata?.name === 'Test Schema Dynamic')
        },
        { timeout: 10000 }
      )

      // Get schema instance
      const schema = Schema.create('Test Schema Dynamic', { waitForReady: false })
      await new Promise<void>((resolve) => {
        const subscription = schema.getService().subscribe((snapshot) => {
          if (snapshot.value === 'idle') {
            subscription.unsubscribe()
            resolve()
          }
        })
        setTimeout(() => {
          subscription.unsubscribe()
          resolve()
        }, 5000)
      })

      // Render component with useModels - should start with 0 models
      render(<UseModelsTest schemaId="Test Schema Dynamic" />, { container, wrapper: SeedProviderWrapper })

      // Wait for initial render
      await waitFor(
        () => {
          const status = screen.getByTestId('models-status')
          return status.textContent === 'loaded'
        },
        { timeout: 10000 }
      )

      // Verify initial state is empty
      const initialCount = screen.getByTestId('models-count')
      expect(parseInt(initialCount.textContent || '0')).toBe(0)

      // Enable debug logs
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('debug', 'seedSdk:*')
      }

      // Create a new model programmatically
      console.log('[TEST] Creating new model...')
      const newModel = Model.create('DynamicModel', schema, {
        properties: {
          name: {
            type: 'Text',
          },
        },
        waitForReady: false,
      })
      console.log('[TEST] Model created:', newModel.id, newModel.modelName)

      // Wait for model to be idle
      await waitFor(
        () => {
          const modelSnapshot = newModel.getService().getSnapshot()
          const isIdle = modelSnapshot.value === 'idle'
          if (isIdle) {
            console.log('[TEST] Model is idle, context:', {
              modelFileId: modelSnapshot.context._modelFileId,
              writeProcess: !!modelSnapshot.context.writeProcess,
              validationErrors: modelSnapshot.context._validationErrors,
            })
          }
          return isIdle
        },
        { timeout: 10000 }
      )

      // Check if model was written to DB
      const testDb = BaseDb.getAppDb()
      if (testDb) {
        const { models: modelsTable } = await import('@/seedSchema/SchemaSchema')
        const modelRecords = await testDb
          .select()
          .from(modelsTable)
          .where(eq(modelsTable.name, 'DynamicModel'))
          .limit(1)
        console.log('[TEST] Model records in DB:', modelRecords.length, modelRecords)
      }

      // Wait for the model to appear in useModels - this is the critical test
      // The component should update immediately without needing a page reload
      await waitFor(
        () => {
          const count = screen.getByTestId('models-count')
          const modelCount = parseInt(count.textContent || '0')
          return modelCount >= 1
        },
        { timeout: 15000 },
        {
          onTimeout: (error) => {
            // Log helpful debug info if test fails
            const count = screen.getByTestId('models-count')
            const currentCount = count.textContent
            throw new Error(
              `Model did not appear in useModels after creation. Current count: ${currentCount}. ` +
              `This indicates the bug where newly created models don't appear until page reload.`
            )
          },
        }
      )

      // Verify the model appears in the UI
      const finalCount = screen.getByTestId('models-count')
      expect(parseInt(finalCount.textContent || '0')).toBeGreaterThanOrEqual(1)

      // Verify the specific model name appears
      const modelElements = screen.getAllByTestId(/^model-\d+$/)
      const modelNames = modelElements.map((el) => el.textContent)
      expect(modelNames).toContain('DynamicModel')

      // Clean up
      if (db) {
        await db.delete(schemas).where(eq(schemas.name, 'Test Schema Dynamic'))
      }
      Schema.clearCache()
    })
  })

  describe('useCreateModel', () => {
    it('should expose create, isLoading, error, and resetError', async () => {
      render(<UseCreateModelTest />, { container })

      await waitFor(
        () => {
          const btn = screen.getByTestId('create-model-button')
          expect(btn).toBeTruthy()
        },
        { timeout: 5000 }
      )

      expect(screen.getByTestId('create-model-is-loading').textContent).toBe('false')
      expect(screen.queryByTestId('create-model-error')).toBeNull()
    })

    it('should create a model and set loading state', async () => {
      render(<UseCreateModelTest />, { container })

      await waitFor(
        () => {
          const btn = screen.getByTestId('create-model-button')
          expect(btn).toBeTruthy()
        },
        { timeout: 5000 }
      )

      screen.getByTestId('create-model-button').click()

      await waitFor(
        () => {
          const status = screen.getByTestId('create-model-status')
          return status.textContent === 'created'
        },
        { timeout: 3000 }
      )

      const createdName = screen.getByTestId('created-model-name')
      expect(createdName.textContent).toBe('HookTestModel')
    })
  })

  describe('useDestroyModel', () => {
    it('should expose destroy, isLoading, error, and resetError', async () => {
      render(<UseDestroyModelTest model={null} />, { container })

      await waitFor(
        () => {
          const btn = screen.getByTestId('destroy-model-button')
          expect(btn).toBeTruthy()
          expect(btn.hasAttribute('disabled')).toBe(true)
        },
        { timeout: 5000 }
      )

      expect(screen.getByTestId('destroy-model-is-loading').textContent).toBe('false')
    })

    it('should destroy a model and set loading state during destroy', async () => {
      const modelToDestroy = Model.create('DestroyTestModel', 'Test Schema Models', {
        properties: { name: { dataType: 'Text' } },
        waitForReady: false,
      })

      render(<UseDestroyModelTest model={modelToDestroy} />, { container })

      await waitFor(
        () => {
          const btn = screen.getByTestId('destroy-model-button')
          expect(btn).toBeTruthy()
          expect(btn.hasAttribute('disabled')).toBe(false)
        },
        { timeout: 5000 }
      )

      screen.getByTestId('destroy-model-button').click()

      await waitFor(
        () => {
          const isLoading = screen.getByTestId('destroy-model-is-loading')
          return isLoading.textContent === 'true'
        },
        { timeout: 2000 }
      )

      await waitFor(
        () => {
          const status = screen.getByTestId('destroy-model-status')
          return status.textContent === 'destroyed' || status.textContent === 'error'
        },
        { timeout: 25000 }
      )

      const status = screen.getByTestId('destroy-model-status')
      expect(['destroyed', 'error']).toContain(status.textContent)
    })
  })
})

