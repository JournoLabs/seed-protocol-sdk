import { describe, it, expect } from 'vitest'
import { ZERO_BYTES32 } from '../src/constants.js'
import {
  isPlaceholderUid,
  isValidEasAttestationUid,
  bytes32FromNumberHex,
  normalizeBytes32Hex,
} from '../src/easUid.js'

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
    expect(normalizeBytes32Hex('a'.repeat(64))).toBe(a)
  })

  it('normalizeBytes32Hex returns empty for a value that is not 32 bytes of hex', () => {
    expect(normalizeBytes32Hex('0xabc')).toBe('')
    expect(normalizeBytes32Hex('0x' + 'g'.repeat(64))).toBe('')
    expect(normalizeBytes32Hex('0x' + 'a'.repeat(66))).toBe('')
    expect(isValidEasAttestationUid(normalizeBytes32Hex('0xabc'))).toBe(false)
  })

  it("bytes32FromNumberHex pads a BigNumber's hex", () => {
    expect(bytes32FromNumberHex('0x0abc')).toBe('0x' + '0abc'.padStart(64, '0'))
    expect(bytes32FromNumberHex('0xzz')).toBe('')
    expect(bytes32FromNumberHex('0x' + 'a'.repeat(65))).toBe('')
  })
})
