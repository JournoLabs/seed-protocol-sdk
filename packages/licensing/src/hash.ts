import { sha256 } from '@noble/hashes/sha2'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils'
import { canonicalJson } from './canonicalJson'
import { InvalidLicenseTermsError } from './errors'
import type { SeedLicenseTerms } from './terms'
import { validateTerms } from './validate'

/**
 * The identity of a set of license terms: `0x` and the lowercase hex SHA-256 of their RFC 8785
 * canonical JSON. Throws {@link InvalidLicenseTermsError} on terms that fail `validateTerms`, so an
 * invalid object never gets a hash.
 */
export function termsHash(terms: SeedLicenseTerms): `0x${string}` {
  const result = validateTerms(terms)
  if (!result.ok) throw new InvalidLicenseTermsError(result.errors)
  return `0x${bytesToHex(sha256(utf8ToBytes(canonicalJson(terms))))}`
}
