import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils'
import type { GetSeedResult } from '../types.js'

/**
 * Generate an ETag from a string value (SHA-256, first 16 hex chars, quoted).
 */
export function generateETag(value: string): string {
  const hash = bytesToHex(sha256(utf8ToBytes(value)))
  return `"${hash.substring(0, 16)}"`
}

/**
 * Generate an ETag for a collection working set from its records' ETags (in order), so it
 * changes whenever a record's content does.
 */
export function generateCollectionETag(
  schemaName: string,
  optionsKey: string,
  itemETags: string[],
): string {
  return generateETag(`${schemaName}-${optionsKey}-${itemETags.join(',')}`)
}

/**
 * Generate an ETag for a single record from its content (a patch publish changes properties
 * without a new versionUid, so ids alone don't identify the content).
 */
export function generateItemETag(record: GetSeedResult, optionsKey: string): string {
  return generateETag(`${optionsKey}-${stableStringify(record)}`)
}

/**
 * JSON with object keys sorted: property order follows attestation order, which differs between
 * a seed assembled alone and in a batch, and must not change the ETag.
 */
function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v as Record<string, unknown>)
            .sort()
            .map((k) => [k, (v as Record<string, unknown>)[k]]),
        )
      : v,
  )
}
