import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'
import { persistQueryClient } from '@tanstack/react-query-persist-client'
import { BaseQueryClient } from '@/helpers/QueryClient/BaseQueryClient'

const queryClient = BaseQueryClient.getQueryClient()

const localStoragePersister = createSyncStoragePersister({
  storage: typeof window !== 'undefined' ? window.localStorage : null,
})

persistQueryClient({
  queryClient,
  persister: localStoragePersister,
})


