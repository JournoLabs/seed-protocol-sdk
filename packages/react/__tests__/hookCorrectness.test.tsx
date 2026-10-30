import { describe, it, expect, beforeAll } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import React from 'react'
import {
  SeedProvider,
  useCreateItem,
  useDbsAreReady,
  useEasSyncProcessById,
  useIsDbReady,
  useLiveQueryState,
  useModel,
  useModels,
  useSchema,
  useSchemas,
  useServices,
  formatSeedJson,
} from '@seedprotocol/react'
import { BaseDb, client, importJsonSchema, Model, Schema, schemas } from '@seedprotocol/sdk'
import { eq } from 'drizzle-orm'
import type { SeedConstructorOptions, SchemaFileFormat } from '@seedprotocol/sdk'
import { SETUP_HOOK_TIMEOUT_MS } from './test-utils/client-init'
import { WAIT_TIMEOUT_MS } from '../../sdk/__tests__/test-utils/timeouts'

/** Hook fixes from the docs audit: hook order, readiness, progress, and lists that shrink. */

const wrapper = ({ children }: { children: React.ReactNode }) => <SeedProvider>{children}</SeedProvider>

function schemaFile(name: string, models: SchemaFileFormat['models']): SchemaFileFormat {
  const now = new Date().toISOString()
  return {
    $schema: 'https://seedprotocol.io/schemas/data-model/v1',
    version: 1,
    id: `${name.replace(/\W/g, '-')}-id`,
    metadata: { name, createdAt: now, updatedAt: now },
    models,
    enums: {},
    migrations: [],
  }
}

beforeAll(async () => {
  if (!client.isInitialized()) {
    const config: SeedConstructorOptions = {
      config: { endpoints: { filePaths: '/api/seed/migrations', files: '/app-files' }, filesDir: '.seed' },
    }
    await client.init(config)
  }
  await waitFor(() => expect(client.isInitialized()).toBe(true), { timeout: SETUP_HOOK_TIMEOUT_MS })
}, SETUP_HOOK_TIMEOUT_MS)

describe('React hook correctness', () => {

  it('useModel keeps the same hook order when modelName switches between null and a name', async () => {
    const name = 'Hook Order Schema'
    const file = schemaFile(name, {
      HookPost: { id: 'hook-post-model-id', properties: { title: { id: 'hook-post-title-id', type: 'Text' } } },
    })
    await importJsonSchema({ contents: JSON.stringify(file) }, file.version)

    const { result, rerender } = renderHook(
      ({ modelName }: { modelName: string | null }) => useModel(name, modelName),
      { wrapper, initialProps: { modelName: null as string | null } },
    )
    rerender({ modelName: 'HookPost' })
    await waitFor(() => expect(result.current.model?.modelName).toBe('HookPost'), { timeout: WAIT_TIMEOUT_MS })
    rerender({ modelName: null })
    expect(result.current.model).toBeUndefined()
  })

  it('reports the database as ready once the client is ready', () => {
    const { result } = renderHook(() => ({ isDbReady: useIsDbReady(), dbs: useDbsAreReady() }), { wrapper })
    expect(result.current.isDbReady).toBe(true)
    expect(result.current.dbs.dbsAreReady).toBe(true)
  })

  it('useServices starts at 100% when the client is already idle', () => {
    const { result } = renderHook(() => useServices(), { wrapper })
    expect(result.current.percentComplete).toBe(100)
  })

  it('useModels drops models that are destroyed', async () => {
    const name = 'Models Shrink Schema'
    const file = schemaFile(name, {
      KeepMe: { id: 'shrink-keep-model-id', properties: { a: { id: 'shrink-keep-a-id', type: 'Text' } } },
      DropMe: { id: 'shrink-drop-model-id', properties: { b: { id: 'shrink-drop-b-id', type: 'Text' } } },
    })
    await importJsonSchema({ contents: JSON.stringify(file) }, file.version)

    const { result } = renderHook(() => useModels(name), { wrapper })
    await waitFor(() => expect(result.current.models.map((m) => m.modelName).sort()).toEqual(['DropMe', 'KeepMe']), {
      timeout: WAIT_TIMEOUT_MS,
    })

    const dropMe = await Model.getByNameAsync('DropMe', name)
    await dropMe!.destroy()

    await waitFor(() => expect(result.current.models.map((m) => m.modelName)).toEqual(['KeepMe']), {
      timeout: WAIT_TIMEOUT_MS,
    })
  })
})

describe('schema hooks', () => {
  it('useSchema with an unknown name returns null without creating a draft', async () => {
    const name = 'No Such Schema For useSchema'
    const { result } = renderHook(() => useSchema(name), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false), { timeout: WAIT_TIMEOUT_MS })
    expect(result.current.schema).toBeNull()
    expect(result.current.error).toBeNull()
    const rows = await BaseDb.getAppDb()!.select().from(schemas).where(eq(schemas.name, name))
    expect(rows).toEqual([])
  })

  it('useSchemas drops a destroyed schema', async () => {
    const name = 'Schemas Shrink Schema'
    const file = schemaFile(name, {})
    await importJsonSchema({ contents: JSON.stringify(file) }, file.version)
    const { result } = renderHook(() => useSchemas(), { wrapper })
    await waitFor(() => expect(result.current.schemas.some((s) => s.metadata?.name === name)).toBe(true), {
      timeout: WAIT_TIMEOUT_MS,
    })

    const schema = (await Schema.create(name)) as Schema
    await schema.destroy()

    await waitFor(() => expect(result.current.schemas.some((s) => s.metadata?.name === name)).toBe(false), {
      timeout: WAIT_TIMEOUT_MS,
    })
  })
})

