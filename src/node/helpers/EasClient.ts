import { BaseEasClient } from "@/helpers/EasClient/BaseEasClient"
import { EAS_ENDPOINT } from "@/services/internal/constants"
import { GraphQLClient } from "graphql-request"

class EasClient extends BaseEasClient {
  static getEasClient() {
    return new GraphQLClient(EAS_ENDPOINT)
  }
}

BaseEasClient.setPlatformClass(EasClient)

export { EasClient }