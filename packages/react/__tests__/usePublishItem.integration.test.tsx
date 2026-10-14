import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import React from 'react'
import { SeedProvider, usePublishItem } from '@seedprotocol/react'
import {
  client,
  setGetPublisherForNewSeeds,
  setPublishExecutor,
  PUBLISH_NOT_CONFIGURED_MESSAGE,
} from '@seedprotocol/sdk'
import type { SeedConstructorOptions, Item as ItemClass } from '@seedprotocol/sdk'
import {
  createGetPublishPayloadTestSchema,
  createItemWithBasicPropertiesOnly,
  UNPUBLISH_TEST_PUBLISHER,
} from '../../sdk/__tests__/test-utils/getPublishPayloadIntegrationHelpers'
import { SETUP_HOOK_TIMEOUT_MS } from './test-utils/client-init'
import { WAIT_TIMEOUT_MS } from '../../sdk/__tests__/test-utils/timeouts'

const wrapper = ({ children }: { children: React.ReactNode }) => <SeedProvider>{children}</SeedProvider>

async function createOwnedDraft(title: string): Promise<ItemClass<any>> {
  // Owned drafts need a publisher stamped at creation, as the publish package does.
  setGetPublisherForNewSeeds(async () => UNPUBLISH_TEST_PUBLISHER)
  try {
    const { item } = await createItemWithBasicPropertiesOnly({ title })
    return item as ItemClass<any>
  } finally {
    setGetPublisherForNewSeeds(null)
  }
}

describe('usePublishItem', () => {
  beforeAll(async () => {
    if (!client.isInitialized()) {
      const config: SeedConstructorOptions = {
        config: {
          endpoints: { filePaths: '/api/seed/migrations', files: '/app-files' },
          filesDir: '.seed',
        },
        addresses: [UNPUBLISH_TEST_PUBLISHER],
      }
      await client.init(config)
    } else {
      await client.setAddresses([UNPUBLISH_TEST_PUBLISHER])
    }
    await waitFor(() => expect(client.isInitialized()).toBe(true), { timeout: SETUP_HOOK_TIMEOUT_MS })
    await createGetPublishPayloadTestSchema()
  }, SETUP_HOOK_TIMEOUT_MS)

  afterEach(() => {
    setPublishExecutor(null)
  })

  afterAll(() => {
    setPublishExecutor(null)
  })

  it('reports that @seedprotocol/publish is needed when nothing is registered', async () => {
    const item = await createOwnedDraft('usePublishItem not configured')
    const { result } = renderHook(() => usePublishItem(), { wrapper })

    act(() => result.current.publishItem(item))

    await waitFor(() => expect(result.current.error?.message).toBe(PUBLISH_NOT_CONFIGURED_MESSAGE), {
      timeout: WAIT_TIMEOUT_MS,
    })
    expect(result.current.isLoading).toBe(false)
  })

  it('reports the executor error', async () => {
    const item = await createOwnedDraft('usePublishItem fails')
    setPublishExecutor(async () => {
      throw new Error('attestation reverted')
    })
    const { result } = renderHook(() => usePublishItem(), { wrapper })

    act(() => result.current.publishItem(item))

    await waitFor(() => expect(result.current.error?.message).toBe('attestation reverted'), {
      timeout: WAIT_TIMEOUT_MS,
    })
    expect(result.current.isLoading).toBe(false)
  })

  it('is loading while the executor runs and passes options through', async () => {
    const item = await createOwnedDraft('usePublishItem succeeds')
    let finish!: () => void
    const seen: unknown[] = []
    setPublishExecutor((_item, options) => {
      seen.push(options)
      return new Promise<void>((resolve) => {
        finish = resolve
      })
    })
    const { result } = renderHook(() => usePublishItem(), { wrapper })

    act(() => result.current.publishItem(item, { publishMode: 'new_version' }))

    await waitFor(() => expect(result.current.isLoading).toBe(true), { timeout: WAIT_TIMEOUT_MS })
    expect(seen).toEqual([{ publishMode: 'new_version' }])
    act(() => finish())
    await waitFor(() => expect(result.current.isLoading).toBe(false), { timeout: WAIT_TIMEOUT_MS })
    expect(result.current.error).toBeNull()
  })
})
