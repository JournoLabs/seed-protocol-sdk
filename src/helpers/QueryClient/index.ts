import { BaseQueryClient } from './BaseQueryClient'

let QueryClient: typeof BaseQueryClient | undefined

export const initQueryClient = async () => {
  if (typeof window !== 'undefined') {
    QueryClient = (await import('../../browser/helpers/QueryClient')).QueryClient
  } else {
    QueryClient = (await import('../../node/helpers/QueryClient')).QueryClient
  }
}

export { QueryClient }