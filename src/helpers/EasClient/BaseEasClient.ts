import { GraphQLClient } from 'graphql-request'
import { Attestation } from '@/graphql/gql/graphql'

export abstract class BaseEasClient {
  static PlatformClass: typeof BaseEasClient
  private static easClient: GraphQLClient

  static setPlatformClass(platformClass: typeof BaseEasClient) {
    if (!platformClass) {
      throw new Error('Cannot set PlatformClass to undefined or null. Ensure the platform-specific EasClient is properly imported.')
    }
    if (platformClass === BaseEasClient) {
      throw new Error('Cannot set PlatformClass to BaseEasClient itself. Use a platform-specific implementation (e.g., node/EasClient or browser/EasClient).')
    }
    this.PlatformClass = platformClass
  }

  static getEasClient(): GraphQLClient {
    return this.PlatformClass.getEasClient()
  }

  static async getSeedsBySchemaName(schemaName: string): Promise<Attestation[]> {
    return this.PlatformClass.getSeedsBySchemaName(schemaName)
  }
} 
