import { promises as fs } from 'fs'
import { join } from 'path'
import type {
  CachedCollectionData,
  CachedItemData,
  QueryCacheConfig,
} from './types.js'
import { sanitizeSeedUidForPath } from './types.js'

/**
 * File-based persistent cache for collections and items (Node / best-effort).
 */
export class FileCache {
  private cacheDir: string
  private config: QueryCacheConfig

  constructor(config: QueryCacheConfig) {
    this.cacheDir = config.cacheDir
    this.config = config
    this.ensureCacheDir().catch((err) => {
      console.error('Failed to create query cache directory:', err)
    })
  }

  private async ensureCacheDir(): Promise<void> {
    try {
      await fs.mkdir(this.cacheDir, { recursive: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error
      }
    }
  }

  private async ensureItemsDir(): Promise<void> {
    try {
      await fs.mkdir(join(this.cacheDir, 'items'), { recursive: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error
      }
    }
  }

  private collectionPath(schemaName: string): string {
    return join(this.cacheDir, `${schemaName}.json`)
  }

  private itemPath(seedUid: string, optionsKey: string): string {
    const safe = sanitizeSeedUidForPath(seedUid)
    return join(this.cacheDir, 'items', `${safe}-${optionsKey}.json`)
  }

  async getCollection(schemaName: string): Promise<CachedCollectionData | null> {
    try {
      const data = await fs.readFile(this.collectionPath(schemaName), 'utf-8')
      const cached: CachedCollectionData = JSON.parse(data)
      const now = Math.floor(Date.now() / 1000)
      if (now - cached.lastUpdated > this.config.ttl) {
        await this.clearCollection(schemaName)
        return null
      }
      return cached
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null
      }
      console.error(
        `Error reading query collection cache for ${schemaName}:`,
        error,
      )
      return null
    }
  }

  async setCollection(
    schemaName: string,
    data: CachedCollectionData,
  ): Promise<void> {
    try {
      await this.ensureCacheDir()
      await fs.writeFile(
        this.collectionPath(schemaName),
        JSON.stringify(data, null, 2),
        'utf-8',
      )
    } catch (error) {
      console.error(
        `Error writing query collection cache for ${schemaName}:`,
        error,
      )
    }
  }

  async getItem(
    seedUid: string,
    optionsKey: string,
  ): Promise<CachedItemData | null> {
    try {
      const data = await fs.readFile(
        this.itemPath(seedUid, optionsKey),
        'utf-8',
      )
      const cached: CachedItemData = JSON.parse(data)
      const now = Math.floor(Date.now() / 1000)
      if (now - cached.lastUpdated > this.config.ttl) {
        await this.clearItem(seedUid, optionsKey)
        return null
      }
      return cached
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null
      }
      console.error(`Error reading query item cache for ${seedUid}:`, error)
      return null
    }
  }

  async setItem(data: CachedItemData): Promise<void> {
    try {
      await this.ensureItemsDir()
      await fs.writeFile(
        this.itemPath(data.record.seedUid, data.optionsKey),
        JSON.stringify(data, null, 2),
        'utf-8',
      )
    } catch (error) {
      console.error(
        `Error writing query item cache for ${data.record.seedUid}:`,
        error,
      )
    }
  }

  async clearCollection(schemaName: string): Promise<void> {
    try {
      await fs.unlink(this.collectionPath(schemaName))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error(
          `Error clearing query collection cache for ${schemaName}:`,
          error,
        )
      }
    }
  }

  async clearItem(seedUid: string, optionsKey: string): Promise<void> {
    try {
      await fs.unlink(this.itemPath(seedUid, optionsKey))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error(
          `Error clearing query item cache for ${seedUid}:`,
          error,
        )
      }
    }
  }

  async clearAll(): Promise<void> {
    try {
      const files = await fs.readdir(this.cacheDir)
      for (const file of files) {
        if (file.endsWith('.json')) {
          await fs.unlink(join(this.cacheDir, file))
        }
      }
      const itemsDir = join(this.cacheDir, 'items')
      try {
        const itemFiles = await fs.readdir(itemsDir)
        for (const file of itemFiles) {
          if (file.endsWith('.json')) {
            await fs.unlink(join(itemsDir, file))
          }
        }
      } catch {
        // items dir may not exist
      }
    } catch (error) {
      console.error('Error clearing all query caches:', error)
    }
  }
}
