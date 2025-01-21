import { BaseArweaveClient } from '@/helpers/ArweaveClient/BaseArweaveClient';
import { ARWEAVE_ENDPOINT } from '@/services/internal/constants';
import { GraphQLClient } from 'graphql-request';

class ArweaveClient extends BaseArweaveClient {
  static getArweaveClient(): GraphQLClient {
    return new GraphQLClient(ARWEAVE_ENDPOINT);
  }
}

BaseArweaveClient.setPlatformClass(ArweaveClient);

export { ArweaveClient }; 