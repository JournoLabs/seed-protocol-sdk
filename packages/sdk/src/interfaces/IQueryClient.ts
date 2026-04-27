
type FetchQueryOptions = {
  queryKey: any
  queryFn: () => Promise<any>
  networkMode?: 'offlineFirst' | 'onlineOnly'
  staleTime?: number
}

export interface IQueryClient {
  fetchQuery: (options: FetchQueryOptions) => Promise<any>
  getQueryData: (queryKey: any) => any
  removeQueries: (filters: { queryKey: any }) => Promise<void>
}
