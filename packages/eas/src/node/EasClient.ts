import { BaseEasClient } from '../EasClient/BaseEasClient.js'
import type { IEasClient } from '../EasClient/IEasClient.js'
import { EAS_ENDPOINT } from '../constants.js'
import { GraphQLClient } from 'graphql-request'

export class NodeEasClient implements IEasClient {
  private easClient: GraphQLClient | undefined

  getEasClient(): GraphQLClient {
    if (!this.easClient) {
      this.easClient = new GraphQLClient(EAS_ENDPOINT)
    }
    return this.easClient
  }
}

/** @deprecated Prefer NodeEasClient */
export const EasClient = NodeEasClient

BaseEasClient.configure(new NodeEasClient())

const _check: IEasClient = new NodeEasClient()
void _check
