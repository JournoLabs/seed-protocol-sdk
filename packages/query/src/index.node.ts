import { FileCache } from './cache/FileCache.js'
import { configurePersistentCacheFactory } from './cache/CacheManager.js'

configurePersistentCacheFactory((config) => new FileCache(config))

export * from './index.js'
export { FileCache } from './cache/FileCache.js'
