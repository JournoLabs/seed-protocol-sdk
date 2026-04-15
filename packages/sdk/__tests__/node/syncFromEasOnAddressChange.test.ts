import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import * as syncDbWithEas from '@/events/item/syncDbWithEas'
import {
  setupTestEnvironment,
  teardownTestEnvironment,
} from '../test-utils/client-init'

const ownedAddr = '0x1234567890123456789012345678901234567890'
const watchedAddr = '0x0987654321098765432109876543210987654321'

describe.sequential('syncFromEasOnAddressChange', () => {
  let runSyncSpy: ReturnType<typeof vi.spyOn<typeof syncDbWithEas, 'runSyncFromEas'>>

  beforeAll(async () => {
    await setupTestEnvironment({
      testFileUrl: import.meta.url,
      configOverrides: { syncFromEasOnAddressChange: true },
      timeout: 120000,
    })
  }, 120000)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  beforeEach(() => {
    runSyncSpy = vi
      .spyOn(syncDbWithEas, 'runSyncFromEas')
      .mockResolvedValue(undefined)
  })

  afterEach(() => {
    runSyncSpy.mockRestore()
  })

  it('calls runSyncFromEas after setAddresses when syncFromEasOnAddressChange is true', async () => {
    const { client } = await import('@/client')
    client.getService().send({
      type: 'updateContext',
      context: { syncFromEasOnAddressChange: true },
    })

    await client.setAddresses({ owned: [ownedAddr], watched: [watchedAddr] })

    await vi.waitFor(
      () => {
        expect(runSyncSpy).toHaveBeenCalled()
      },
      { timeout: 5000 },
    )
    expect(runSyncSpy).toHaveBeenCalledWith({
      addresses: [ownedAddr, watchedAddr],
    })
  })

  it('does not call runSyncFromEas after setAddresses when syncFromEasOnAddressChange is false', async () => {
    const { client } = await import('@/client')
    client.getService().send({
      type: 'updateContext',
      context: { syncFromEasOnAddressChange: false },
    })

    await client.setAddresses([ownedAddr])
    await new Promise((r) => setTimeout(r, 400))
    expect(runSyncSpy).not.toHaveBeenCalled()
  })
})
