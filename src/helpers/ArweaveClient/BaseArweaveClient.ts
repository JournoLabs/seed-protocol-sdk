import { GraphQLClient } from 'graphql-request'

export abstract class BaseArweaveClient {
  static PlatformClass: typeof BaseArweaveClient

  static setPlatformClass(platformClass: typeof BaseArweaveClient) {
    this.PlatformClass = platformClass
  }

  static getArweaveClient(): GraphQLClient {
    return this.PlatformClass.getArweaveClient()
  }
}