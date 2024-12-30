import { QueryClient } from '@tanstack/react-query'
import { GraphQLClient } from 'graphql-request'
import {
  ARWEAVE_ENDPOINT,
  EAS_ENDPOINT,
  MachineIds,
} from '@/browser/services/internal/constants'
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'
import { persistQueryClient } from '@tanstack/react-query-persist-client'
import { fs } from '@zenfs/core'
import { basename } from 'path'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      networkMode: 'offlineFirst',
      gcTime: 1000 * 60 * 60 * 24, // 24 hours
    },
  },
})

const localStoragePersister = createSyncStoragePersister({
  storage: typeof window !== 'undefined' ? window.localStorage : null,
})

persistQueryClient({
  queryClient,
  persister: localStoragePersister,
})

export const easClient = new GraphQLClient(EAS_ENDPOINT)
export const arweaveClient = new GraphQLClient(ARWEAVE_ENDPOINT)

export const getSaveStateKey = (serviceId, modelName) => {
  return `seed_sdk_service_${MachineIds.ALL_ITEMS}_${modelName}`
}

type GetCorrectIdReturn = {
  localId?: string
  uid?: string
}

type GetCorrectId = (localIdOrUid: string) => GetCorrectIdReturn

export const getCorrectId: GetCorrectId = (localIdOrUid: string) => {
  const id: GetCorrectIdReturn = {
    localId: undefined,
    uid: undefined,
  }
  if (!localIdOrUid) {
    return id
  }
  if (localIdOrUid.length === 10) {
    id.localId = localIdOrUid
  }
  if (localIdOrUid.startsWith('0x') && localIdOrUid.length === 66) {
    id.uid = localIdOrUid
  }
  return id
}

export const getContentUrlFromPath = async (
  path: string,
): Promise<string | undefined> => {
  const imageFileExists = await fs.promises.exists(path)
  if (!imageFileExists) {
    return
  }
  const fileContents = await fs.promises.readFile(path)
  const fileHandler = new File([fileContents], basename(path))
  return URL.createObjectURL(fileHandler)
}
