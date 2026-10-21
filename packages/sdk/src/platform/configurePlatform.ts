import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { BaseDb } from '@/db/Db/BaseDb'
import { BaseArweaveClient } from '@seedprotocol/arweave'
import { BaseEasClient, BaseQueryClient } from '@seedprotocol/eas'
import type { PlatformServices } from './types'

/**
 * Wire all platform facades to the given service instances.
 */
export function configurePlatform(services: PlatformServices): void {
  BaseFileManager.configure(services.fileManager)
  BaseDb.configure(services.db)
  BaseArweaveClient.configure(services.arweaveClient)
  BaseEasClient.configure(services.easClient)
  BaseQueryClient.configure(services.queryClient)
}
