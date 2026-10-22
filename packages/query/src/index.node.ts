import { FileCache } from './cache/FileCache.js'
import { configurePersistentCacheFactory } from './cache/CacheManager.js'
import { configureQueryArweavePlatform, configureQueryEasPlatform } from './bootstrap.js'
import { registerNodeArweave } from './node/registerNodeArweave.js'
import { registerNodeEas } from './node/registerNodeEas.js'

configurePersistentCacheFactory((config) => new FileCache(config))
configureQueryArweavePlatform(registerNodeArweave)
configureQueryEasPlatform(registerNodeEas)

export * from './index.js'
export { FileCache } from './cache/FileCache.js'
