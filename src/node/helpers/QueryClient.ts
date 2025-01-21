import { BaseQueryClient } from "@/helpers/QueryClient/BaseQueryClient"

class QueryClient extends BaseQueryClient {
  static getQueryClient() {
    return {
      fetchQuery: () => {
        return new Promise((resolve, reject) => {
          reject(new Error('Not implemented'))
        })
      },
      getQueryData: () => {
        return new Promise((resolve, reject) => {
          reject(new Error('Not implemented'))
        })
      },
    }
  }
}

BaseQueryClient.setPlatformClass(QueryClient)

export { QueryClient }
