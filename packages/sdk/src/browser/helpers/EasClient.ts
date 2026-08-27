import { BaseEasClient } from '@/helpers/EasClient/BaseEasClient'
import type { IEasClient } from '@seedprotocol/eas'
import { EAS_ENDPOINT } from '@/client/constants'
import { GraphQLClient } from 'graphql-request'

export class BrowserEasClient implements IEasClient {
  private easClient: GraphQLClient | undefined

  getEasClient(): GraphQLClient {
    if (!this.easClient) {
      this.easClient = new GraphQLClient(EAS_ENDPOINT)
    }
    return this.easClient
  }
}

/** @deprecated Prefer BrowserEasClient */
export const EasClient = BrowserEasClient

BaseEasClient.configure(new BrowserEasClient())
