import type { IQueryClient } from './IQueryClient.js'

export abstract class BaseQueryClient {
  static PlatformClass: typeof BaseQueryClient

  static setPlatformClass(platformClass: typeof BaseQueryClient) {
    this.PlatformClass = platformClass
  }

  static getQueryClient(): IQueryClient {
    if (!this.PlatformClass) {
      throw new Error(
        'QueryClient PlatformClass has not been set. Import from @seedprotocol/eas/node to register the Node.js implementation.',
      )
    }
    return this.PlatformClass.getQueryClient()
  }
}
