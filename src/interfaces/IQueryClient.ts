export interface IQueryClient {
  fetchQuery: (options: any) => Promise<any>
  getQueryData: (queryKey: any) => any
}
