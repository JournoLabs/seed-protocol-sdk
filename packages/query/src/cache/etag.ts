import { createHash } from 'crypto'

/**
 * Generate an ETag from a string value (MD5, first 16 hex chars, quoted).
 */
export function generateETag(value: string): string {
  const hash = createHash('md5').update(value).digest('hex')
  return `"${hash.substring(0, 16)}"`
}

/**
 * Generate an ETag for a collection working set.
 */
export function generateCollectionETag(
  schemaName: string,
  lastProcessedTimestamp: number,
  itemCount: number,
): string {
  return generateETag(
    `${schemaName}-data-${lastProcessedTimestamp}-${itemCount}`,
  )
}

/**
 * Generate an ETag for a single SeedRecord.
 */
export function generateItemETag(
  seedUid: string,
  versionUid: string,
  timeCreated: number,
  optionsKey: string,
): string {
  return generateETag(
    `${seedUid}-${versionUid}-${timeCreated}-${optionsKey}`,
  )
}
