import { describe, expect, it } from 'vitest'
import {
  connectionStrokeForIndex,
  FIELD_MAPPER_PAIR_SLOTS,
} from '../src/react/FieldMapper'

describe('connectionStrokeForIndex', () => {
  it('uses host connectionColors when provided', () => {
    expect(connectionStrokeForIndex(0, ['#aaa', '#bbb'])).toBe('#aaa')
    expect(connectionStrokeForIndex(1, ['#aaa', '#bbb'])).toBe('#bbb')
    expect(connectionStrokeForIndex(2, ['#aaa', '#bbb'])).toBe('#aaa')
  })

  it('defaults to CSS vars --fm-map-N with --map-N fallback', () => {
    expect(connectionStrokeForIndex(0)).toBe(
      'var(--fm-map-1, var(--map-1, currentColor))',
    )
    expect(connectionStrokeForIndex(7)).toBe(
      'var(--fm-map-8, var(--map-8, currentColor))',
    )
    expect(connectionStrokeForIndex(8)).toBe(
      'var(--fm-map-1, var(--map-1, currentColor))',
    )
  })

  it('exposes eight pair slots', () => {
    expect(FIELD_MAPPER_PAIR_SLOTS).toBe(8)
  })
})
