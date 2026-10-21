import { NodeFileManager } from '@/node/helpers/FileManager'
import { NodeDb } from '@/node/db/Db'
import { DefaultArweaveClient } from '@seedprotocol/arweave'
import { DefaultQueryClient } from '@seedprotocol/eas'
import { NodeEasClient } from '@seedprotocol/eas/node'
import type { PlatformServices } from './types'

export function createPlatformServices(): PlatformServices {
  return {
    fileManager: new NodeFileManager(),
    db: new NodeDb(),
    arweaveClient: new DefaultArweaveClient(),
    // Own undici Agent for EAS requests: shorter TLS handshake on Node 24.21+, 30 s keep-alive.
    easClient: new NodeEasClient(),
    queryClient: new DefaultQueryClient(),
  }
}

export { configurePlatform } from './configurePlatform'
export { resolveFilesDir } from '@/node/helpers/resolveFilesDir'
export type { PlatformServices } from './types'
