import { BaseQueryClient } from '../QueryClient/BaseQueryClient.js'
import type { FetchQueryOptions, IQueryClient } from '../QueryClient/IQueryClient.js'

class QueryClient extends BaseQueryClient {
  static override getQueryClient = (): IQueryClient => ({
    fetchQuery: async <T>({ queryFn }: FetchQueryOptions<T>): Promise<T> => queryFn(),
    getQueryData: () => undefined,
    removeQueries: async () => {},
  })
}

BaseQueryClient.setPlatformClass(QueryClient)

export { QueryClient }
