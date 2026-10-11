import { describe, expect, it, vi } from 'vitest'
import { TabLockTimeoutError, seedDbLockName, withProcessLock, withTabLock } from '@/helpers/tabLocks'

describe('withTabLock', () => {
  const name = () => `seed:test:${Math.random().toString(36).slice(2)}`

  it('runs sections with the same name one at a time', async () => {
    const lock = name()
    const events: string[] = []
    const section = (id: string) =>
      withTabLock(lock, async () => {
        events.push(`${id}:start`)
        await new Promise((resolve) => setTimeout(resolve, 20))
        events.push(`${id}:end`)
        return id
      })

    await expect(Promise.all([section('a'), section('b')])).resolves.toEqual(['a', 'b'])
    expect(events).toEqual(['a:start', 'a:end', 'b:start', 'b:end'])
  })

  it('throws TabLockTimeoutError when the holder outlasts the wait', async () => {
    const lock = name()
    let release!: () => void
    const held = withTabLock(lock, () => new Promise<void>((resolve) => (release = resolve)))
    await new Promise((resolve) => setTimeout(resolve, 0))

    const error = await withTabLock(lock, async () => 'never', { timeoutMs: 30 }).catch((e) => e)
    expect(error).toBeInstanceOf(TabLockTimeoutError)
    expect(error.code).toBe('TAB_LOCK_TIMEOUT')

    release()
    await held
  })

  // AbortSignal.timeout is the Web Locks path; withProcessLock covers the fallback below.
  it.runIf(typeof navigator !== 'undefined' && !!navigator.locks)('still runs the section when the wait timeout fires after the lock was granted', async () => {
    // The wait timeout fires from inside the section, so it is certainly after the grant. (A real
    // 10ms timer raced the grant: in Chromium an uncontended grant is asynchronous, and a worker
    // stalled for over 10ms after the request timed out before it was granted.)
    const timeout = new AbortController()
    const spy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal)
    try {
      const p = withTabLock(
        name(),
        async () => {
          timeout.abort(new DOMException('The operation timed out.', 'TimeoutError'))
          await new Promise((resolve) => setTimeout(resolve, 20))
          return 'done'
        },
        { timeoutMs: 10 },
      )
      await expect(p).resolves.toBe('done')
      expect(spy).toHaveBeenCalledWith(10)
    } finally {
      spy.mockRestore()
    }
  })

  it('names locks per database', () => {
    expect(seedDbLockName('migrate', '/app-files')).toBe('seed:migrate:/app-files/db/seed.db')
  })
})

describe('withProcessLock', () => {
  const name = () => `seed:test:${Math.random().toString(36).slice(2)}`
  const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms))

  it('runs sections with the same name one at a time, in request order', async () => {
    const lock = name()
    const events: string[] = []
    const section = (id: string) =>
      withProcessLock(lock, async () => {
        events.push(`${id}:start`)
        await tick(10)
        events.push(`${id}:end`)
        return id
      })

    await expect(Promise.all([section('a'), section('b'), section('c')])).resolves.toEqual(['a', 'b', 'c'])
    expect(events).toEqual(['a:start', 'a:end', 'b:start', 'b:end', 'c:start', 'c:end'])
  })

  it('does not hold up sections with other names', async () => {
    let release!: () => void
    const held = withProcessLock(name(), () => new Promise<void>((resolve) => (release = resolve)))
    await expect(withProcessLock(name(), async () => 'other', { timeoutMs: 50 })).resolves.toBe('other')
    release()
    await held
  })

  it('releases the lock when the section throws', async () => {
    const lock = name()
    await expect(withProcessLock(lock, async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom')
    await expect(withProcessLock(lock, async () => 'next', { timeoutMs: 50 })).resolves.toBe('next')
  })

  it('times out the wait without letting later waiters in before the holder finishes', async () => {
    const lock = name()
    const events: string[] = []
    let release!: () => void
    const held = withProcessLock(lock, async () => {
      events.push('holder:start')
      await new Promise<void>((resolve) => (release = resolve))
      events.push('holder:end')
    })
    await tick()

    const error = await withProcessLock(lock, async () => 'never', { timeoutMs: 20 }).catch((e) => e)
    expect(error).toBeInstanceOf(TabLockTimeoutError)
    expect(error.code).toBe('TAB_LOCK_TIMEOUT')

    const later = withProcessLock(lock, async () => {
      events.push('later')
    })
    await tick(20)
    expect(events).toEqual(['holder:start'])

    release()
    await Promise.all([held, later])
    expect(events).toEqual(['holder:start', 'holder:end', 'later'])
  })

  it('bounds only the wait: a granted section outlives the timeout', async () => {
    await expect(
      withProcessLock(
        name(),
        async () => {
          await tick(30)
          return 'done'
        },
        { timeoutMs: 10 },
      ),
    ).resolves.toBe('done')
  })
})
