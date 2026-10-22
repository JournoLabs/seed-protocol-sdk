import type { CachedFeedContent, CacheConfig, CacheContentKeyOptions, CachedImageMetadata } from './types';
import { buildContentKey } from './types';
import type { ImageMetadata } from '../types';

/**
 * In-memory cache for serialized feed content and image metadata.
 * Collection/item caching is owned by @seedprotocol/query.
 */
export class MemoryCache {
  private feedContentCache: Map<string, CachedFeedContent> = new Map();
  private imageMetadataCache: Map<string, CachedImageMetadata> = new Map();
  private config: CacheConfig;

  constructor(config: CacheConfig) {
    this.config = config;
  }

  getFeedContent(
    schemaName: string,
    format: string,
    contentKeyOptions?: CacheContentKeyOptions
  ): CachedFeedContent | null {
    const key = buildContentKey(schemaName, format, contentKeyOptions);
    const cached = this.feedContentCache.get(key);
    if (!cached) {
      return null;
    }

    const now = Math.floor(Date.now() / 1000);
    if (now > cached.expiresAt) {
      this.feedContentCache.delete(key);
      return null;
    }

    return cached;
  }

  /** Stores an entry as it is (ETag, lastModified and expiry kept), e.g. one read from disk. */
  putFeedContent(
    schemaName: string,
    format: string,
    cached: CachedFeedContent,
    contentKeyOptions?: CacheContentKeyOptions,
  ): void {
    this.feedContentCache.set(buildContentKey(schemaName, format, contentKeyOptions), cached);
  }

  getImageMetadata(transactionId: string): ImageMetadata | null {
    const cached = this.imageMetadataCache.get(transactionId);
    if (!cached) {
      return null;
    }

    const now = Math.floor(Date.now() / 1000);
    if (now > cached.expiresAt) {
      this.imageMetadataCache.delete(transactionId);
      return null;
    }

    return cached.metadata;
  }

  setImageMetadata(transactionId: string, metadata: ImageMetadata): void {
    const now = Math.floor(Date.now() / 1000);
    const imageMetadataTtl = this.config.imageMetadata?.ttl || 604800;
    const expiresAt = now + imageMetadataTtl;

    const cached: CachedImageMetadata = {
      metadata,
      cachedAt: now,
      expiresAt,
    };

    this.imageMetadataCache.set(transactionId, cached);
  }
}
