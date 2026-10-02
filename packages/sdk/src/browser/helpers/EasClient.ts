import { BaseEasClient } from '@/helpers/EasClient/BaseEasClient'
import { getEasEndpoint, type IEasClient } from '@seedprotocol/eas'
import { GraphQLClient } from 'graphql-request'

export class BrowserEasClient implements IEasClient {
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

/** @deprecated Prefer BrowserEasClient */
export const EasClient = BrowserEasClient

BaseEasClient.configure(new BrowserEasClient())
