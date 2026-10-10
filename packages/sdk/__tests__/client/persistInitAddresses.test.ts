import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { appState } from '@/seedSchema'
import { persistInitAddresses } from '@/client/actors/saveConfig'
import { setupTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'

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

  it('saves addresses passed to init', async () => {
    await persistInitAddresses(
      BaseDb.getAppDb()!,
      { ownedAddresses: ['0xDEF'], watchedAddresses: ['0x123'] },
      { keepStoredWhenEmpty: true },
    )
    expect(JSON.parse((await stored())!)).toEqual({ owned: ['0xdef'], watched: ['0x123'] })
  })
})
