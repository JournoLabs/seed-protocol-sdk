import { describe, expect, it } from 'vitest'
import { monthBoundsUnix } from '../src/source/remote'

describe('monthBoundsUnix', () => {
  it('bounds a UTC calendar month, end exclusive', () => {
    expect(monthBoundsUnix(2026, 2)).toEqual({
      startTs: Date.parse('2026-02-01T00:00:00Z') / 1000,
      endTs: Date.parse('2026-03-01T00:00:00Z') / 1000,
    })
  })

  it('rolls December into the next year', () => {
    expect(monthBoundsUnix(2026, 12).endTs).toBe(Date.parse('2027-01-01T00:00:00Z') / 1000)
  })
})
