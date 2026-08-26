import { BaseEasClient } from '../EasClient/BaseEasClient.js'
import { EAS_ENDPOINT } from '../constants.js'
import { GraphQLClient } from 'graphql-request'

class EasClient extends BaseEasClient {
  static override getEasClient() {
    if (!this.easClient) {
      this.easClient = new GraphQLClient(EAS_ENDPOINT)
    }
    return this.easClient
  }
}

BaseEasClient.setPlatformClass(EasClient)

export { EasClient }
