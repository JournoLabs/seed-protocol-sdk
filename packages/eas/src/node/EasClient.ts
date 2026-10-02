import { BaseEasClient } from '../EasClient/BaseEasClient.js'
import type { IEasClient } from '../EasClient/IEasClient.js'
import { getEasEndpoint } from '../easEndpoint.js'
import { GraphQLClient } from 'graphql-request'

export class NodeEasClient implements IEasClient {
  private easClient: { url: string; client: GraphQLClient } | undefined

  /** Reads the endpoint per call so SDK / publish chain config applied after import takes effect. */
  getEasClient(): GraphQLClient {
    const url = getEasEndpoint()
    if (this.easClient?.url !== url) {
      this.easClient = { url, client: new GraphQLClient(url) }
    }
    return this.easClient.client
  }
}

/** @deprecated Prefer NodeEasClient */
export const EasClient = NodeEasClient

BaseEasClient.configure(new NodeEasClient())

const _check: IEasClient = new NodeEasClient()
void _check
