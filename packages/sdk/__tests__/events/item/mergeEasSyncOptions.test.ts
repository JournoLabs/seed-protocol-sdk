import { describe, expect, it } from 'vitest'
import { mergeEasSyncRequestIntents } from '@/events/item/mergeEasSyncOptions'

describe('mergeEasSyncRequestIntents', () => {
  it('returns full sync when any part omits a concrete address list', () => {
    expect(mergeEasSyncRequestIntents([{ addresses: ['0xAa'] }, {}])).toEqual({})
    expect(mergeEasSyncRequestIntents([{}, { addresses: ['0xBb'] }])).toEqual({})
    expect(
      mergeEasSyncRequestIntents([{ addresses: ['0xDd'] }, {}]),
    ).toEqual({})
  })

  it('unions addresses case-insensitively preserving first-seen casing', () => {
    expect(
      mergeEasSyncRequestIntents([
        { addresses: ['0xAa', '0xbb'] },
        { addresses: ['0xaa', '0xCc'] },
      ]),
    ).toEqual({ addresses: ['0xAa', '0xbb', '0xCc'] })
  })

  it('returns empty address list when all parts specify empty lists', () => {
    expect(mergeEasSyncRequestIntents([{ addresses: [] }, { addresses: [] }])).toEqual({
      addresses: [],
    })
  })

  it('treats no parts as full sync', () => {
    expect(mergeEasSyncRequestIntents([])).toEqual({})
  })
})
