import { describe, expect, it, vi } from 'vitest'
import { createCoalescedAsync } from '@/client/coalesceInit'

describe('createCoalescedAsync', () => {
  it('returns the in-flight promise for overlapping calls', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const run = vi.fn(async () => {
      await gate
    })
    const init = createCoalescedAsync(run, () => false)

    const first = init('a')
    const second = init('b')
    expect(first).toBe(second)
    expect(run).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledWith('a')

    release()
    await expect(first).resolves.toBeUndefined()
    await expect(second).resolves.toBeUndefined()
  })

  it('no-ops when already successfully ready', async () => {
    const run = vi.fn(async () => {})
    const init = createCoalescedAsync(run, () => true)

    await init({ config: {} })
    expect(run).not.toHaveBeenCalled()
  })

  it('allows a retry after failure', async () => {
    const run = vi
      .fn<(arg: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error('first failed'))
      .mockResolvedValueOnce(undefined)
    const init = createCoalescedAsync(run, () => false)

    await expect(init('one')).rejects.toThrow('first failed')
    await expect(init('two')).resolves.toBeUndefined()
    expect(run).toHaveBeenCalledTimes(2)
    expect(run).toHaveBeenNthCalledWith(2, 'two')
  })
})
