import { sha256 } from '@noble/hashes/sha2'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils'
import { describe, expect, it } from 'vitest'
import { canonicalJson, InvalidLicenseTermsError, termsHash, type SeedLicenseTerms } from '../src'
import { invalidTerms, validTerms } from './fixtures/terms'

describe('termsHash', () => {
  it('is sha256 over the canonical JSON', () => {
    const expected = '0x' + bytesToHex(sha256(utf8ToBytes(canonicalJson(validTerms.ccBy))))
    expect(termsHash(validTerms.ccBy)).toBe(expected)
    expect(termsHash(validTerms.ccBy)).toMatch(/^0x[0-9a-f]{64}$/)
  })

  it('ignores key order', () => {
    const reordered = Object.fromEntries(Object.entries(validTerms.ccBy).reverse()) as unknown as SeedLicenseTerms
    expect(termsHash(reordered)).toBe(termsHash(validTerms.ccBy))
  })

  it('treats an undefined optional field as absent', () =>
    expect(termsHash(validTerms.undefinedOptional!)).toBe(termsHash(validTerms.ccBy!)))

  it('changes when a term changes', () =>
    expect(termsHash({ ...validTerms.ccBy!, spdx: 'CC-BY-SA-4.0' })).not.toBe(termsHash(validTerms.ccBy!)))

  it('throws on invalid terms, carrying the errors', () => {
    expect(() => termsHash(invalidTerms.unknownAction as SeedLicenseTerms)).toThrow(InvalidLicenseTermsError)
    try {
      termsHash(invalidTerms.unknownAction as SeedLicenseTerms)
    } catch (error) {
      expect((error as InvalidLicenseTermsError).errors[0]!.path).toBe('permissions[0].action')
    }
  })
})
