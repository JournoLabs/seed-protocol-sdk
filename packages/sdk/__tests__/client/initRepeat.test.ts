import { describe, it, expect, beforeAll, vi } from 'vitest'
import { client } from '@/client'
import { INIT_CONFIG_CONFLICT_MESSAGE } from '@/client/ClientManager'
import { setupTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'

/**
 * client.init after the client is ready: the same config resolves and applies new addresses,
 * a different config throws, and onReady fires for late subscribers.
 */
describe('client.init called again', () => {
  let options: Parameters<typeof client.init>[0]

  beforeAll(async () => {
    // Capture the options the test setup initialises with.
    const initSpy = vi.spyOn(client, 'init')
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    options = initSpy.mock.calls[0][0]
    initSpy.mockRestore()
  }, SETUP_HOOK_TIMEOUT_MS)

  it('throws when the config differs', async () => {
    await expect(
      client.init({ ...options, config: { ...options.config, arweaveDomain: 'other.example.com' } }),
    ).rejects.toThrow(INIT_CONFIG_CONFLICT_MESSAGE)
    expect(client.isInitialized()).toBe(true)
  })

  it('resolves with the same config and applies changed addresses', async () => {
    const owned = '0x' + 'a'.repeat(40)
    await client.init({ ...options, config: structuredClone(options.config), addresses: { owned: [owned] } })
    expect(await client.getAddresses()).toEqual({ owned: [owned], watched: [] })

    await client.init({ ...options, addresses: [] })
    expect(await client.getAddresses()).toEqual({ owned: [], watched: [] })
  })

  it('onReady fires when registered after the client is ready, and can be cancelled', async () => {
    const callback = vi.fn()
    client.onReady(callback)
    await vi.waitFor(() => expect(callback).toHaveBeenCalledTimes(1))

    const cancelled = vi.fn()
    const cancel = client.onReady(cancelled)
    cancel()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(cancelled).not.toHaveBeenCalled()
  })
})
