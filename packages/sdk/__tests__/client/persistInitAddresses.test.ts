import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { appState } from '@/seedSchema'
import { persistInitAddresses, resetKeptStoredAddressesWarning } from '@/client/actors/saveConfig'
import { setupTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'
import { eventEmitter } from '@/eventBus'
import { ADDRESSES_PERSISTED_EVENT } from '@/client/events'

describe('persistInitAddresses', () => {
  let original: string | undefined

  const stored = async () => {
    const rows = await BaseDb.getAppDb()!.select().from(appState).where(eq(appState.key, 'addresses'))
    return rows[0]?.value
  }

  const store = async (value: string) => {
    await BaseDb.getAppDb()!
      .insert(appState)
      .values({ key: 'addresses', value })
      .onConflictDoUpdate({ target: appState.key, set: { value } })
  }

  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    original = await stored()
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    if (original === undefined) {
      await BaseDb.getAppDb()?.delete(appState).where(eq(appState.key, 'addresses'))
    } else {
      await store(original)
    }
  })

  const connected = JSON.stringify({ owned: ['0xabc'], watched: [] })
  const none = { addresses: [], ownedAddresses: [], watchedAddresses: [] }

  it("keeps another tab's addresses when a second tab inits with none", async () => {
    await store(connected)

    await persistInitAddresses(BaseDb.getAppDb()!, none, { keepStoredWhenEmpty: true })
    expect(await stored()).toBe(connected)

    await persistInitAddresses(BaseDb.getAppDb()!, { addresses: undefined }, { keepStoredWhenEmpty: true })
    expect(await stored()).toBe(connected)
  })

  it('clears stored addresses when the first tab inits with none', async () => {
    await store(connected)
    await persistInitAddresses(BaseDb.getAppDb()!, none, { keepStoredWhenEmpty: false })
    expect(JSON.parse((await stored())!)).toEqual({ owned: [], watched: [] })
  })

  it('saves addresses passed to init, and emits addresses.persisted as setAddresses does', async () => {
    const emit = vi.spyOn(eventEmitter, 'emit')
    await persistInitAddresses(
      BaseDb.getAppDb()!,
      { ownedAddresses: ['0xDEF'], watchedAddresses: ['0x123'] },
      { keepStoredWhenEmpty: true },
    )
    expect(JSON.parse((await stored())!)).toEqual({ owned: ['0xdef'], watched: ['0x123'] })
    expect(emit).toHaveBeenCalledWith(ADDRESSES_PERSISTED_EVENT, { owned: ['0xdef'], watched: ['0x123'] })
    emit.mockRestore()
  })

  it('keeps stored addresses in the leader tab when init has no addresses option, and warns once', async () => {
    await store(connected)
    resetKeptStoredAddressesWarning()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const omitted = { addresses: [], ownedAddresses: [], watchedAddresses: [], addressesProvided: false }
      await persistInitAddresses(BaseDb.getAppDb()!, omitted, { keepStoredWhenEmpty: false })
      await persistInitAddresses(BaseDb.getAppDb()!, omitted, { keepStoredWhenEmpty: false })
      expect(await stored()).toBe(connected)
      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn.mock.calls[0][0]).toContain('without `addresses`')
    } finally {
      warn.mockRestore()
    }
  })

  it('clears in the leader tab when addresses: [] is passed explicitly', async () => {
    await store(connected)
    await persistInitAddresses(BaseDb.getAppDb()!, { ...none, addressesProvided: true }, { keepStoredWhenEmpty: false })
    expect(JSON.parse((await stored())!)).toEqual({ owned: [], watched: [] })
  })
})
