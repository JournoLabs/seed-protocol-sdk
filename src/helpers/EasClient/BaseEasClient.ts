import { GraphQLClient } from 'graphql-request'

export abstract class BaseEasClient {
  static PlatformClass: typeof BaseEasClient

  static setPlatformClass(platformClass: typeof BaseEasClient) {
    this.PlatformClass = platformClass
  }

  static getEasClient(): GraphQLClient {
    return this.PlatformClass.getEasClient()
  }
} 