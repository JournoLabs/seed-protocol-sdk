import type { GraphQLItem, ImageMetadata } from '../types';

/**
 * Cached image metadata for an Arweave transaction ID
 */
export interface CachedImageMetadata {
  metadata: ImageMetadata
  cachedAt: number // Unix timestamp when cached
  expiresAt: number // Unix timestamp when cache expires
}

/**
 * Cached feed content for a specific schema and format
 */
export interface CachedFeedContent {
  content: string;                // Generated XML/JSON feed
  contentType: string;            // MIME type
  etag: string;                   // ETag for this format
  lastModified: number;           // Last modification time (Unix timestamp)
  expiresAt: number;              // Cache expiration timestamp (Unix timestamp)
}

/**
 * Image metadata cache configuration
 */
export interface ImageMetadataConfig {
  enabled: boolean
  ttl: number // Time to live in seconds (default: 7 days)
  gateways: string[] // Arweave gateway domains
  timeout: number // Request timeout in milliseconds
}

/**
 * Cache configuration options (serialized content + image metadata).
 * Collection/item caching lives in @seedprotocol/query.
 */
export interface CacheConfig {
  ttl: number;                    // Time to live in seconds
  cacheDir: string;               // Directory for persistent cache
  enabled: boolean;               // Enable/disable caching
  backgroundRefresh: boolean;     // Enable background refresh job (unused)
  refreshInterval: number;        // Background refresh interval in seconds
  imageMetadata?: ImageMetadataConfig
  pageTtl?: number;                // TTL for page > 1 (default: 300)
  archiveTtl?: number;            // TTL for archives (default: 86400)
}

/**
 * Options for cache content key (pagination or archive)
 */
export interface CacheContentKeyOptions {
  page?: number;
  archive?: { year: number; month: number };
}

export function buildContentKey(
  schemaName: string,
  format: string,
  options?: CacheContentKeyOptions
): string {
  if (options?.archive) {
    return `${schemaName}:${format}:archive-${options.archive.year}-${options.archive.month}`;
  }
  if (options?.page != null && options.page > 1) {
    return `${schemaName}:${format}:page-${options.page}`;
  }
  return `${schemaName}:${format}`;
}

/**
 * Cache statistics for monitoring
 */
export interface CacheStats {
  hits: number;
  misses: number;
  refreshes: number;
  errors: number;
}

// Re-export for callers that imported GraphQLItem from cache types historically
export type { GraphQLItem };
