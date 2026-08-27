import { BaseQueryClient } from "@/helpers/QueryClient/BaseQueryClient";
import { NetworkMode, QueryClient as ReactQueryClient, } from "@tanstack/react-query";
import type { IQueryClient } from "@/interfaces/IQueryClient";
import type { IQueryClientFactory } from "@seedprotocol/eas";

export class BrowserQueryClient implements IQueryClientFactory {
  getQueryClient(): IQueryClient {
    const reactQueryClient = new ReactQueryClient({
      defaultOptions: {
        queries: {
          networkMode: 'offlineFirst' as NetworkMode,
          gcTime: 1000 * 60 * 60 * 24, // 24 hours
        },
      },
    })

    const queryClient: IQueryClient = {
      fetchQuery: async (options) => {
        const { queryKey, queryFn, networkMode, staleTime } = options
        return reactQueryClient.fetchQuery({
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
    return queryClient
  }
}

/** @deprecated Prefer BrowserQueryClient */
export const QueryClient = BrowserQueryClient

BaseQueryClient.configure(new BrowserQueryClient())
