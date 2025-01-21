import { BaseEasClient } from '../../helpers/EasClient/BaseEasClient'
import { GraphQLClient } from 'graphql-request'
import { EAS_ENDPOINT } from '@/services/internal/constants'

class EasClient extends BaseEasClient {
  static getEasClient(): GraphQLClient {
    return new GraphQLClient(EAS_ENDPOINT)
  }
}

BaseEasClient.setPlatformClass(EasClient)

export { EasClient }