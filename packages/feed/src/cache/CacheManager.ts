import { MemoryCache } from './MemoryCache';
import { FileCache } from './FileCache';
import type {
  CachedFeedData,
  CachedFeedContent,
  CacheConfig,
  CacheStats,
} from './types';
import type { GraphQLItem, ImageMetadata } from '../types';
import type { FeedFormat } from '../types';

/**
 * Unified cache manager that combines in-memory and file-based caching
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

  /**
   * Get cached feed data for a schema
   * Checks memory cache first, then file cache
   */
  async getFeedData(schemaName: string): Promise<CachedFeedData | null> {
    if (!this.config.enabled) {
      return null;
    }

    try {
      // Check memory cache first
      let cached = this.memoryCache.getFeedData(schemaName);
      if (cached) {
        this.stats.hits++;
        return cached;
      }

      // Check file cache
      cached = await this.fileCache.getFeedData(schemaName);
      if (cached) {
        // Restore to memory cache
        this.memoryCache.setFeedData(schemaName, cached.items);
        this.stats.hits++;
        return cached;
      }

      this.stats.misses++;
      return null;
    } catch (error) {
      console.error(`Error getting feed data cache for ${schemaName}:`, error);
      this.stats.errors++;
      return null;
    }
  }

  /**
   * Set cached feed data for a schema
   * Updates both memory and file cache
   */
  async setFeedData(schemaName: string, items: GraphQLItem[]): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    try {
      // Update memory cache
      this.memoryCache.setFeedData(schemaName, items);

      // Get the cached data to save to file
      const cached = this.memoryCache.getFeedData(schemaName);
      if (cached) {
        await this.fileCache.setFeedData(schemaName, cached);
      }
    } catch (error) {
      console.error(`Error setting feed data cache for ${schemaName}:`, error);
      this.stats.errors++;
    }
  }

  /**
   * Get cached feed content for a schema and format
   * Checks memory cache first, then file cache
   */
  async getFeedContent(
    schemaName: string,
    format: FeedFormat
  ): Promise<CachedFeedContent | null> {
    if (!this.config.enabled) {
      return null;
    }

    try {
      // Check memory cache first
      let cached = this.memoryCache.getFeedContent(schemaName, format);
      if (cached) {
        this.stats.hits++;
        return cached;
      }

      // Check file cache
      cached = await this.fileCache.getFeedContent(schemaName, format);
      if (cached) {
        // Restore to memory cache
        this.memoryCache.setFeedContent(
          schemaName,
          format,
          cached.content,
          cached.contentType
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

  /**
   * Set cached feed content for a schema and format
   * Updates both memory and file cache
   */
  async setFeedContent(
    schemaName: string,
    format: FeedFormat,
    content: string,
    contentType: string
  ): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    try {
      // Update memory cache
      this.memoryCache.setFeedContent(schemaName, format, content, contentType);

      // Get the cached content to save to file
      const cached = this.memoryCache.getFeedContent(schemaName, format);
      if (cached) {
        await this.fileCache.setFeedContent(schemaName, format, cached);
      }
    } catch (error) {
      console.error(
        `Error setting feed content cache for ${schemaName}:${format}:`,
        error
      );
      this.stats.errors++;
    }
  }

  /**
   * Clear feed data cache for a schema
   */
  async clearFeedData(schemaName: string): Promise<void> {
    this.memoryCache.clearFeedData(schemaName);
    await this.fileCache.clearFeedData(schemaName);
    this.memoryCache.clearContentCache(schemaName);
    await this.fileCache.clearAllContentCache(schemaName);
  }

  /**
   * Clear all caches
   */
  async clearAll(): Promise<void> {
    this.memoryCache.clearAll();
    await this.fileCache.clearAll();
  }

  /**
   * Get or create a refresh lock for a schema
   * Prevents concurrent fetches for the same schema
   */
  async withRefreshLock<T>(
    schemaName: string,
    fn: () => Promise<T>
  ): Promise<T> {
    return this.memoryCache.withRefreshLock(schemaName, fn);
  }

  /**
   * Merge new items with cached items
   * Deduplicates by item ID and sorts by timeCreated (descending)
   */
  mergeItems(cachedItems: GraphQLItem[], newItems: GraphQLItem[]): GraphQLItem[] {
    // Create a map of existing items by ID
    const itemMap = new Map<string, GraphQLItem>();
    
    // Add cached items first
    for (const item of cachedItems) {
      const itemId = item.id || (item as any).seedUid || (item as any).SeedUid || '';
      if (itemId) {
        itemMap.set(itemId, item);
      }
    }

    // Add or update with new items
    for (const item of newItems) {
      const itemId = item.id || (item as any).seedUid || (item as any).SeedUid || '';
      if (itemId) {
        itemMap.set(itemId, item);
      } else {
        // If no ID, add it anyway (might be a new item)
        itemMap.set(`temp-${Date.now()}-${Math.random()}`, item);
      }
    }

    // Convert back to array and sort by timeCreated (descending)
    const merged = Array.from(itemMap.values());
    merged.sort((a, b) => {
      const timeA = (a as any).timeCreated || 0;
      const timeB = (b as any).timeCreated || 0;
      return timeB - timeA; // Descending order
    });

    return merged;
  }

  /**
   * Filter items to only include those newer than the given timestamp
   */
  filterNewItems(items: GraphQLItem[], lastProcessedTimestamp: number): GraphQLItem[] {
    return items.filter(item => {
      const timeCreated = (item as any).timeCreated;
      return timeCreated && timeCreated > lastProcessedTimestamp;
    });
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<CacheConfig>): void {
    this.config = { ...this.config, ...config };
    this.memoryCache.updateConfig(this.config);
    // FileCache doesn't need config update as it's read-only after construction
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats & { memoryStats: ReturnType<MemoryCache['getStats']> } {
    return {
      ...this.stats,
      memoryStats: this.memoryCache.getStats(),
    };
  }

  /**
   * Get cached image metadata for a transaction ID
   * Checks memory cache first, then file cache
   */
  async getImageMetadata(transactionId: string): Promise<ImageMetadata | null> {
    if (!this.config.enabled || !this.config.imageMetadata?.enabled) {
      return null;
    }

    try {
      // Check memory cache first
      let cached = this.memoryCache.getImageMetadata(transactionId);
      if (cached) {
        this.stats.hits++;
        return cached;
      }

      // Check file cache
      cached = await this.fileCache.getImageMetadata(transactionId);
      if (cached) {
        // Restore to memory cache
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

  /**
   * Set cached image metadata for a transaction ID
   * Updates both memory and file cache
   */
  async setImageMetadata(transactionId: string, metadata: ImageMetadata): Promise<void> {
    if (!this.config.enabled || !this.config.imageMetadata?.enabled) {
      return;
    }

    try {
      // Update memory cache
      this.memoryCache.setImageMetadata(transactionId, metadata);

      // Also update file cache
      await this.fileCache.setImageMetadata(transactionId, metadata);
    } catch (error) {
      console.error(`Error setting image metadata cache for ${transactionId}:`, error);
      this.stats.errors++;
    }
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      hits: 0,
      misses: 0,
      refreshes: 0,
      errors: 0,
    };
  }
}
