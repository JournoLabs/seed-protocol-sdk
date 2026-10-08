import { describe, expect, it } from 'vitest'
import { TabLockTimeoutError, seedDbLockName, withTabLock } from '@/helpers/tabLocks'

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

  it('still runs the section when the wait timeout fires after the lock was granted', async () => {
    await expect(
      withTabLock(name(), () => new Promise((resolve) => setTimeout(() => resolve('done'), 50)), { timeoutMs: 10 }),
    ).resolves.toBe('done')
  })

  it('names locks per database', () => {
    expect(seedDbLockName('migrate', '/app-files')).toBe('seed:migrate:/app-files/db/seed.db')
  })
})
