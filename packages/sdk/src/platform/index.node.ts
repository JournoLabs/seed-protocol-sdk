import { NodeFileManager } from '@/node/helpers/FileManager'
import { NodeDb } from '@/node/db/Db'
import { NodeArweaveClient } from '@/node/helpers/ArweaveClient'
import { NodeEasClient } from '@/node/helpers/EasClient'
import { NodeQueryClient } from '@/node/helpers/QueryClient'
import type { PlatformServices } from './types'

export function createPlatformServices(): PlatformServices {
  return {
    fileManager: new NodeFileManager(),
    db: new NodeDb(),
    arweaveClient: new NodeArweaveClient(),
    easClient: new NodeEasClient(),
    queryClient: new NodeQueryClient(),
  }
}

export { configurePlatform } from './configurePlatform'
export { resolveFilesDir } from '@/node/helpers/resolveFilesDir'
export type { PlatformServices } from './types'
