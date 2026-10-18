import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import React from 'react'
import { useModels, SeedProvider } from '@seedprotocol/react'
import { client } from '@seedprotocol/sdk'
import type { SeedConstructorOptions } from '@seedprotocol/sdk'
import { getFallbackSeedQueryClient } from '../src/queryClient'
import { SETUP_HOOK_TIMEOUT_MS } from './test-utils/client-init'
import { WAIT_TIMEOUT_MS } from '../../sdk/__tests__/test-utils/timeouts'

// Runs in its own file: the fallback client and its warn-once flag are module state.
describe('Seed hooks outside SeedProvider', () => {
  beforeAll(async () => {
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
    await waitFor(() => expect(client.isInitialized()).toBe(true), { timeout: SETUP_HOOK_TIMEOUT_MS })
  }, SETUP_HOOK_TIMEOUT_MS)

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const missingProviderWarnings = (warn: ReturnType<typeof vi.spyOn>) =>
    warn.mock.calls.filter((args: unknown[]) => String(args[0]).includes('outside SeedProvider'))

  it('does not warn inside SeedProvider', async () => {
    const warn = vi.spyOn(console, 'warn')
    const wrapper = ({ children }: { children: React.ReactNode }) => <SeedProvider>{children}</SeedProvider>
    const { result, unmount } = renderHook(() => useModels('Fallback Test Schema'), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false), { timeout: WAIT_TIMEOUT_MS })
    unmount()
    expect(missingProviderWarnings(warn)).toHaveLength(0)
  })

  it('useModels uses the shared fallback client with Seed defaults and warns once', async () => {
    const warn = vi.spyOn(console, 'warn')
    const first = renderHook(() => useModels('Fallback Test Schema'))
    const second = renderHook(() => useModels('Fallback Test Schema'))

    // useModels used to build its own bare QueryClient here, so the shared fallback stayed unused.
    await waitFor(
      () => {
        const fallback = getFallbackSeedQueryClient()
        expect(fallback).toBeDefined()
        expect(
          fallback!.getQueryCache().find({ queryKey: ['seed', 'models', 'Fallback Test Schema'] }),
        ).toBeDefined()
      },
      { timeout: WAIT_TIMEOUT_MS },
    )
    expect(getFallbackSeedQueryClient()!.getDefaultOptions().queries?.networkMode).toBe('offlineFirst')
    expect(missingProviderWarnings(warn)).toHaveLength(1)

    first.unmount()
    second.unmount()
  })
})
