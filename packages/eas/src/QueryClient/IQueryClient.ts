type FetchQueryOptions<T = unknown> = {
  queryKey: readonly unknown[]
  queryFn: () => Promise<T>
  networkMode?: 'offlineFirst' | 'onlineOnly'
  staleTime?: number
}

export type { FetchQueryOptions }

export interface IQueryClient {
  fetchQuery: <T>(options: FetchQueryOptions<T>) => Promise<T>
  getQueryData: (queryKey: readonly unknown[]) => unknown
  removeQueries: (filters: { queryKey: readonly unknown[] }) => Promise<void>
}
