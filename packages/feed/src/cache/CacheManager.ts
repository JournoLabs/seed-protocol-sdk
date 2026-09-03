import { MemoryCache } from './MemoryCache';
import { FileCache } from './FileCache';
import type {
  CachedFeedContent,
  CacheConfig,
  CacheContentKeyOptions,
  CacheStats,
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
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    refreshes: 0,
    errors: 0,
  };

  constructor(config: CacheConfig) {
    this.config = config;
    this.memoryCache = new MemoryCache(config);
    this.fileCache = new FileCache(config);
  }

  async getFeedContent(
    schemaName: string,
    format: FeedFormat,
    contentKeyOptions?: CacheContentKeyOptions
  ): Promise<CachedFeedContent | null> {
    if (!this.config.enabled) {
      return null;
    }

    try {
      let cached = this.memoryCache.getFeedContent(schemaName, format, contentKeyOptions);
      if (cached) {
        this.stats.hits++;
        return cached;
      }

      cached = await this.fileCache.getFeedContent(schemaName, format, contentKeyOptions);
      if (cached) {
        this.memoryCache.setFeedContent(
          schemaName,
          format,
          cached.content,
          cached.contentType,
          contentKeyOptions
        );
        this.stats.hits++;
        return cached;
      }

      this.stats.misses++;
      return null;
    } catch (error) {
      console.error(
        `Error getting feed content cache for ${schemaName}:${format}:`,
        error
      );
      this.stats.errors++;
      return null;
    }
  }

  async setFeedContent(
    schemaName: string,
    format: FeedFormat,
    content: string,
    contentType: string,
    contentKeyOptions?: CacheContentKeyOptions
  ): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    try {
      let ttlOverride: number | undefined;
      if (contentKeyOptions?.archive) {
        ttlOverride = this.config.archiveTtl ?? 86400;
      } else if (contentKeyOptions?.page != null && contentKeyOptions.page > 1) {
        ttlOverride = this.config.pageTtl ?? 300;
      }

      this.memoryCache.setFeedContent(
        schemaName,
        format,
        content,
        contentType,
        contentKeyOptions,
        ttlOverride
      );

      const cached = this.memoryCache.getFeedContent(schemaName, format, contentKeyOptions);
      if (cached) {
        await this.fileCache.setFeedContent(schemaName, format, cached, contentKeyOptions);
      }
    } catch (error) {
      console.error(
        `Error setting feed content cache for ${schemaName}:${format}:`,
        error
      );
      this.stats.errors++;
    }
  }

  async clearContent(schemaName: string): Promise<void> {
    this.memoryCache.clearContentCache(schemaName);
    await this.fileCache.clearAllContentCache(schemaName);
  }

  async clearAll(): Promise<void> {
    this.memoryCache.clearAll();
    await this.fileCache.clearAll();
  }

  updateConfig(config: Partial<CacheConfig>): void {
    this.config = { ...this.config, ...config };
    this.memoryCache.updateConfig(this.config);
  }

  getStats(): CacheStats & { memoryStats: ReturnType<MemoryCache['getStats']> } {
    return {
      ...this.stats,
      memoryStats: this.memoryCache.getStats(),
    };
  }

  async getImageMetadata(transactionId: string): Promise<ImageMetadata | null> {
    if (!this.config.enabled || !this.config.imageMetadata?.enabled) {
      return null;
    }

    try {
      let cached = this.memoryCache.getImageMetadata(transactionId);
      if (cached) {
        this.stats.hits++;
        return cached;
      }

      cached = await this.fileCache.getImageMetadata(transactionId);
      if (cached) {
        this.memoryCache.setImageMetadata(transactionId, cached);
        this.stats.hits++;
        return cached;
      }

      this.stats.misses++;
      return null;
    } catch (error) {
      console.error(`Error getting image metadata cache for ${transactionId}:`, error);
      this.stats.errors++;
      return null;
    }
  }

  async setImageMetadata(transactionId: string, metadata: ImageMetadata): Promise<void> {
    if (!this.config.enabled || !this.config.imageMetadata?.enabled) {
      return;
    }

    try {
      this.memoryCache.setImageMetadata(transactionId, metadata);
      await this.fileCache.setImageMetadata(transactionId, metadata);
    } catch (error) {
      console.error(`Error setting image metadata cache for ${transactionId}:`, error);
      this.stats.errors++;
    }
  }

  resetStats(): void {
    this.stats = {
      hits: 0,
      misses: 0,
      refreshes: 0,
      errors: 0,
    };
  }
}
