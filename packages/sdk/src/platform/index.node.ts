import { NodeFileManager } from '@/node/helpers/FileManager'
import { NodeDb } from '@/node/db/Db'
import { DefaultArweaveClient } from '@seedprotocol/arweave'
import { DefaultEasClient, DefaultQueryClient } from '@seedprotocol/eas'
import type { PlatformServices } from './types'

export function createPlatformServices(): PlatformServices {
  return {
    fileManager: new NodeFileManager(),
    db: new NodeDb(),
    arweaveClient: new DefaultArweaveClient(),
    easClient: new DefaultEasClient(),
    queryClient: new DefaultQueryClient(),
  }
}

export { configurePlatform } from './configurePlatform'
export { resolveFilesDir } from '@/node/helpers/resolveFilesDir'
export type { PlatformServices } from './types'
