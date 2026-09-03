import { promises as fs } from 'fs';
import { join } from 'path';
import type { CachedFeedContent, CacheConfig, CacheContentKeyOptions, CachedImageMetadata } from './types';
import { buildContentKey } from './types';
import type { ImageMetadata } from '../types';

/**
 * File-based persistent cache for serialized feed content and image metadata.
 */
export class FileCache {
  private cacheDir: string;
  private config: CacheConfig;

  constructor(config: CacheConfig) {
    this.cacheDir = config.cacheDir;
    this.config = config;
    this.ensureCacheDir().catch(err => {
      console.error('Failed to create cache directory:', err);
    });
  }

  private async ensureCacheDir(): Promise<void> {
    try {
      await fs.mkdir(this.cacheDir, { recursive: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }
    }
  }

  private getFeedContentPath(
    schemaName: string,
    format: string,
    contentKeyOptions?: CacheContentKeyOptions
  ): string {
    const key = buildContentKey(schemaName, format, contentKeyOptions);
    const filePart = key.replace(/:/g, '-');
    return join(this.cacheDir, `${filePart}.json`);
  }

  private getImageMetadataPath(transactionId: string): string {
    const imageMetadataDir = join(this.cacheDir, 'image-metadata');
    return join(imageMetadataDir, `${transactionId}.json`);
  }

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

  async getFeedContent(
    schemaName: string,
    format: string,
    contentKeyOptions?: CacheContentKeyOptions
  ): Promise<CachedFeedContent | null> {
    try {
      const filePath = this.getFeedContentPath(schemaName, format, contentKeyOptions);
      const data = await fs.readFile(filePath, 'utf-8');
      const cached: CachedFeedContent = JSON.parse(data);

      const now = Math.floor(Date.now() / 1000);
      if (now > cached.expiresAt) {
        await this.clearFeedContent(schemaName, format, contentKeyOptions);
        return null;
      }

      return cached;
    } catch (error) {
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

  async setFeedContent(
    schemaName: string,
    format: string,
    content: CachedFeedContent,
    contentKeyOptions?: CacheContentKeyOptions
  ): Promise<void> {
    try {
      await this.ensureCacheDir();
      const filePath = this.getFeedContentPath(schemaName, format, contentKeyOptions);
      await fs.writeFile(filePath, JSON.stringify(content, null, 2), 'utf-8');
    } catch (error) {
      console.error(
        `Error writing feed content cache for ${schemaName}:${format}:`,
        error
      );
    }
  }

  async clearFeedContent(
    schemaName: string,
    format: string,
    contentKeyOptions?: CacheContentKeyOptions
  ): Promise<void> {
    try {
      const filePath = this.getFeedContentPath(schemaName, format, contentKeyOptions);
      await fs.unlink(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error(
          `Error clearing feed content cache for ${schemaName}:${format}:`,
          error
        );
      }
    }
  }

  async clearAllContentCache(schemaName: string): Promise<void> {
    try {
      const files = await fs.readdir(this.cacheDir);
      const prefix = `${schemaName}-`;
      const suffix = '.json';

      for (const file of files) {
        // Content keys are schema-format[-page|archive]; skip bare schema.json
        // (owned by @seedprotocol/query collection cache).
        if (file.startsWith(prefix) && file.endsWith(suffix) && file !== `${schemaName}.json`) {
          await fs.unlink(join(this.cacheDir, file));
        }
      }
    } catch (error) {
      console.error(`Error clearing all content cache for ${schemaName}:`, error);
    }
  }

  async getImageMetadata(transactionId: string): Promise<ImageMetadata | null> {
    try {
      const filePath = this.getImageMetadataPath(transactionId);
      const data = await fs.readFile(filePath, 'utf-8');
      const cached: CachedImageMetadata = JSON.parse(data);

      const now = Math.floor(Date.now() / 1000);
      if (now > cached.expiresAt) {
        await this.clearImageMetadata(transactionId);
        return null;
      }

      return cached.metadata;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      console.error(`Error reading image metadata cache for ${transactionId}:`, error);
      return null;
    }
  }

  async setImageMetadata(transactionId: string, metadata: ImageMetadata): Promise<void> {
    try {
      await this.ensureImageMetadataDir();
      const filePath = this.getImageMetadataPath(transactionId);
      const now = Math.floor(Date.now() / 1000);
      const imageMetadataTtl = this.config.imageMetadata?.ttl || 604800;
      const expiresAt = now + imageMetadataTtl;

      const cached: CachedImageMetadata = {
        metadata,
        cachedAt: now,
        expiresAt,
      };

      await fs.writeFile(filePath, JSON.stringify(cached, null, 2), 'utf-8');
    } catch (error) {
      console.error(`Error writing image metadata cache for ${transactionId}:`, error);
    }
  }

  async clearImageMetadata(transactionId: string): Promise<void> {
    try {
      const filePath = this.getImageMetadataPath(transactionId);
      await fs.unlink(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error(`Error clearing image metadata cache for ${transactionId}:`, error);
      }
    }
  }

  async clearAll(): Promise<void> {
    try {
      const files = await fs.readdir(this.cacheDir);
      for (const file of files) {
        // Do not delete bare {schema}.json — query collection cache files
        if (file.endsWith('.json') && file.includes('-')) {
          await fs.unlink(join(this.cacheDir, file));
        }
      }
      const imageMetadataDir = join(this.cacheDir, 'image-metadata');
      try {
        const imageFiles = await fs.readdir(imageMetadataDir);
        for (const file of imageFiles) {
          if (file.endsWith('.json')) {
            await fs.unlink(join(imageMetadataDir, file));
          }
        }
      } catch {
        // Directory might not exist
      }
    } catch (error) {
      console.error('Error clearing all caches:', error);
    }
  }
}
