import { BrowserPathResolver } from '@/browser/helpers/PathResolver'
import { BrowserFileManager } from '@/browser/helpers/FileManager'
import { BrowserDb } from '@/browser/db/Db'
import { BrowserArweaveClient } from '@/browser/helpers/ArweaveClient'
import { BrowserEasClient } from '@/browser/helpers/EasClient'
import { BrowserQueryClient } from '@/browser/helpers/QueryClient'
import type { PlatformServices } from './types'

export function createPlatformServices(): PlatformServices {
  return {
    pathResolver: new BrowserPathResolver(),
    fileManager: new BrowserFileManager(),
    db: new BrowserDb(),
    arweaveClient: new BrowserArweaveClient(),
    easClient: new BrowserEasClient(),
    queryClient: new BrowserQueryClient(),
  }
}
