import { BaseQueryClient } from '../QueryClient/BaseQueryClient.js'
import type { FetchQueryOptions, IQueryClient } from '../QueryClient/IQueryClient.js'
import type { IQueryClientFactory } from '../QueryClient/IQueryClientFactory.js'

export class NodeQueryClient implements IQueryClientFactory {
  getQueryClient(): IQueryClient {
    return {
      fetchQuery: async <T>({ queryFn }: FetchQueryOptions<T>): Promise<T> => queryFn(),
      getQueryData: () => undefined,
      removeQueries: async () => {},
    }
  }
}

/** @deprecated Prefer NodeQueryClient */
export const QueryClient = NodeQueryClient

BaseQueryClient.configure(new NodeQueryClient())

const _check: IQueryClientFactory = new NodeQueryClient()
void _check
