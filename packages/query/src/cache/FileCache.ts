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

  private collectionsDir(): string {
    return join(this.cacheDir, 'collections')
  }

  /** Under `collections/`, so feed's own `{schema}-{format}.json` cleanup never matches it. */
  private collectionPath(schemaName: string, optionsKey: string): string {
    return join(this.collectionsDir(), `${sanitizeSeedUidForPath(schemaName)}.${optionsKey}.json`)
  }

  private itemPath(seedUid: string, optionsKey: string): string {
    const safe = sanitizeSeedUidForPath(seedUid)
    return join(this.cacheDir, 'items', `${safe}-${optionsKey}.json`)
  }

  async getCollection(
    schemaName: string,
    optionsKey: string,
  ): Promise<CachedCollectionData | null> {
    const path = this.collectionPath(schemaName, optionsKey)
    try {
      const data = await fs.readFile(path, 'utf-8')
      const cached: CachedCollectionData = JSON.parse(data)
      const now = Math.floor(Date.now() / 1000)
      if (now - cached.lastUpdated > this.config.ttl) {
        await fs.unlink(path).catch(() => {})
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
    optionsKey: string,
    data: CachedCollectionData,
  ): Promise<void> {
    try {
      await fs.mkdir(this.collectionsDir(), { recursive: true })
      await fs.writeFile(
        this.collectionPath(schemaName, optionsKey),
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
    const prefix = `${sanitizeSeedUidForPath(schemaName)}.`
    try {
      const files = await fs.readdir(this.collectionsDir())
      for (const file of files) {
        if (file.startsWith(prefix) && file.endsWith('.json')) {
          await fs.unlink(join(this.collectionsDir(), file))
        }
      }
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
      for (const dir of [join(this.cacheDir, 'items'), this.collectionsDir()]) {
        try {
          const dirFiles = await fs.readdir(dir)
          for (const file of dirFiles) {
            if (file.endsWith('.json')) {
              await fs.unlink(join(dir, file))
            }
          }
        } catch {
          // dir may not exist
        }
      }
    } catch (error) {
      console.error('Error clearing all query caches:', error)
    }
  }
}
