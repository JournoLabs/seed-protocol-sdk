import type { Attestation } from '../graphql/gql/graphql.js'
import type { GraphQLClient } from 'graphql-request'
import type { IEasClient } from './IEasClient.js'

export abstract class BaseEasClient {
  private static _impl: IEasClient | null = null

  static configure(impl: IEasClient): void {
    if (!impl) {
      throw new Error(
        'Cannot configure EasClient with undefined or null. Ensure the platform-specific EasClient is properly created.',
      )
    }
    BaseEasClient._impl = impl
  }

  private static requireImpl(): IEasClient {
    if (!BaseEasClient._impl) {
      throw new Error(
        'EasClient not configured. Import from @seedprotocol/eas/node to register the Node.js implementation, or ensure SDK platform init has run.',
      )
    }
    return BaseEasClient._impl
  }

  static getEasClient(): GraphQLClient {
    return BaseEasClient.requireImpl().getEasClient()
  }

  /**
   * @deprecated Prefer getSeedsBySchemaName from @seedprotocol/eas api helpers.
   * Kept for API compatibility; not implemented by platform clients.
   */
  static async getSeedsBySchemaName(_schemaName: string): Promise<Attestation[]> {
    throw new Error(
      'BaseEasClient.getSeedsBySchemaName is not implemented. Use getSeedsBySchemaName from @seedprotocol/eas instead.',
    )
  }
}

export { BaseEasClient as EasClient }
