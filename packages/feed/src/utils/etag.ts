import { createHash } from 'crypto';

/**
 * Generate an ETag from a string value
 * Uses MD5 hash for consistency and performance
 */
export function generateETag(value: string): string {
  const hash = createHash('md5').update(value).digest('hex');
  return `"${hash.substring(0, 16)}"`;
}

/**
 * Check if an ETag matches the provided value
 * Handles quoted, unquoted and weak (`W/"…"`) ETags. If-None-Match uses the weak comparison
 * (RFC 9110 §13.1.2), and proxies that compress a response mark its ETag weak.
 */
export function etagMatches(etag1: string, etag2: string): boolean {
  const normalize = (etag: string) => etag.replace(/^W\//, '').replace(/^"|"$/g, '');
  return normalize(etag1) === normalize(etag2);
}

/**
 * Parse If-None-Match header value
 * Returns array of ETags (can be comma-separated)
 */
export function parseIfNoneMatch(headerValue: string | null | undefined): string[] {
  if (!headerValue) {
    return [];
  }
  return headerValue
    .split(',')
    .map(etag => etag.trim())
    .filter(etag => etag.length > 0);
}

/**
 * Check if any of the provided ETags match the current ETag
 */
export function checkIfNoneMatch(
  ifNoneMatchHeader: string | null | undefined,
  currentETag: string
): boolean {
  const etags = parseIfNoneMatch(ifNoneMatchHeader);
  if (etags.length === 0) {
    return false;
  }
  
  // Check for wildcard
  if (etags.includes('*')) {
    return true;
  }
  
  // Check if any ETag matches
  return etags.some(etag => etagMatches(etag, currentETag));
}
