
type FetchQueryOptions = {
  queryKey: any
  queryFn: () => Promise<any>
  networkMode?: 'offlineFirst' | 'onlineOnly'
}

export interface IQueryClient {
  fetchQuery: (options: FetchQueryOptions) => Promise<any>
  getQueryData: (queryKey: any) => any
}
