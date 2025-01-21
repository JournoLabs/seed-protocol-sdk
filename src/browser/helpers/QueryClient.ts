import { BaseQueryClient } from "@/helpers/QueryClient/BaseQueryClient";
import { ARWEAVE_ENDPOINT } from "@/services/internal/constants";
import { QueryClient as ReactQueryClient, } from "@tanstack/react-query";

class QueryClient extends BaseQueryClient {
  static getQueryClient() {
    // Implement the browser-specific logic here
    return new ReactQueryClient({
      defaultOptions: {
        queries: {
          networkMode: 'offlineFirst',
          gcTime: 1000 * 60 * 60 * 24, // 24 hours
        },
      },
    })
  }
}

BaseQueryClient.setPlatformClass(QueryClient);

export { QueryClient };
