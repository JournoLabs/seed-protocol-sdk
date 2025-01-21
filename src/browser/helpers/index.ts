import { GraphQLClient } from 'graphql-request'
import {
  ARWEAVE_ENDPOINT,
  EAS_ENDPOINT,
  MachineIds,
} from '@/services/internal/constants'
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'
import { persistQueryClient } from '@tanstack/react-query-persist-client'
import { fs } from '@zenfs/core'
import { basename } from 'path'
import { BaseQueryClient } from '@/helpers/QueryClient/BaseQueryClient'

const queryClient = BaseQueryClient.getQueryClient()

const localStoragePersister = createSyncStoragePersister({
  storage: typeof window !== 'undefined' ? window.localStorage : null,
})

persistQueryClient({
  queryClient,
  persister: localStoragePersister,
})

export const getSaveStateKey = (serviceId, modelName) => {
  return `seed_sdk_service_${MachineIds.ALL_ITEMS}_${modelName}`
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
