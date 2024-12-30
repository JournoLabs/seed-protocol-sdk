import { BaseArweaveClient } from '@/helpers/BaseArweaveClient';
import { ARWEAVE_ENDPOINT } from '@/services/internal/constants';
import { GraphQLClient } from 'graphql-request';

class ArweaveClientNode extends BaseArweaveClient {
  static getArweaveClient(): GraphQLClient {
    return new GraphQLClient(ARWEAVE_ENDPOINT);
  }
}

BaseArweaveClient.setPlatformClass(ArweaveClientNode);

export { ArweaveClientNode }; 