describe('item and query hooks', () => {
  it('useLiveQuery with an inline (unmemoised) builder settles instead of resubscribing forever', async () => {
    let renders = 0
    const { result } = renderHook(
      () => {
        renders += 1
        const db = BaseDb.getAppDb()
        return useLiveQueryState<{ id: number }>(db ? db.select().from(schemas).orderBy(schemas.name) : null)
      },
      { wrapper },
    )
    await waitFor(() => expect(result.current.data).toBeDefined(), { timeout: WAIT_TIMEOUT_MS })
    const settled = renders
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(renders - settled).toBeLessThan(3)
    expect(result.current.error).toBeNull()
  })

  it('useEasSyncProcessById(undefined) is not loading', () => {
    const { result } = renderHook(() => useEasSyncProcessById(undefined), { wrapper })
    expect(result.current).toEqual({ record: null, isLoading: false })
  })

  it('useCreateItem runs one create for the same call made twice before a re-render (a double click)', async () => {
    const name = 'Create Guard Schema'
    const file = schemaFile(name, {
      GuardNote: { id: 'guard-note-model-id', properties: { title: { id: 'guard-note-title-id', type: 'Text' } } },
    })
    await importJsonSchema({ contents: JSON.stringify(file) }, file.version)
    const { result } = renderHook(() => useCreateItem(), { wrapper })

    const [first, second] = await Promise.all([
      result.current.createItem('GuardNote', { schemaName: name, title: 'one' }),
      result.current.createItem('GuardNote', { schemaName: name, title: 'one' }),
    ])
    expect(first).toBeDefined()
    // The second call gets the running create's promise: the same item, not undefined.
    expect(second).toBe(first)
  })

  it('useCreateItem treats a repeat whose values are arrays or objects built per call as the same create', async () => {
    const name = 'Create Guard Json Schema'
    const file = schemaFile(name, {
      GuardJsonNote: {
        id: 'guard-json-note-model-id',
        properties: { meta: { id: 'guard-json-note-meta-id', type: 'Json' } },
      },
    })
    await importJsonSchema({ contents: JSON.stringify(file) }, file.version)
    const { result } = renderHook(() => useCreateItem(), { wrapper })

    // A click handler builds new values on each click.
    const click = () =>
      result.current.createItem('GuardJsonNote', { schemaName: name, meta: { tags: ['a', 'b'], n: 1 } })
    const [first, second] = await Promise.all([click(), click()])
    expect(first).toBeDefined()
    expect(second).toBe(first)

    const [a, b] = await Promise.all([
      result.current.createItem('GuardJsonNote', { schemaName: name, meta: { tags: ['a'] } }),
      result.current.createItem('GuardJsonNote', { schemaName: name, meta: { tags: ['b'] } }),
    ])
    expect(b?.seedLocalId).not.toBe(a?.seedLocalId)
    await waitFor(() => expect(result.current.isLoading).toBe(false))
  })

  it('useCreateItem runs a different create while one runs, instead of handing back the first item', async () => {
    const name = 'Create Distinct Schema'
    const file = schemaFile(name, {
      DistinctNote: { id: 'distinct-note-model-id', properties: { title: { id: 'distinct-note-title-id', type: 'Text' } } },
    })
    await importJsonSchema({ contents: JSON.stringify(file) }, file.version)
    const { result } = renderHook(() => useCreateItem(), { wrapper })

    const [first, second] = await Promise.all([
      result.current.createItem('DistinctNote', { schemaName: name, title: 'one' }),
      result.current.createItem('DistinctNote', { schemaName: name, title: 'two' }),
    ])
    expect(first?.seedLocalId).toBeTruthy()
    expect(second?.seedLocalId).toBeTruthy()
    expect(second?.seedLocalId).not.toBe(first?.seedLocalId)
    expect((second as any).title).toBe('two')
    await waitFor(() => expect(result.current.isLoading).toBe(false))
  })

  it('useCreateItem passes ItemCreateOptions to Item.create', async () => {
    const name = 'Create Options Schema'
    const file = schemaFile(name, {
      OptionsNote: { id: 'options-note-model-id', properties: { title: { id: 'options-note-title-id', type: 'Text' } } },
    })
    await importJsonSchema({ contents: JSON.stringify(file) }, file.version)
    const { result } = renderHook(() => useCreateItem(), { wrapper })
    // An unknown key: Item.create rejects it unless validate is false.
    const data = { schemaName: name, title: 'imported', notAProperty: 'x' }

    expect(await result.current.createItem('OptionsNote', data)).toBeUndefined()
    await waitFor(() => expect(result.current.error).not.toBeNull())
    const item = await result.current.createItem('OptionsNote', data, { validate: false })
    expect(item?.seedLocalId).toBeTruthy()
  })
})

describe('formatSeedJson', () => {
  it('prints an object shared by two keys in full, and only real cycles as [Circular]', () => {
    const shared = { a: 1 }
    expect(JSON.parse(formatSeedJson({ x: shared, y: shared }))).toEqual({ x: { a: 1 }, y: { a: 1 } })

    const cyclic: Record<string, unknown> = { name: 'loop' }
    cyclic.self = cyclic
    expect(JSON.parse(formatSeedJson(cyclic))).toEqual({ name: 'loop', self: '[Circular]' })
  })
})
