import { isBrowser } from '../environment'
import { BaseQueryClient } from './BaseQueryClient'

let QueryClient: typeof BaseQueryClient | undefined

export const initQueryClient = async () => {
  if (isBrowser()) {
    QueryClient = (await import('../../browser/helpers/QueryClient')).QueryClient
  }

  if (!isBrowser()) {
    QueryClient = (await import('../../node/helpers/QueryClient')).QueryClient
  }
}

export { QueryClient }