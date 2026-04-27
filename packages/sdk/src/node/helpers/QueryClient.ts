import { BaseQueryClient } from "@/helpers/QueryClient/BaseQueryClient"
import { IQueryClient }    from '@/interfaces/IQueryClient'



class QueryClient extends BaseQueryClient {
  static getQueryClient = (): IQueryClient=> {
    return {
      fetchQuery: async <T>({
        queryKey,
        queryFn,
      }: {
        queryKey: unknown[]
        queryFn: () => Promise<T>
        staleTime?: number
      }): Promise<T> => {
        return await queryFn()
      },
      getQueryData: () => {
        return new Promise((resolve, reject) => {
          reject(new Error('Not implemented'))
        })
      },
      removeQueries: async () => {},
    }
  }
}

BaseQueryClient.setPlatformClass(QueryClient)

export { QueryClient }
