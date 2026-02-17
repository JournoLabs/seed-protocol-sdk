import type { GraphQLItem, ImageMetadata } from '../types';

/**
 * Cached feed data for a specific schema
 */
export interface CachedFeedData {
  items: GraphQLItem[];           // Processed items
  lastProcessedTimestamp: number;  // Unix timestamp of newest item
  lastProcessedItemId: string;    // ID of newest item (for deduplication)
  lastUpdated: number;            // When cache was last updated (Unix timestamp)
  etag: string;                   // ETag for HTTP conditional requests
}

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
 * Cache configuration options
 */
export interface CacheConfig {
  ttl: number;                    // Time to live in seconds
  cacheDir: string;               // Directory for persistent cache
  enabled: boolean;               // Enable/disable caching
  backgroundRefresh: boolean;     // Enable background refresh job
  refreshInterval: number;        // Background refresh interval in seconds
  imageMetadata?: ImageMetadataConfig // Image metadata cache configuration
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
