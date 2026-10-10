import { QueryClient as TanStackQueryClient } from '@tanstack/query-core'
import { getEasEndpoint } from '../easEndpoint.js'
import { BaseQueryClient } from '../QueryClient/BaseQueryClient.js'
import type { FetchQueryOptions, IQueryClient } from '../QueryClient/IQueryClient.js'
import type { IQueryClientFactory } from '../QueryClient/IQueryClientFactory.js'

/**
 * Keys are scoped to the EAS endpoint (the chain), so a process that switches chains never shares
 * a request or a result between them.
 */
const scopeKey = (queryKey: readonly unknown[]): unknown[] => {
  let endpoint = ''
  try {
    endpoint = getEasEndpoint()
  } catch {
    // Misconfigured chain: the request itself will fail.
  }
  return [endpoint, ...queryKey]
}

/**
 * TanStack Query client for Node. Concurrent requests with the same key share one fetch.
 *
 * Results are not kept once a request settles (gcTime 0) unless the caller passes a `staleTime`,
 * in which case they are kept and reused for that long: a server process sees many distinct keys
 * (e.g. change checks keyed by time), and EAS data is otherwise always read fresh. No retries
 * (TanStack's default for imperative queries), no structural sharing (nothing to share with), and
 * no online detection (`networkMode: 'always'`).
 */
export class NodeQueryClient implements IQueryClientFactory {
  private queryClient: IQueryClient | undefined

  getQueryClient(): IQueryClient {
    if (this.queryClient) return this.queryClient

    const client = new TanStackQueryClient({
      defaultOptions: {
        queries: {
          gcTime: 0,
          networkMode: 'always',
          structuralSharing: false,
        },
      },
    })

    this.queryClient = {
      fetchQuery: <T>({ queryKey, queryFn, networkMode, staleTime }: FetchQueryOptions<T>) =>
        client.query({
          queryKey: scopeKey(queryKey),
          queryFn,
          // IQueryClient's 'onlineOnly' is TanStack v5's 'online'.
          ...(networkMode ? { networkMode: networkMode === 'onlineOnly' ? 'online' : networkMode } : {}),
          ...(staleTime ? { staleTime, gcTime: staleTime } : {}),
        }) as Promise<T>,
      getQueryData: (queryKey) => client.getQueryData(scopeKey(queryKey)),
      removeQueries: async ({ queryKey }) => {
        client.removeQueries({ queryKey: scopeKey(queryKey) })
      },
    }
    return this.queryClient
  }
}

/** @deprecated Prefer NodeQueryClient */
export const QueryClient = NodeQueryClient

BaseQueryClient.configure(new NodeQueryClient())

const _check: IQueryClientFactory = new NodeQueryClient()
void _check
