import { describe, it, expect } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import React from 'react'
import {
  SeedProvider,
  useEasSyncProcessById,
  useEasSyncProcesses,
  useEasSyncProcessesState,
} from '@seedprotocol/react'
import { client } from '@seedprotocol/sdk'
import type { SeedConstructorOptions } from '@seedprotocol/sdk'
import { SETUP_HOOK_TIMEOUT_MS } from './test-utils/client-init'

/**
 * The EAS sync hooks mounted before client.init(): this file must not initialize the client before
 * its first test (each browser test file runs in its own iframe, so it starts uninitialized).
 */

const wrapper = ({ children }: { children: React.ReactNode }) => <SeedProvider>{children}</SeedProvider>

describe('EAS sync hooks before the client is ready', () => {
  it('render without throwing, then load once the client is ready', async () => {
    expect(client.isInitialized()).toBe(false)
    const { result } = renderHook(
      () => ({
        list: useEasSyncProcesses(),
        state: useEasSyncProcessesState(),
        byId: useEasSyncProcessById(1),
      }),
      { wrapper },
    )
    expect(result.current.list).toBeUndefined()
    expect(result.current.state).toEqual({ records: undefined, nonActiveCount: undefined })
    expect(result.current.byId).toEqual({ record: null, isLoading: true })

    const config: SeedConstructorOptions = {
      config: { endpoints: { filePaths: '/api/seed/migrations', files: '/app-files' }, filesDir: '.seed' },
    }
    await client.init(config)

    await waitFor(() => expect(Array.isArray(result.current.list)).toBe(true), { timeout: SETUP_HOOK_TIMEOUT_MS })
    await waitFor(() => expect(result.current.state.nonActiveCount).toBe(0))
    await waitFor(() => expect(result.current.byId).toEqual({ record: null, isLoading: false }))
  }, SETUP_HOOK_TIMEOUT_MS)
})
