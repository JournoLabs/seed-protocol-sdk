import { describe, expect, it } from 'vitest'
import { normalizeAttesters, normalizeUidPrefix } from '../src/api'

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

describe('normalizeAttesters', () => {
  const OWNER = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'

  it('lowercases, adds 0x and drops duplicates', () => {
    expect(normalizeAttesters([OWNER, ` ${OWNER.slice(2).toUpperCase()} `])).toEqual([OWNER.toLowerCase()])
  })

  it('drops entries that are not 20-byte hex addresses', () => {
    expect(normalizeAttesters(['nope', OWNER, '0x1234', OWNER + 'aa'])).toEqual([OWNER.toLowerCase()])
  })

  it('is null when no entry is an address', () => {
    expect(normalizeAttesters([])).toBeNull()
    expect(normalizeAttesters(['', '0x', 'zz'.repeat(20)])).toBeNull()
  })
})
