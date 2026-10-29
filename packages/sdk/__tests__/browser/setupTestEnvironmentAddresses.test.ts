import { afterAll, describe, expect, it, vi } from 'vitest'
import { client } from '@/client'
import { BaseDb } from '@/db/Db/BaseDb'
import { appState } from '@/seedSchema'
import { resetKeptStoredAddressesWarning } from '@/client/actors/saveConfig'
import { getOwnedAddressesFromDb } from '@/helpers/db'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'

/**
 * Browser test files share one OPFS database. Addresses an earlier file stored must not reach the
 * next file's client.init: its startup EAS sync would act on that wallet and download its files
 * from arweave.net, which the network guard then failed in an unrelated test (unloadRefCount).
 */
describe('setupTestEnvironment in the browser', () => {
  afterAll(async () => {
    vi.restoreAllMocks()
    await teardownTestEnvironment()
  })

  it('inits without the addresses an earlier file stored', async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    const earlierFileAddress = '0x00000000000000000000000000000000000000a1'
    const value = JSON.stringify({ owned: [earlierFileAddress], watched: [] })
    await BaseDb.getAppDb()!
      .insert(appState)
      .values({ key: 'addresses', value })
      .onConflictDoUpdate({ target: appState.key, set: { value } })
    await client.stop()

    resetKeptStoredAddressesWarning()
    const warn = vi.spyOn(console, 'warn')
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })

    const keptWarnings = warn.mock.calls.filter((args) => String(args[0]).includes('stored addresses are kept'))
    expect(keptWarnings).toEqual([])
    expect(await getOwnedAddressesFromDb()).toEqual([])
  }, 60_000)
})
