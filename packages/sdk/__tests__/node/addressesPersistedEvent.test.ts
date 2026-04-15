import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import { eventEmitter } from '@/eventBus'
import { ADDRESSES_PERSISTED_EVENT } from '@/client/events'
import {
  setupTestEnvironment,
  teardownTestEnvironment,
} from '../test-utils/client-init'

const ownedAddr = '0x1234567890123456789012345678901234567890'
const watchedAddr = '0x0987654321098765432109876543210987654321'

describe.sequential('ADDRESSES_PERSISTED_EVENT', () => {
  let emitSpy: ReturnType<typeof vi.spyOn>

  beforeAll(async () => {
    await setupTestEnvironment({
      testFileUrl: import.meta.url,
      timeout: 120000,
    })
  }, 120000)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  beforeEach(() => {
    emitSpy = vi.spyOn(eventEmitter, 'emit')
  })

  afterEach(() => {
    emitSpy.mockRestore()
  })

  it('emits addresses.persisted with owned and watched after setAddresses', async () => {
    const { client } = await import('@/client')
    await client.setAddresses({ owned: [ownedAddr], watched: [watchedAddr] })

    await vi.waitFor(
      () => {
        expect(emitSpy).toHaveBeenCalledWith(ADDRESSES_PERSISTED_EVENT, {
          owned: [ownedAddr],
          watched: [watchedAddr],
        })
      },
      { timeout: 5000 },
    )
  })

  it('emits addresses.persisted with empty arrays when clearing addresses', async () => {
    const { client } = await import('@/client')
    await client.setAddresses({ owned: [ownedAddr], watched: [] })
    await vi.waitFor(() => expect(emitSpy).toHaveBeenCalled(), { timeout: 5000 })
    emitSpy.mockClear()

    await client.setAddresses([])

    await vi.waitFor(
      () => {
        expect(emitSpy).toHaveBeenCalledWith(ADDRESSES_PERSISTED_EVENT, {
          owned: [],
          watched: [],
        })
      },
      { timeout: 5000 },
    )
  })
})
