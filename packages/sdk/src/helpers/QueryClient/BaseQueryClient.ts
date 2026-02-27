import { IQueryClient } from "@/interfaces/IQueryClient"

export abstract class BaseQueryClient {
  static PlatformClass: typeof BaseQueryClient

  static setPlatformClass(platformClass: typeof BaseQueryClient) {
    this.PlatformClass = platformClass
  }

  static getQueryClient(): IQueryClient {
    if (!this.PlatformClass) {
      throw new Error(
        'QueryClient PlatformClass has not been set. Ensure the platform-specific QueryClient is initialized before use. For Node.js, import from @seedprotocol/sdk/node. For browser, the SDK should auto-initialize via platformClassesInit().'
      )
    }
    return this.PlatformClass.getQueryClient()
  }
} 