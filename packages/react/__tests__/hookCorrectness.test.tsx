import { describe, it, expect, beforeAll } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import React from 'react'
import { SeedProvider, useModel, useModels, useIsDbReady, useDbsAreReady, useServices } from '@seedprotocol/react'
import { client, importJsonSchema, Model } from '@seedprotocol/sdk'
import type { SeedConstructorOptions, SchemaFileFormat } from '@seedprotocol/sdk'
import { SETUP_HOOK_TIMEOUT_MS } from './test-utils/client-init'
import { WAIT_TIMEOUT_MS } from '../../sdk/__tests__/test-utils/timeouts'

/** Hook fixes from the docs audit: hook order, readiness, progress, and lists that shrink. */

const wrapper = ({ children }: { children: React.ReactNode }) => <SeedProvider>{children}</SeedProvider>

function schemaFile(name: string, models: SchemaFileFormat['models']): SchemaFileFormat {
  const now = new Date().toISOString()
  return {
    $schema: 'https://seedprotocol.org/schemas/data-model/v1',
    version: 1,
    id: `${name.replace(/\W/g, '-')}-id`,
    metadata: { name, createdAt: now, updatedAt: now },
    models,
    enums: {},
    migrations: [],
  }
}

describe('React hook correctness', () => {
  beforeAll(async () => {
    if (!client.isInitialized()) {
      const config: SeedConstructorOptions = {
        config: { endpoints: { filePaths: '/api/seed/migrations', files: '/app-files' }, filesDir: '.seed' },
      }
      await client.init(config)
    }
    await waitFor(() => expect(client.isInitialized()).toBe(true), { timeout: SETUP_HOOK_TIMEOUT_MS })
  }, SETUP_HOOK_TIMEOUT_MS)

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
