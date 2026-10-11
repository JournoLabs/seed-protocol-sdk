import { configureQueryArweavePlatform } from '../bootstrap.js'
import { registerNodeArweave } from './registerNodeArweave.js'

configureQueryArweavePlatform(registerNodeArweave)

export { initializeQueryPlatform, teardownQueryPlatform, isQueryPlatformInitialized } from '../bootstrap.js'
export type { InitializeQueryPlatformOptions } from '../bootstrap.js'
export { FileCache } from '../cache/FileCache.js'
