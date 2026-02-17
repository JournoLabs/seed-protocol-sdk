import { promises as fs } from 'fs';
import { join } from 'path';
import type { CachedFeedData, CachedFeedContent, CacheConfig, CachedImageMetadata } from './types';
import type { GraphQLItem, ImageMetadata } from '../types';

/**
 * File-based persistent cache implementation
 */
export class FileCache {
  private cacheDir: string;
  private config: CacheConfig;

  constructor(config: CacheConfig) {
    this.cacheDir = config.cacheDir;
    this.config = config;
    // Ensure cache directory exists
    this.ensureCacheDir().catch(err => {
      console.error('Failed to create cache directory:', err);
    });
  }

  /**
   * Ensure cache directory exists
   */
  private async ensureCacheDir(): Promise<void> {
    try {
      await fs.mkdir(this.cacheDir, { recursive: true });
    } catch (error) {
      // Directory might already exist, which is fine
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }
    }
  }

  /**
   * Get file path for feed data
   */
  private getFeedDataPath(schemaName: string): string {
    return join(this.cacheDir, `${schemaName}.json`);
  }

  /**
   * Get file path for feed content
   */
  private getFeedContentPath(schemaName: string, format: string): string {
    return join(this.cacheDir, `${schemaName}-${format}.json`);
  }

  /**
   * Get file path for image metadata
   */
  private getImageMetadataPath(transactionId: string): string {
    const imageMetadataDir = join(this.cacheDir, 'image-metadata');
    return join(imageMetadataDir, `${transactionId}.json`);
  }

  /**
   * Ensure image metadata directory exists
   */
  private async ensureImageMetadataDir(): Promise<void> {
    try {
      const imageMetadataDir = join(this.cacheDir, 'image-metadata');
      await fs.mkdir(imageMetadataDir, { recursive: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }
    }
  }

  /**
   * Get cached feed data for a schema
   */
  async getFeedData(schemaName: string): Promise<CachedFeedData | null> {
    try {
      const filePath = this.getFeedDataPath(schemaName);
      const data = await fs.readFile(filePath, 'utf-8');
      const cached: CachedFeedData = JSON.parse(data);

      // Check if cache is expired
      const now = Math.floor(Date.now() / 1000);
      const age = now - cached.lastUpdated;
      if (age > this.config.ttl) {
        // Cache expired, delete file
        await this.clearFeedData(schemaName);
        return null;
      }

      return cached;
    } catch (error) {
      // File doesn't exist or is corrupted
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      console.error(`Error reading feed data cache for ${schemaName}:`, error);
      return null;
    }
  }

  /**
   * Set cached feed data for a schema
   */
  async setFeedData(schemaName: string, data: CachedFeedData): Promise<void> {
    try {
      await this.ensureCacheDir();
      const filePath = this.getFeedDataPath(schemaName);
      await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
      console.error(`Error writing feed data cache for ${schemaName}:`, error);
      // Don't throw - file cache is best effort
    }
  }

  /**
   * Get cached feed content for a schema and format
   */
  async getFeedContent(
    schemaName: string,
    format: string
  ): Promise<CachedFeedContent | null> {
    try {
      const filePath = this.getFeedContentPath(schemaName, format);
      const data = await fs.readFile(filePath, 'utf-8');
      const cached: CachedFeedContent = JSON.parse(data);

      // Check if cache is expired
      const now = Math.floor(Date.now() / 1000);
      if (now > cached.expiresAt) {
        // Cache expired, delete file
        await this.clearFeedContent(schemaName, format);
        return null;
      }

      return cached;
    } catch (error) {
      // File doesn't exist or is corrupted
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      console.error(
        `Error reading feed content cache for ${schemaName}:${format}:`,
        error
      );
      return null;
    }
  }

  /**
   * Set cached feed content for a schema and format
   */
  async setFeedContent(
    schemaName: string,
    format: string,
    content: CachedFeedContent
  ): Promise<void> {
    try {
      await this.ensureCacheDir();
      const filePath = this.getFeedContentPath(schemaName, format);
      await fs.writeFile(filePath, JSON.stringify(content, null, 2), 'utf-8');
    } catch (error) {
      console.error(
        `Error writing feed content cache for ${schemaName}:${format}:`,
        error
      );
      // Don't throw - file cache is best effort
    }
  }

  /**
   * Clear feed data cache for a schema
   */
  async clearFeedData(schemaName: string): Promise<void> {
    try {
      const filePath = this.getFeedDataPath(schemaName);
      await fs.unlink(filePath);
    } catch (error) {
      // File might not exist, which is fine
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error(`Error clearing feed data cache for ${schemaName}:`, error);
      }
    }
  }

  /**
   * Clear content cache for a schema and format
   */
  async clearFeedContent(schemaName: string, format: string): Promise<void> {
    try {
      const filePath = this.getFeedContentPath(schemaName, format);
      await fs.unlink(filePath);
    } catch (error) {
      // File might not exist, which is fine
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error(
          `Error clearing feed content cache for ${schemaName}:${format}:`,
          error
        );
      }
    }
  }

  /**
   * Clear all content cache for a schema (all formats)
   */
  async clearAllContentCache(schemaName: string): Promise<void> {
    try {
      const files = await fs.readdir(this.cacheDir);
      const prefix = `${schemaName}-`;
      const suffix = '.json';

      for (const file of files) {
        if (file.startsWith(prefix) && file.endsWith(suffix) && file !== `${schemaName}.json`) {
          await fs.unlink(join(this.cacheDir, file));
        }
      }
    } catch (error) {
      console.error(`Error clearing all content cache for ${schemaName}:`, error);
    }
  }

  /**
   * Get cached image metadata for a transaction ID
   */
  async getImageMetadata(transactionId: string): Promise<ImageMetadata | null> {
    try {
      const filePath = this.getImageMetadataPath(transactionId);
      const data = await fs.readFile(filePath, 'utf-8');
      const cached: CachedImageMetadata = JSON.parse(data);

      // Check if cache is expired
      const now = Math.floor(Date.now() / 1000);
      if (now > cached.expiresAt) {
        // Cache expired, delete file
        await this.clearImageMetadata(transactionId);
        return null;
      }

      return cached.metadata;
    } catch (error) {
      // File doesn't exist or is corrupted
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      console.error(`Error reading image metadata cache for ${transactionId}:`, error);
      return null;
    }
  }

  /**
   * Set cached image metadata for a transaction ID
   */
  async setImageMetadata(transactionId: string, metadata: ImageMetadata): Promise<void> {
    try {
      await this.ensureImageMetadataDir();
      const filePath = this.getImageMetadataPath(transactionId);
      const now = Math.floor(Date.now() / 1000);
      const imageMetadataTtl = this.config.imageMetadata?.ttl || 604800; // Default 7 days
      const expiresAt = now + imageMetadataTtl;

      const cached: CachedImageMetadata = {
        metadata,
        cachedAt: now,
        expiresAt,
      };

      await fs.writeFile(filePath, JSON.stringify(cached, null, 2), 'utf-8');
    } catch (error) {
      console.error(`Error writing image metadata cache for ${transactionId}:`, error);
      // Don't throw - file cache is best effort
    }
  }

  /**
   * Clear image metadata cache for a transaction ID
   */
  async clearImageMetadata(transactionId: string): Promise<void> {
    try {
      const filePath = this.getImageMetadataPath(transactionId);
      await fs.unlink(filePath);
    } catch (error) {
      // File might not exist, which is fine
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error(`Error clearing image metadata cache for ${transactionId}:`, error);
      }
    }
  }

  /**
   * Clear all caches
   */
  async clearAll(): Promise<void> {
    try {
      const files = await fs.readdir(this.cacheDir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          await fs.unlink(join(this.cacheDir, file));
        }
      }
      // Also clear image metadata directory
      const imageMetadataDir = join(this.cacheDir, 'image-metadata');
      try {
        const imageFiles = await fs.readdir(imageMetadataDir);
        for (const file of imageFiles) {
          if (file.endsWith('.json')) {
            await fs.unlink(join(imageMetadataDir, file));
          }
        }
      } catch {
        // Directory might not exist, which is fine
      }
    } catch (error) {
      console.error('Error clearing all caches:', error);
    }
  }
}
