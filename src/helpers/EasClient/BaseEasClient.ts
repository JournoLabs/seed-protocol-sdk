import { GraphQLClient } from 'graphql-request'
import { EAS_ENDPOINT }  from '@/services/internal/constants'

export abstract class BaseEasClient {
  static PlatformClass: typeof BaseEasClient

  static setPlatformClass(platformClass: typeof BaseEasClient) {
    this.PlatformClass = platformClass
  }

  static getEasClient(): GraphQLClient {
    return new GraphQLClient(EAS_ENDPOINT)
  }
} 
