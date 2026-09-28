import { describe, expect, it } from 'vitest'
import { checksumAddress } from '../src/utils.js'
import { keccak256Hex } from '../src/keccak.js'

describe('checksumAddress (EIP-55)', () => {
  it('matches the EIP-55 mixed-case example', () => {
    expect(checksumAddress('0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed')).toBe(
      '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
    )
  })

  it('is stable for already-checksummed input', () => {
    const checksummed = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'
    expect(checksumAddress(checksummed)).toBe(checksummed)
  })
})

describe('keccak256Hex', () => {
  it('hashes UTF-8 strings the same as byte arrays', () => {
    const fromString = keccak256Hex('abc')
    const fromBytes = keccak256Hex(new TextEncoder().encode('abc'))
    expect(fromString).toBe(fromBytes)
    expect(fromString).toMatch(/^[a-f0-9]{64}$/)
  })
})
