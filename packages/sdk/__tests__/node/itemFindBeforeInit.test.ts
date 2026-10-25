// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { Item } from '@/Item/Item'
import { CLIENT_NOT_INITIALIZED } from '@/helpers/constants'

/**
 * Item.find before client.init throws instead of returning undefined, which read as "no such item"
 * (late batch 11 triage K2.2).
 */
describe('Item.find before client init', () => {
  it('rejects with CLIENT_NOT_INITIALIZED once readyTimeout passes', async () => {
    await expect(Item.find({ seedLocalId: 'neverInitialised', readyTimeout: 200 })).rejects.toThrow(
      CLIENT_NOT_INITIALIZED,
    )
  })
})
