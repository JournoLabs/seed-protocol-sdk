import { describe, expect, it, vi } from 'vitest'
import { BrowserQueryClient } from '@/browser/helpers/QueryClient'
import { generateId } from '@/helpers'
import { WAIT_TIMEOUT_MS } from '../../test-utils/timeouts'

// The browser query client used to build a new TanStack client per call, so nothing was shared:
// concurrent identical requests each went out, and a caller's staleTime never applied to a later
// call (files metadata relies on that).
describe('BrowserQueryClient', () => {
  it('returns one client per factory', () => {
    const factory = new BrowserQueryClient()
    expect(factory.getQueryClient()).toBe(factory.getQueryClient())
  })

  it('shares one request between concurrent calls with the same key', async () => {
    const factory = new BrowserQueryClient()
    const key = ['sharedRequest', generateId()]
    let resolve!: (value: string) => void
    const queryFn = vi.fn(() => new Promise<string>((r) => { resolve = r }))

    const first = factory.getQueryClient().fetchQuery({ queryKey: key, queryFn })
    const second = factory.getQueryClient().fetchQuery({ queryKey: key, queryFn })
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalled(), { timeout: WAIT_TIMEOUT_MS })
    resolve('result')

    expect(await first).toBe('result')
    expect(await second).toBe('result')
    expect(queryFn).toHaveBeenCalledTimes(1)
  })

  it("reuses a result within the caller's staleTime, and refetches by default", async () => {
    const factory = new BrowserQueryClient()
    const key = ['staleTime', generateId()]
    const queryFn = vi.fn(async () => queryFn.mock.calls.length)

    expect(await factory.getQueryClient().fetchQuery({ queryKey: key, queryFn, staleTime: 60_000 })).toBe(1)
    expect(await factory.getQueryClient().fetchQuery({ queryKey: key, queryFn, staleTime: 60_000 })).toBe(1)
    expect(await factory.getQueryClient().fetchQuery({ queryKey: key, queryFn })).toBe(2)

    await factory.getQueryClient().removeQueries({ queryKey: key })
    expect(await factory.getQueryClient().fetchQuery({ queryKey: key, queryFn, staleTime: 60_000 })).toBe(3)
  })
})
