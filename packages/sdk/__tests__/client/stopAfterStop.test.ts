import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { client } from '@/client'
import { CLIENT_ALREADY_STOPPED_WARNING } from '@/client/ClientManager'
import { ClientNotInitializedError } from '@/client/errors'
import { setupTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'

/**
 * After client.stop(), client methods throw ClientNotInitializedError, and another stop() or
 * unload() warns and does nothing. init() starts the client again.
 */
describe('client after stop()', () => {
  let options: Parameters<typeof client.init>[0]

  beforeAll(async () => {
    const initSpy = vi.spyOn(client, 'init')
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    options = initSpy.mock.calls[0][0]
    initSpy.mockRestore()
  }, SETUP_HOOK_TIMEOUT_MS)

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('methods throw after stop, a repeat stop warns, and init starts it again', async () => {
    expect(await client.getAddresses()).toBeDefined()
    client.stop()

    await expect(client.getAddresses()).rejects.toThrow(ClientNotInitializedError)
    await expect(client.setAddresses({ owned: [], watched: [] })).rejects.toThrow(ClientNotInitializedError)

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => client.stop()).not.toThrow()
    expect(() => client.unload()).not.toThrow()
    expect(warn.mock.calls.filter(([message]) => message === CLIENT_ALREADY_STOPPED_WARNING)).toHaveLength(2)
    warn.mockRestore()

    await client.init(options)
    expect(client.isInitialized()).toBe(true)
    expect(await client.getAddresses()).toBeDefined()
  }, 60000)

  it('a stop on a running client does not warn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    client.stop()
    expect(warn.mock.calls.filter(([message]) => message === CLIENT_ALREADY_STOPPED_WARNING)).toHaveLength(0)
    warn.mockRestore()
    await client.init(options)
  }, 60000)
})
