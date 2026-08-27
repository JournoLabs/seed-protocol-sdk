import type { IPathResolver } from '@/helpers/PathResolver/IPathResolver'
import type { IFileManager } from '@/helpers/FileManager/IFileManager'
import type { IDb } from '@/interfaces/IDb'
import type { IArweaveClient } from '@seedprotocol/arweave'
import type { IEasClient, IQueryClientFactory } from '@seedprotocol/eas'

export type PlatformServices = {
  pathResolver: IPathResolver
  fileManager: IFileManager
  db: IDb
  arweaveClient: IArweaveClient
  easClient: IEasClient
  queryClient: IQueryClientFactory
}
