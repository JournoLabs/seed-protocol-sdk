import type { CachedFeedContent, CacheConfig, CacheContentKeyOptions, CachedImageMetadata } from './types';
import { buildContentKey } from './types';
import type { ImageMetadata } from '../types';
import { generateContentETag } from '../utils/etag';

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

  setFeedContent(
    schemaName: string,
    format: string,
    content: string,
    contentType: string,
    contentKeyOptions?: CacheContentKeyOptions,
    ttlOverride?: number
  ): void {
    const key = buildContentKey(schemaName, format, contentKeyOptions);
    const now = Math.floor(Date.now() / 1000);
    const ttl = ttlOverride ?? this.config.ttl;
    const expiresAt = now + ttl;

    const etag = generateContentETag(schemaName, format, now, content.length);

    const cachedContent: CachedFeedContent = {
      content,
      contentType,
      etag,
      lastModified: now,
      expiresAt,
    };

    this.feedContentCache.set(key, cachedContent);
  }

  clearContentCache(schemaName: string): void {
    const keysToDelete: string[] = [];
    for (const key of this.feedContentCache.keys()) {
      if (key.startsWith(`${schemaName}:`)) {
        keysToDelete.push(key);
      }
    }
    keysToDelete.forEach(key => this.feedContentCache.delete(key));
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

  clearAll(): void {
    this.feedContentCache.clear();
    this.imageMetadataCache.clear();
  }

  updateConfig(config: Partial<CacheConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getStats(): {
    feedContentCount: number;
    imageMetadataCount: number;
  } {
    return {
      feedContentCount: this.feedContentCache.size,
      imageMetadataCount: this.imageMetadataCache.size,
    };
  }
}
