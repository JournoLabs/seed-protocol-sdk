import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import React from 'react'
import {
  useCreateModel,
  useCreateModelProperty,
  useModel,
  useModelProperties,
  useModelProperty,
  useModels,
  useSchemas,
  SeedProvider,
  createSeedQueryClient,
} from '@seedprotocol/react'
import { client, importJsonSchema, Model, ModelProperty, Schema } from '@seedprotocol/sdk'
import type { SeedConstructorOptions } from '@seedprotocol/sdk'
import { cleanupTestSchemaData } from '../../sdk/__tests__/test-utils/cleanupTestDb'
import { WAIT_TIMEOUT_MS } from '../../sdk/__tests__/test-utils/timeouts'

/**
 * Definition hooks hold what they show once per mounted hook, and release it a tick after they
 * unmount. Definitions stay cached without holds, so the counts are what these tests check.
 */

const SCHEMA_NAME = 'Def Hook Holds'
const MODEL_ID = 'def-hook-holds-post-model'
const PROPERTY_ID = 'def-hook-holds-title-prop'

const refCount = (cache: { entryOf(instance: any): { refCount: number } | undefined }, instance: unknown) =>
  cache.entryOf(instance)?.refCount ?? 0
/** The deferred release (useHeldEntities) runs a tick after unmount. */
const afterRelease = () => new Promise((resolve) => setTimeout(resolve, 10))

