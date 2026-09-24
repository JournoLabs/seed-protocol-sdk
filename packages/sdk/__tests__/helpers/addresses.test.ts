import { describe, expect, it } from 'vitest'
import {
  normalizeAddressConfig,
  normalizeAddressList,
  normalizeHexAddress,
  normalizePublisher,
} from '@/helpers/addresses'

describe('address normalize', () => {
  it('lowercases and trims hex addresses', () => {
    expect(normalizeHexAddress('  0xAbC  ')).toBe('0xabc')
  })

  it('dedupes mixed-case addresses and drops empties', () => {
    expect(
      normalizeAddressList(['0xABC', '', '0xabc', '0xDEF', '0xdef']),
    ).toEqual(['0xabc', '0xdef'])
  })

  it('normalizePublisher omits empty and lowercases', () => {
    expect(normalizePublisher(null)).toBeUndefined()
    expect(normalizePublisher('')).toBeUndefined()
    expect(normalizePublisher('0xPubLisher')).toBe('0xpublisher')
  })

  it('normalizeAddressConfig lowercases owned and watched', () => {
    expect(
      normalizeAddressConfig({
        owned: ['0xAAA', '0xaaa'],
        watched: ['0xBBB'],
      }),
    ).toEqual({ owned: ['0xaaa'], watched: ['0xbbb'] })
    expect(normalizeAddressConfig(['0xCcC'])).toEqual({
      owned: ['0xccc'],
      watched: [],
    })
  })
})
