import type { IEasClient } from '../EasClient/IEasClient.js'
import { getEasEndpoint } from '../easEndpoint.js'
import type { GraphQLClient } from 'graphql-request'
import { createEasGraphQLClient, EAS_REQUEST_TIMEOUT_MS } from '../EasClient/createEasGraphQLClient.js'

/** Fetch-based EAS GraphQL client; works in Node and browsers. Registering it is up to the caller. */
export class DefaultEasClient implements IEasClient {
  private easClient: { url: string; client: GraphQLClient } | undefined

  /** The `fetch` dispatcher for this client's requests; undefined uses fetch's default. */
  protected getDispatcher(): unknown {
    return undefined
  }

  /** Reads the endpoint per call so SDK / publish chain config applied after import takes effect. */
  getEasClient(): GraphQLClient {
    const url = getEasEndpoint()
    if (this.easClient?.url !== url) {
      this.easClient = { url, client: createEasGraphQLClient(url, EAS_REQUEST_TIMEOUT_MS, { dispatcher: this.getDispatcher() }) }
    }
    return this.easClient.client
  }
}
