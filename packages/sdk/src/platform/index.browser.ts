import { BrowserFileManager } from '@/browser/helpers/FileManager'
import { BrowserDb } from '@/browser/db/Db'
import { DefaultArweaveClient } from '@seedprotocol/arweave'
import { DefaultEasClient, DefaultQueryClient } from '@seedprotocol/eas'
import type { PlatformServices } from './types'

export function createPlatformServices(): PlatformServices {
  return {
    fileManager: new BrowserFileManager(),
    db: new BrowserDb(),
    arweaveClient: new DefaultArweaveClient(),
    easClient: new DefaultEasClient(),
    queryClient: new DefaultQueryClient(),
  }
}

/**
 * The browser keeps filesDir as given (an OPFS path). Exported to match the Node platform:
 * bundlers substitute this module for `#seed-node-platform` in browser builds.
 */
export function resolveFilesDir(filesDir: string): string {
  return filesDir
}

export { configurePlatform } from './configurePlatform'
export type { PlatformServices } from './types'
