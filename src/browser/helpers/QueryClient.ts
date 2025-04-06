import { BaseQueryClient } from "@/helpers/QueryClient/BaseQueryClient";
import { ARWEAVE_ENDPOINT } from "@/services/internal/constants";
import { NetworkMode, QueryClient as ReactQueryClient, } from "@tanstack/react-query";

class QueryClient extends BaseQueryClient {
  static getQueryClient() {
    // Implement the browser-specific logic here
    return new ReactQueryClient({
      defaultOptions: {
        queries: {
          networkMode: 'offlineFirst' as NetworkMode,
          gcTime: 1000 * 60 * 60 * 24, // 24 hours
        },
      },
    })
  }
}

export { QueryClient };
