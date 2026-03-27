import { BaseArweaveClient } from '@/helpers/ArweaveClient/BaseArweaveClient';
import { GraphQLClient } from 'graphql-request';
import Arweave from 'arweave';
import type {
  TransactionStatus,
  TransactionTag,
  GetDataOptions,
  DownloadFilesParams,
  DownloadResult,
  CreateTransactionOptions,
} from '@/types/arweave';
import { GET_TRANSACTION_TAGS } from '@/helpers/ArweaveClient/queries';
import debug from 'debug';

const logger = debug('seedSdk:node:ArweaveClient');

// Cached Arweave instance (keyed by gateway so setHost / protocol changes apply)
let _arweaveInstance: Arweave | null = null;
let _arweaveGatewayKey: string | null = null;

/**
 * Get or create the Arweave instance for Node.js
 */
const getArweaveInstance = (): Arweave => {
  const gatewayKey = `${BaseArweaveClient.getProtocol()}://${BaseArweaveClient.getHost()}`;
  if (_arweaveInstance && _arweaveGatewayKey === gatewayKey) {
    return _arweaveInstance;
  }

  _arweaveGatewayKey = gatewayKey;

  const host = BaseArweaveClient.getHost();
  const protocol = BaseArweaveClient.getProtocol();

  // Handle both ES modules and CommonJS exports from arweave package
  if ('default' in Arweave && typeof (Arweave as any).default?.init === 'function') {
    _arweaveInstance = (Arweave as any).default.init({
      host,
      protocol,
    });
  } else {
    _arweaveInstance = Arweave.init({
      host,
      protocol,
    });
  }

  return _arweaveInstance!;
};

class ArweaveClient extends BaseArweaveClient {
  /**
   * Get the GraphQL client for Arweave queries
   */
  static getArweaveClient(): GraphQLClient {
    return new GraphQLClient(BaseArweaveClient.getEndpoint());
  }

  /**
   * Get the status of a transaction
   */
  static async getTransactionStatus(transactionId: string): Promise<TransactionStatus> {
    const url = BaseArweaveClient.getStatusUrl(transactionId);

    try {
      const response = await fetch(url);

      if (response.status === 404) {
        return {
          status: 404,
          confirmed: null,
        };
      }

      if (!response.ok) {
        return {
          status: response.status,
          confirmed: null,
        };
      }

      if (response.body) {
        await response.body.cancel();
      }

      return {
        status: 200,
        confirmed: null,
      };
    } catch (error) {
      logger('Error fetching transaction status:', error);
      return {
        status: 500,
        confirmed: null,
      };
    }
  }

  /**
   * Get transaction data
   */
  static async getTransactionData(
    transactionId: string,
    options?: GetDataOptions
  ): Promise<Uint8Array | string> {
    const arweave = getArweaveInstance();

    try {
      const data = await arweave.transactions.getData(transactionId, {
        decode: options?.decode ?? true,
        string: options?.string ?? false,
      });

      if (options?.string && typeof data === 'string') {
        return data;
      }

      // Ensure we return Uint8Array
      if (data instanceof Uint8Array) {
        return data;
      }

      // Handle string data when not requesting string
      if (typeof data === 'string') {
        return new TextEncoder().encode(data);
      }

      return data as Uint8Array;
    } catch (error) {
      logger('Error fetching transaction data:', error);
      throw error;
    }
  }

  /**
   * Get transaction tags via GraphQL
   */
  static async getTransactionTags(transactionId: string): Promise<TransactionTag[]> {
    const client = this.getArweaveClient();
    
    try {
      const result = await client.request(GET_TRANSACTION_TAGS, { transactionId });
      
      if (!result.tags?.tags) {
        return [];
      }

      return result.tags.tags.map((tag: { name: string; value: string }) => ({
        name: tag.name,
        value: tag.value,
      }));
    } catch (error) {
      logger('Error fetching transaction tags:', error);
      return [];
    }
  }

  /**
   * Create a new unsigned transaction
   */
  static async createTransaction(
    data: string | Uint8Array,
    options?: CreateTransactionOptions
  ): Promise<any> {
    const arweave = getArweaveInstance();

    const tx = await arweave.createTransaction({
      data,
    });

    // Add tags if provided
    if (options?.tags) {
      for (const tag of options.tags) {
        tx.addTag(tag.name, tag.value);
      }
    }

    return tx;
  }

  /**
   * Download multiple files from Arweave
   */
  static async downloadFiles(params: DownloadFilesParams): Promise<DownloadResult[]> {
    const { transactionIds, excludedTransactions } = params;
    const results: DownloadResult[] = [];
    const baseUrl = BaseArweaveClient.getBaseUrl();

    for (const transactionId of transactionIds) {
      // Skip excluded transactions
      if (excludedTransactions?.has(transactionId)) {
        continue;
      }

      try {
        const url = `${baseUrl}/raw/${transactionId}`;
        const response = await fetch(url);

        if (!response.ok) {
          results.push({
            transactionId,
            success: false,
            error: `HTTP ${response.status}: ${response.statusText}`,
          });
          continue;
        }

        const arrayBuffer = await response.arrayBuffer();
        const data = new Uint8Array(arrayBuffer);

        // Detect content type
        const contentType = response.headers.get('content-type') || undefined;

        results.push({
          transactionId,
          success: true,
          contentType,
          data,
        });
      } catch (error) {
        logger(`Error downloading transaction ${transactionId}:`, error);
        results.push({
          transactionId,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return results;
  }
}

BaseArweaveClient.setPlatformClass(ArweaveClient);

export { ArweaveClient };