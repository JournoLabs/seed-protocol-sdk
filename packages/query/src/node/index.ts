import { configureQueryArweavePlatform, configureQueryEasPlatform } from '../bootstrap.js'
import { registerNodeArweave } from './registerNodeArweave.js'
import { registerNodeEas } from './registerNodeEas.js'

configureQueryArweavePlatform(registerNodeArweave)
configureQueryEasPlatform(registerNodeEas)

export { initializeQueryPlatform, teardownQueryPlatform, isQueryPlatformInitialized } from '../bootstrap.js'
export type { InitializeQueryPlatformOptions } from '../bootstrap.js'
export { FileCache } from '../cache/FileCache.js'
