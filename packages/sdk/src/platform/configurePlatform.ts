import { BasePathResolver } from '@/helpers/PathResolver/BasePathResolver'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { BaseDb } from '@/db/Db/BaseDb'
import { BaseArweaveClient } from '@/helpers'
import { BaseEasClient } from '@/helpers/EasClient/BaseEasClient'
import { BaseQueryClient } from '@/helpers/QueryClient/BaseQueryClient'
import type { PlatformServices } from './types'

/**
 * Wire all platform facades to the given service instances.
 */
export function configurePlatform(services: PlatformServices): void {
  BasePathResolver.configure(services.pathResolver)
  BaseFileManager.configure(services.fileManager)
  BaseDb.configure(services.db)
  BaseArweaveClient.configure(services.arweaveClient)
  BaseEasClient.configure(services.easClient)
  BaseQueryClient.configure(services.queryClient)
}
