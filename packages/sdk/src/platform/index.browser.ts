import { BrowserFileManager } from '@/browser/helpers/FileManager'
import { BrowserDb } from '@/browser/db/Db'
import { BrowserArweaveClient } from '@/browser/helpers/ArweaveClient'
import { BrowserEasClient } from '@/browser/helpers/EasClient'
import { BrowserQueryClient } from '@/browser/helpers/QueryClient'
import type { PlatformServices } from './types'

export function createPlatformServices(): PlatformServices {
  return {
    fileManager: new BrowserFileManager(),
    db: new BrowserDb(),
    arweaveClient: new BrowserArweaveClient(),
    easClient: new BrowserEasClient(),
    queryClient: new BrowserQueryClient(),
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
