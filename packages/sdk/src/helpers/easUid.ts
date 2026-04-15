import { ZERO_BYTES32 } from '@/helpers/constants'

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

/** Normalize bytes32 hex strings for case-insensitive comparison (schema UIDs, etc.). */
export function normalizeBytes32Hex(value: string | null | undefined): string {
  if (value == null || value === '') return ''
  const raw = String(value).trim()
  const body = raw.startsWith('0x') || raw.startsWith('0X') ? raw.slice(2) : raw
  const hex = body.replace(/[^0-9a-fA-F]/g, '0').padStart(64, '0').slice(-64)
  return ('0x' + hex).toLowerCase()
}

