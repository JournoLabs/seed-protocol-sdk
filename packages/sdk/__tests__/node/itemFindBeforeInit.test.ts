// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { Item } from '@/Item/Item'
import { ClientNotInitializedError } from '@/client/errors'

/**
 * Item.find before client.init throws instead of returning undefined, which read as "no such item"
 * (late batch 11 triage K2.2).
 */
describe('Item.find before client init', () => {
  it('rejects with ClientNotInitializedError once readyTimeout passes', async () => {
    const error = await Item.find({ seedLocalId: 'neverInitialised', readyTimeout: 200 }).catch((e) => e)
    expect(error).toBeInstanceOf(ClientNotInitializedError)
    expect(error.code).toBe('CLIENT_NOT_INITIALIZED')
  })
})
