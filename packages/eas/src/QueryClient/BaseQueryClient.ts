import type { IQueryClient } from './IQueryClient.js'
import type { IQueryClientFactory } from './IQueryClientFactory.js'

export abstract class BaseQueryClient {
  private static _impl: IQueryClientFactory | null = null

  static configure(impl: IQueryClientFactory): void {
    if (!impl) {
      throw new Error(
        'Cannot configure QueryClient with undefined or null. Ensure the platform-specific QueryClient is properly created.',
      )
    }
    BaseQueryClient._impl = impl
  }

  private static requireImpl(): IQueryClientFactory {
    if (!BaseQueryClient._impl) {
      throw new Error(
        'QueryClient not configured. Import from @seedprotocol/eas/node to register the Node.js implementation.',
      )
    }
    return BaseQueryClient._impl
  }

  static getQueryClient(): IQueryClient {
    return BaseQueryClient.requireImpl().getQueryClient()
  }
}
