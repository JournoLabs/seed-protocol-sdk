import { BaseQueryClient } from "@/helpers/QueryClient/BaseQueryClient";
import { ARWEAVE_ENDPOINT } from "@/client/constants";
import { NetworkMode, QueryClient as ReactQueryClient, } from "@tanstack/react-query";
import { IQueryClient } from "@/interfaces/IQueryClient";

class QueryClient extends BaseQueryClient {
  static getQueryClient(): IQueryClient {
    // Implement the browser-specific logic here
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

export { QueryClient };
