import type { IEasClient } from '../EasClient/IEasClient.js'
import { getEasEndpoint } from '../easEndpoint.js'
import type { GraphQLClient } from 'graphql-request'
import { createEasGraphQLClient } from '../EasClient/createEasGraphQLClient.js'

/** Fetch-based EAS GraphQL client; works in Node and browsers. Registering it is up to the caller. */
export class DefaultEasClient implements IEasClient {
  private easClient: { url: string; client: GraphQLClient } | undefined

  /** Reads the endpoint per call so SDK / publish chain config applied after import takes effect. */
  getEasClient(): GraphQLClient {
    const url = getEasEndpoint()
    if (this.easClient?.url !== url) {
      this.easClient = { url, client: createEasGraphQLClient(url) }
    }
    return this.easClient.client
  }
}
