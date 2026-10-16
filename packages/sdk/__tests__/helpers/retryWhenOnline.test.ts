import { afterEach, describe, expect, it, vi } from 'vitest'
import { cancelAllRetriesWhenOnline, createRetryWhenOnline } from '@/helpers/retryWhenOnline'

afterEach(() => {
  cancelAllRetriesWhenOnline()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('retryWhenOnline', () => {
  it('backs off, keeps one retry pending, and starts over after a success', async () => {
    vi.useFakeTimers()
    const run = vi.fn()
    const retry = createRetryWhenOnline(run, { delaysMs: [100, 200], enabled: true })

    retry.schedule()
    retry.schedule()
    vi.advanceTimersByTime(99)
    expect(run).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(run).toHaveBeenCalledTimes(1)

    retry.schedule()
    vi.advanceTimersByTime(199)
    expect(run).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    expect(run).toHaveBeenCalledTimes(2)

    // The longest delay repeats.
    retry.schedule()
    vi.advanceTimersByTime(200)
    expect(run).toHaveBeenCalledTimes(3)

    retry.succeeded()
    retry.schedule()
    vi.advanceTimersByTime(100)
    expect(run).toHaveBeenCalledTimes(4)
  })

  it('waits for the online event while the browser is offline', () => {
    const target = new EventTarget()
    vi.stubGlobal('navigator', { onLine: false })
    vi.stubGlobal('addEventListener', target.addEventListener.bind(target))
    vi.stubGlobal('removeEventListener', target.removeEventListener.bind(target))
    const run = vi.fn()
    const retry = createRetryWhenOnline(run, { enabled: true })

    retry.schedule()
    expect(retry.pending).toBe(true)
    target.dispatchEvent(new Event('online'))
    expect(run).toHaveBeenCalledTimes(1)
    expect(retry.pending).toBe(false)
    target.dispatchEvent(new Event('online'))
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('cancelAllRetriesWhenOnline cancels pending retries, and test runs have retries off', () => {
    vi.useFakeTimers()
    const run = vi.fn()
    const retry = createRetryWhenOnline(run, { delaysMs: [100], enabled: true })
    retry.schedule()
    cancelAllRetriesWhenOnline()
    vi.advanceTimersByTime(1000)
    expect(run).not.toHaveBeenCalled()

    // NODE_ENV=test in Node; Vite's mode is 'test' in the browser.
    const offInTests = createRetryWhenOnline(run, { delaysMs: [100] })
    offInTests.schedule()
    expect(offInTests.pending).toBe(false)
  })
})
