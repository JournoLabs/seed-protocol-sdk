import { describe, expect, it } from 'vitest'
import { mapWithConcurrency } from '@/helpers/mapWithConcurrency'

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('mapWithConcurrency', () => {
  it('keeps input order and never exceeds the limit', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const delays = [30, 5, 20, 1, 15, 2, 10]
    const out = await mapWithConcurrency(delays, 3, async (ms, i) => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await tick(ms)
      inFlight--
      return `${i}:${ms}`
    })
    expect(out).toEqual(delays.map((ms, i) => `${i}:${ms}`))
    expect(maxInFlight).toBe(3)
  })

  it('rejects with the first error and starts nothing after it', async () => {
    const started: number[] = []
    await expect(
      mapWithConcurrency([0, 1, 2, 3, 4, 5], 2, async (i) => {
        started.push(i)
        await tick(i === 0 ? 20 : 5)
        if (i === 1) throw new Error('boom 1')
        return i
      }),
    ).rejects.toThrow('boom 1')
    await tick(30)
    // 0 and 1 run together; 1 fails while 0 is still running; when 0 finishes its worker sees the
    // failure, so 2 is never started.
    expect(started).toEqual([0, 1])
  })

  it('handles an empty list and a limit below 1', async () => {
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([])
    expect(await mapWithConcurrency([1, 2], 0, async (n) => n * 2)).toEqual([2, 4])
  })
})
