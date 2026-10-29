import { afterEach, describe, expect, jest, test } from 'bun:test'
import { persistSeedUidSafely } from './persistSeedUid'

describe('persistSeedUidSafely', () => {
  afterEach(() => {
    jest.useRealTimers()
  })

  test('leaves no timer pending once the write succeeds', async () => {
    jest.useFakeTimers()
    const persistSeedUid = jest.fn(async () => {})

    await persistSeedUidSafely({ persistSeedUid }, '0xabc', 1)

    expect(persistSeedUid).toHaveBeenCalledTimes(1)
    expect(jest.getTimerCount()).toBe(0)
  })

  test('leaves no timer pending once the write fails', async () => {
    jest.useFakeTimers()
    const persistSeedUid = jest.fn(async () => {
      throw new Error('db busy')
    })

    await persistSeedUidSafely({ persistSeedUid }, '0xabc')

    expect(jest.getTimerCount()).toBe(0)
  })

  test('gives up on a write that never finishes after 15 s', async () => {
    jest.useFakeTimers()
    const persistSeedUid = jest.fn(() => new Promise<void>(() => {}))

    const done = persistSeedUidSafely({ persistSeedUid }, '0xabc')
    jest.advanceTimersByTime(15_000)
    await done

    expect(jest.getTimerCount()).toBe(0)
  })
})
