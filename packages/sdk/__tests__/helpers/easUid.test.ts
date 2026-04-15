import { describe, it, expect } from 'vitest'
import { ZERO_BYTES32 } from '@/helpers/constants'
import {
  isPlaceholderUid,
  isValidEasAttestationUid,
  normalizeBytes32Hex,
} from '@/helpers/easUid'

describe('easUid', () => {
  it('isPlaceholderUid', () => {
    expect(isPlaceholderUid(undefined)).toBe(true)
    expect(isPlaceholderUid(null)).toBe(true)
    expect(isPlaceholderUid('')).toBe(true)
    expect(isPlaceholderUid('   ')).toBe(true)
    expect(isPlaceholderUid('NULL')).toBe(true)
    expect(isPlaceholderUid(ZERO_BYTES32)).toBe(true)
    expect(isPlaceholderUid(ZERO_BYTES32.toUpperCase())).toBe(true)
    expect(isPlaceholderUid('0xabc')).toBe(false)
    expect(isPlaceholderUid('0x' + 'b'.repeat(64))).toBe(false)
  })

  it('isValidEasAttestationUid', () => {
    const valid = '0x' + 'c'.repeat(64)
    expect(isValidEasAttestationUid(valid)).toBe(true)
    expect(isValidEasAttestationUid(valid.toUpperCase())).toBe(true)
    expect(isValidEasAttestationUid('NULL')).toBe(false)
    expect(isValidEasAttestationUid(ZERO_BYTES32)).toBe(false)
    expect(isValidEasAttestationUid('0xshort')).toBe(false)
    expect(isValidEasAttestationUid('nothex')).toBe(false)
  })

  it('normalizeBytes32Hex', () => {
    const a = '0x' + 'a'.repeat(64)
    const b = '0X' + 'A'.repeat(64)
    expect(normalizeBytes32Hex(a)).toBe(a)
    expect(normalizeBytes32Hex(b)).toBe(a)
    expect(normalizeBytes32Hex('')).toBe('')
  })
})
