import { normalizeBytes32Hex } from './easUid.js'


/**
 * `uid` as the EAS indexer stores it: a 32-byte hex uid in lower case, else the trimmed input in
 * lower case, so a read never misses a seed for its case.
 */
export function indexerUid(uid: string): string {
  return normalizeBytes32Hex(uid) || uid.trim().toLowerCase()
}
