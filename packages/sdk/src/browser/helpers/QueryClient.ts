import { BaseQueryClient } from "@/helpers/QueryClient/BaseQueryClient";
import { NetworkMode, QueryClient as ReactQueryClient, } from "@tanstack/react-query";
import type { IQueryClient } from "@/interfaces/IQueryClient";
import type { IQueryClientFactory } from "@seedprotocol/eas";

/**
 * Cached results are only reused within a query's staleTime (0 unless the caller sets one), so
 * they don't need to outlive that by much. Nothing persists this cache.
 */
const QUERY_GC_TIME_MS = 1000 * 60 * 5

export class BrowserQueryClient implements IQueryClientFactory {
  // One client per page, so concurrent requests with the same key share one fetch and a caller's
  // staleTime / removeQueries apply to later calls. Every query key must include its variables.
  private queryClient: IQueryClient | undefined

  getQueryClient(): IQueryClient {
    if (this.queryClient) return this.queryClient

    const reactQueryClient = new ReactQueryClient({
      defaultOptions: {
        queries: {
          networkMode: 'offlineFirst' as NetworkMode,
          gcTime: QUERY_GC_TIME_MS,
        },
      },
    })

    const queryClient: IQueryClient = {
      fetchQuery: async (options) => {
        const { queryKey, queryFn, networkMode, staleTime } = options
        return reactQueryClient.query({
          queryKey,
          queryFn,
          networkMode: networkMode as NetworkMode | undefined,
          staleTime,
        } as any) as Promise<any>
      },
      getQueryData: (queryKey: any) => {
        return reactQueryClient.getQueryData(queryKey)
      },
      removeQueries: async (filters) => {
        await reactQueryClient.removeQueries(filters)
      },
    }
    this.queryClient = queryClient
    return queryClient
  }
}

/** @deprecated Prefer BrowserQueryClient */
export const QueryClient = BrowserQueryClient

BaseQueryClient.configure(new BrowserQueryClient())