describe('definition hook holds', () => {
  const queryClient = createSeedQueryClient()
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <SeedProvider queryClient={queryClient}>{children}</SeedProvider>
  )

  beforeAll(async () => {
    if (!client.isInitialized()) {
      const config: SeedConstructorOptions = {
        config: {
          endpoints: { filePaths: '/api/seed/migrations', files: '/app-files' },
          filesDir: '.seed',
        },
      }
      await client.init(config)
    }
    await waitFor(() => expect(client.isInitialized()).toBe(true), { timeout: 30000 })
    await cleanupTestSchemaData({ items: true })
    Schema.clearCache()
    await importJsonSchema({
      contents: JSON.stringify({
        $schema: 'https://seedprotocol.io/schemas/data-model/v1',
        version: 1,
        id: 'def-hook-holds-schema',
        metadata: { name: SCHEMA_NAME, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        models: {
          DhPost: { id: MODEL_ID, properties: { title: { id: PROPERTY_ID, type: 'Text' } } },
        },
        enums: {},
        migrations: [],
      }),
    })
  }, 60000)

  afterAll(async () => {
    await cleanupTestSchemaData({ items: true })
    Schema.clearCache()
  })

  const loadedModel = async () => (await Model.find({ modelFileId: MODEL_ID }))!
  const loadedProperty = async () => (await ModelProperty.find({ propertyFileId: PROPERTY_ID }))!

  it('useModels holds each listed model once, across a refetch, until it unmounts', async () => {
    const model = await loadedModel()
    const base = refCount(Model.cache, model)
    const { result, unmount } = renderHook(() => useModels(SCHEMA_NAME), { wrapper })
    await waitFor(() => expect(result.current.models).toContain(model), { timeout: WAIT_TIMEOUT_MS })
    await afterRelease()
    expect(refCount(Model.cache, model)).toBe(base + 1)

    await act(() => queryClient.invalidateQueries({ queryKey: ['seed', 'models', SCHEMA_NAME] }))
    await afterRelease()
    expect(result.current.models).toContain(model)
    expect(refCount(Model.cache, model)).toBe(base + 1)

    unmount()
    await afterRelease()
    expect(refCount(Model.cache, model)).toBe(base)
  })

  it('useModel by id holds the model it shows until it unmounts', async () => {
    const model = await loadedModel()
    const base = refCount(Model.cache, model)
    const { result, unmount } = renderHook(() => useModel(MODEL_ID), { wrapper })
    await waitFor(() => expect(result.current.model).toBe(model), { timeout: WAIT_TIMEOUT_MS })
    await afterRelease()
    expect(refCount(Model.cache, model)).toBe(base + 1)

    unmount()
    await afterRelease()
    expect(refCount(Model.cache, model)).toBe(base)
  })

  it('useSchemas holds each listed schema once until it unmounts', async () => {
    const schema = (await Schema.find({ schemaName: SCHEMA_NAME }))!
    const base = refCount(Schema.cache, schema)
    const { result, unmount } = renderHook(() => useSchemas(), { wrapper })
    await waitFor(() => expect(result.current.schemas).toContain(schema), { timeout: WAIT_TIMEOUT_MS })
    await afterRelease()
    expect(refCount(Schema.cache, schema)).toBe(base + 1)

    unmount()
    await afterRelease()
    expect(refCount(Schema.cache, schema)).toBe(base)
  })

  it('useModelProperties holds each listed property once until it unmounts', async () => {
    const property = await loadedProperty()
    const base = refCount(ModelProperty.cache, property)
    const { result, unmount } = renderHook(() => useModelProperties(MODEL_ID), { wrapper })
    await waitFor(() => expect(result.current.modelProperties).toContain(property), { timeout: WAIT_TIMEOUT_MS })
    await afterRelease()
    expect(refCount(ModelProperty.cache, property)).toBe(base + 1)

    unmount()
    await afterRelease()
    expect(refCount(ModelProperty.cache, property)).toBe(base)
  })

  it('useModelProperty releases what it shows when it unmounts', async () => {
    const property = await loadedProperty()
    const base = refCount(ModelProperty.cache, property)
    const { result, unmount } = renderHook(() => useModelProperty(SCHEMA_NAME, 'DhPost', 'title'), { wrapper })
    await waitFor(() => expect(result.current.modelProperty).toBe(property), { timeout: WAIT_TIMEOUT_MS })
    await afterRelease()
    expect(refCount(ModelProperty.cache, property)).toBe(base + 1)

    // A lookup took a hold that nothing released
    unmount()
    await afterRelease()
    expect(refCount(ModelProperty.cache, property)).toBe(base)
  })

  it('useCreateModel and useCreateModelProperty take no hold', async () => {
    const { result: createModel } = renderHook(() => useCreateModel(), { wrapper })
    let created: Model | undefined
    act(() => {
      created = createModel.current.create(SCHEMA_NAME, 'DhCreated')
    })
    expect(refCount(Model.cache, created)).toBe(0)

    const model = await loadedModel()
    const before = refCount(ModelProperty.cache, ModelProperty.getById(PROPERTY_ID))
    const { result: createProperty } = renderHook(() => useCreateModelProperty(), { wrapper })
    let property: ModelProperty | undefined
    await act(async () => {
      // An existing property: create returns it, as a lookup
      property = await createProperty.current.create(SCHEMA_NAME, 'DhPost', {
        name: 'title',
        dataType: 'Text',
        id: PROPERTY_ID,
        modelId: model.id,
      })
    })
    expect(property).toBe(ModelProperty.getById(PROPERTY_ID))
    expect(refCount(ModelProperty.cache, property)).toBe(before)
  })

  it('useModels lists a model again when the one it shows is evicted', async () => {
    const model = await loadedModel()
    const { result, unmount } = renderHook(() => useModels(SCHEMA_NAME), { wrapper })
    await waitFor(() => expect(result.current.models).toContain(model), { timeout: WAIT_TIMEOUT_MS })

    act(() => void Model.evictForSchema(SCHEMA_NAME))
    expect(model.getService().getSnapshot().status).toBe('stopped')
    await waitFor(
      () => {
        const listed = result.current.models.find((m) => m.id === MODEL_ID)
        expect(listed).toBeDefined()
        expect(listed).not.toBe(model)
        expect(listed!.getService().getSnapshot().status).toBe('active')
      },
      { timeout: WAIT_TIMEOUT_MS },
    )
    unmount()
  })
})
