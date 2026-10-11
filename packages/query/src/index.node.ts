import { FileCache } from './cache/FileCache.js'
import { configurePersistentCacheFactory } from './cache/CacheManager.js'
import { configureQueryArweavePlatform } from './bootstrap.js'
import { registerNodeArweave } from './node/registerNodeArweave.js'

configurePersistentCacheFactory((config) => new FileCache(config))
configureQueryArweavePlatform(registerNodeArweave)

export * from './index.js'
export { FileCache } from './cache/FileCache.js'
