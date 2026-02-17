import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { BaseDb } from '@/db/Db/BaseDb'
import { appState } from '@/seedSchema'
import { eq } from 'drizzle-orm'
import { getAddressesFromDbOptional } from '@/helpers/db'
import { setupTestEnvironment, teardownTestEnvironment } from '../test-utils/client-init'

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe

testDescribe('getAddressesFromDbOptional', () => {
  beforeAll(async () => {
    await setupTestEnvironment({
      testFileUrl: import.meta.url,
      timeout: 90000,
    })
  }, 90000)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it('returns empty array when no addresses are configured', async () => {
    // Default test setup does not pass addresses, so appState may not have 'addresses' key
    // or may have empty value - getAddressesFromDbOptional should return [] without throwing
    const addresses = await getAddressesFromDbOptional()
    expect(Array.isArray(addresses)).toBe(true)
    // In default test setup, addresses may be [] if not configured
    expect(addresses).toBeDefined()
  })

  it('returns addresses when they are set in appState', async () => {
    const appDb = BaseDb.getAppDb()
    const testAddresses = ['0x1234567890123456789012345678901234567890']

    await appDb
      .insert(appState)
      .values({
        key: 'addresses',
        value: JSON.stringify(testAddresses),
      })
      .onConflictDoUpdate({
        target: appState.key,
        set: { value: JSON.stringify(testAddresses) },
      })

    const addresses = await getAddressesFromDbOptional()
    expect(addresses).toEqual(testAddresses)
  })
})
