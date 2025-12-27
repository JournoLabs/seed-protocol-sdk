import { BaseEasClient } from '@/helpers/EasClient/BaseEasClient'
import { EAS_ENDPOINT } from '@/services/internal/constants'
import { GraphQLClient } from 'graphql-request'

class EasClient extends BaseEasClient {
  static getEasClient() {
    if (!this.easClient) {
      this.easClient = new GraphQLClient(EAS_ENDPOINT)
    }
    return this.easClient
  }
}

BaseEasClient.setPlatformClass(EasClient)

export { EasClient }
