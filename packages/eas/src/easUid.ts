import { ZERO_BYTES32 } from './constants.js'

/**
 * True when the value is not a real EAS attestation UID stored in SQLite
 * (missing, empty, legacy 'NULL' sentinel, or zero bytes32).
 */
export function isPlaceholderUid(value: string | null | undefined): boolean {
  if (value == null || value === '') return true
  if (value === 'NULL') return true
  const v = value.trim()
  if (v === '') return true
  if (v.toLowerCase() === ZERO_BYTES32.toLowerCase()) return true
  return false
}

/**
 * Strict EAS attestation UID: 0x-prefixed 32-byte hex (case-insensitive 0x / hex body).
 * Excludes placeholders and ZERO_BYTES32.
 */
export function isValidEasAttestationUid(value: string | null | undefined): boolean {
  if (isPlaceholderUid(value)) return false
  const v = String(value).trim()
  if (!/^0x/i.test(v)) return false
  const hex = v.slice(2)
  if (hex.length !== 64) return false
  return /^[0-9a-fA-F]{64}$/.test(hex)
}

/**
 * A bytes32 hex string (UIDs, hashes) in lowercase with a `0x` prefix, for comparing and encoding:
 * 64 hex digits, with or without `0x`. Anything else, including a short or non-hex value, is `''`,
 * which every UID check treats as missing.
 */
export function normalizeBytes32Hex(value: string | null | undefined): string {
  if (value == null || value === '') return ''
  const raw = String(value).trim()
  const body = raw.startsWith('0x') || raw.startsWith('0X') ? raw.slice(2) : raw
  if (!/^[0-9a-fA-F]{64}$/.test(body)) return ''
  return ('0x' + body).toLowerCase()
}

/**
 * A BigNumber's `hex` (no leading zeros, e.g. `0x0abc`) as bytes32; `''` when it isn't hex or is
 * longer than 32 bytes.
 */
export function bytes32FromNumberHex(hex: string): string {
  const raw = hex.trim()
  const body = raw.startsWith('0x') || raw.startsWith('0X') ? raw.slice(2) : raw
  if (!/^[0-9a-fA-F]{1,64}$/.test(body)) return ''
  return normalizeBytes32Hex(body.padStart(64, '0'))
}
