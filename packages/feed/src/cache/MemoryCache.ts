import type { CachedFeedData, CachedFeedContent, CacheConfig, CachedImageMetadata } from './types';
import type { GraphQLItem, ImageMetadata } from '../types';
import { generateFeedETag, generateContentETag } from '../utils/etag';

/**
 * In-memory cache implementation with TTL support
 */
export class MemoryCache {
  private feedDataCache: Map<string, CachedFeedData> = new Map();
  private feedContentCache: Map<string, CachedFeedContent> = new Map();
  private imageMetadataCache: Map<string, CachedImageMetadata> = new Map();
  private config: CacheConfig;
  private refreshLocks: Map<string, Promise<void>> = new Map();

  constructor(config: CacheConfig) {
    this.config = config;
  }

  /**
   * Get cached feed data for a schema
   */
  getFeedData(schemaName: string): CachedFeedData | null {
    const cached = this.feedDataCache.get(schemaName);
    if (!cached) {
      return null;
    }

    // Check if cache is expired
    const now = Math.floor(Date.now() / 1000);
    const age = now - cached.lastUpdated;
    if (age > this.config.ttl) {
      this.feedDataCache.delete(schemaName);
      // Also clear related content cache
      this.clearContentCache(schemaName);
      return null;
    }

    return cached;
  }

  /**
   * Set cached feed data for a schema
   */
  setFeedData(schemaName: string, items: GraphQLItem[]): void {
    const now = Math.floor(Date.now() / 1000);
    
    // Find the newest item by timeCreated
    let lastProcessedTimestamp = 0;
    let lastProcessedItemId = '';
    
    for (const item of items) {
      const timeCreated = (item as any).timeCreated;
      if (timeCreated && timeCreated > lastProcessedTimestamp) {
        lastProcessedTimestamp = timeCreated;
        lastProcessedItemId = item.id || (item as any).seedUid || (item as any).SeedUid || '';
      }
    }

    // If no timeCreated found, use current time
    if (lastProcessedTimestamp === 0) {
      lastProcessedTimestamp = now;
    }

    const etag = generateFeedETag(schemaName, 'data', lastProcessedTimestamp, items.length);

    const cachedData: CachedFeedData = {
      items: [...items], // Create a copy
      lastProcessedTimestamp,
      lastProcessedItemId,
      lastUpdated: now,
      etag,
    };

    this.feedDataCache.set(schemaName, cachedData);
  }

  /**
   * Get cached feed content for a schema and format
   */
  getFeedContent(schemaName: string, format: string): CachedFeedContent | null {
    const key = `${schemaName}:${format}`;
    const cached = this.feedContentCache.get(key);
    if (!cached) {
      return null;
    }

    // Check if cache is expired
    const now = Math.floor(Date.now() / 1000);
    if (now > cached.expiresAt) {
      this.feedContentCache.delete(key);
      return null;
    }

    return cached;
  }

  /**
   * Set cached feed content for a schema and format
   */
  setFeedContent(
    schemaName: string,
    format: string,
    content: string,
    contentType: string
  ): void {
    const key = `${schemaName}:${format}`;
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + this.config.ttl;

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

  /**
   * Clear feed data cache for a schema
   */
  clearFeedData(schemaName: string): void {
    this.feedDataCache.delete(schemaName);
  }

  /**
   * Clear content cache for a schema (all formats)
   */
  clearContentCache(schemaName: string): void {
    const keysToDelete: string[] = [];
    for (const key of this.feedContentCache.keys()) {
      if (key.startsWith(`${schemaName}:`)) {
        keysToDelete.push(key);
      }
    }
    keysToDelete.forEach(key => this.feedContentCache.delete(key));
  }

  /**
   * Get cached image metadata for a transaction ID
   */
  getImageMetadata(transactionId: string): ImageMetadata | null {
    const cached = this.imageMetadataCache.get(transactionId);
    if (!cached) {
      return null;
    }

    // Check if cache is expired
    const now = Math.floor(Date.now() / 1000);
    if (now > cached.expiresAt) {
      this.imageMetadataCache.delete(transactionId);
      return null;
    }

    return cached.metadata;
  }

  /**
   * Set cached image metadata for a transaction ID
   */
  setImageMetadata(transactionId: string, metadata: ImageMetadata): void {
    const now = Math.floor(Date.now() / 1000);
    const imageMetadataTtl = this.config.imageMetadata?.ttl || 604800; // Default 7 days
    const expiresAt = now + imageMetadataTtl;

    const cached: CachedImageMetadata = {
      metadata,
      cachedAt: now,
      expiresAt,
    };

    this.imageMetadataCache.set(transactionId, cached);
  }

  /**
   * Clear all caches
   */
  clearAll(): void {
    this.feedDataCache.clear();
    this.feedContentCache.clear();
    this.imageMetadataCache.clear();
  }

  /**
   * Get or create a refresh lock for a schema
   * Prevents concurrent fetches for the same schema
   */
  async withRefreshLock<T>(
    schemaName: string,
    fn: () => Promise<T>
  ): Promise<T> {
    const existingLock = this.refreshLocks.get(schemaName);
    if (existingLock) {
      // Wait for existing refresh to complete
      await existingLock;
      // Try to get cached data after waiting
      const cached = this.getFeedData(schemaName);
      if (cached) {
        // Re-fetch might not be needed, but we'll let the caller decide
        // For now, we'll proceed with the function
      }
    }

    // Create new lock
    const lockPromise = (async () => {
      try {
        return await fn();
      } finally {
        this.refreshLocks.delete(schemaName);
      }
    })();

    this.refreshLocks.set(schemaName, lockPromise as Promise<void>);
    return lockPromise;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<CacheConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    feedDataCount: number;
    feedContentCount: number;
    imageMetadataCount: number;
    activeLocks: number;
  } {
    return {
      feedDataCount: this.feedDataCache.size,
      feedContentCount: this.feedContentCache.size,
      imageMetadataCount: this.imageMetadataCache.size,
      activeLocks: this.refreshLocks.size,
    };
  }
}
