import { MemoryCache } from './MemoryCache';
import { FileCache } from './FileCache';
import type {
  CachedFeedContent,
  CacheConfig,
  CacheContentKeyOptions,
} from './types';
import type { ImageMetadata } from '../types';
import type { FeedFormat } from '../types';

/**
 * Feed cache manager: serialized content + image metadata only.
 * Collection/item caching is owned by @seedprotocol/query.
 */
export class CacheManager {
  private memoryCache: MemoryCache;
  private fileCache: FileCache;
  private config: CacheConfig;

  constructor(config: CacheConfig) {
    this.config = config;
    this.memoryCache = new MemoryCache(config);
    this.fileCache = new FileCache(config);
  }

  getConfig(): CacheConfig {
    return this.config;
  }

  /**
   * The cached body for this key, unexpired. With `fingerprint`, only an entry built from the same
   * inputs (see CachedFeedContent.fingerprint); without, any entry (e.g. a stale fallback).
   */
  async getFeedContent(
    schemaName: string,
    format: FeedFormat,
    contentKeyOptions?: CacheContentKeyOptions,
    fingerprint?: string,
  ): Promise<CachedFeedContent | null> {
    if (!this.config.enabled) {
      return null;
    }

    try {
      let cached = this.memoryCache.getFeedContent(schemaName, format, contentKeyOptions);
      if (!cached) {
        cached = await this.fileCache.getFeedContent(schemaName, format, contentKeyOptions);
        if (cached) this.memoryCache.putFeedContent(schemaName, format, cached, contentKeyOptions);
      }
      if (!cached) return null;
      if (fingerprint !== undefined && cached.fingerprint !== fingerprint) return null;
      return cached;
    } catch (error) {
      console.error(
        `Error getting feed content cache for ${schemaName}:${format}:`,
        error
      );
      return null;
    }
  }

  /** Stores a body with the ETag and fingerprint the caller computed; returns the stored entry. */
  async setFeedContent(
    schemaName: string,
    format: FeedFormat,
    body: { content: string; contentType: string; etag: string; fingerprint: string },
    contentKeyOptions?: CacheContentKeyOptions,
  ): Promise<CachedFeedContent | null> {
    if (!this.config.enabled) {
      return null;
    }

    try {
      let ttl = this.config.ttl;
      if (contentKeyOptions?.archive) {
        ttl = this.config.archiveTtl ?? 86400;
      } else if (contentKeyOptions?.page != null && contentKeyOptions.page > 1) {
        ttl = this.config.pageTtl ?? 300;
      }
      const now = Math.floor(Date.now() / 1000);
      const cached: CachedFeedContent = { ...body, lastModified: now, expiresAt: now + ttl };
      this.memoryCache.putFeedContent(schemaName, format, cached, contentKeyOptions);
      await this.fileCache.setFeedContent(schemaName, format, cached, contentKeyOptions);
      return cached;
    } catch (error) {
      console.error(
        `Error setting feed content cache for ${schemaName}:${format}:`,
        error
      );
      return null;
    }
  }

  async getImageMetadata(transactionId: string): Promise<ImageMetadata | null> {
    if (!this.config.imageMetadata?.enabled) {
      return null;
    }

    try {
      let cached = this.memoryCache.getImageMetadata(transactionId);
      if (cached) {
        return cached;
      }

      cached = await this.fileCache.getImageMetadata(transactionId);
      if (cached) {
        this.memoryCache.setImageMetadata(transactionId, cached);
        return cached;
      }

      return null;
    } catch (error) {
      console.error(`Error getting image metadata cache for ${transactionId}:`, error);
      return null;
    }
  }

  async setImageMetadata(transactionId: string, metadata: ImageMetadata): Promise<void> {
    if (!this.config.imageMetadata?.enabled) {
      return;
    }

    try {
      this.memoryCache.setImageMetadata(transactionId, metadata);
      await this.fileCache.setImageMetadata(transactionId, metadata);
    } catch (error) {
      console.error(`Error setting image metadata cache for ${transactionId}:`, error);
    }
  }

}
