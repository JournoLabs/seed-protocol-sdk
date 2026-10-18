import { describe, expect, it } from 'vitest'
import { normalizeUidPrefix } from '../src/api'

describe('normalizeUidPrefix', () => {
  it('lowercases and adds 0x', () => {
    expect(normalizeUidPrefix('0xFD8C50CA')).toBe('0xfd8c50ca')
    expect(normalizeUidPrefix('fd8c50ca')).toBe('0xfd8c50ca')
    expect(normalizeUidPrefix(' 0XfD8c ')).toBe('0xfd8c')
  })

  it('accepts 4 to 64 hex digits', () => {
    expect(normalizeUidPrefix('abcd')).toBe('0xabcd')
    expect(normalizeUidPrefix('a'.repeat(64))).toBe('0x' + 'a'.repeat(64))
    expect(normalizeUidPrefix('abc')).toBeNull()
    expect(normalizeUidPrefix('a'.repeat(65))).toBeNull()
  })

  it('rejects non-hex and wildcard characters', () => {
    expect(normalizeUidPrefix('0x')).toBeNull()
    expect(normalizeUidPrefix('fd8g50ca')).toBeNull()
    expect(normalizeUidPrefix('fd8c%')).toBeNull()
    expect(normalizeUidPrefix('fd8c_50')).toBeNull()
  })
})
