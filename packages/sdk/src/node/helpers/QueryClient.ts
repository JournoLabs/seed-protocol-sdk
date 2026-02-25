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
      }): Promise<T> => {
        return await queryFn()
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
