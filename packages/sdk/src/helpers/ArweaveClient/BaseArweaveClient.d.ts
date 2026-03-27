import { GraphQLClient } from 'graphql-request';
import type { TransactionStatus, TransactionTag, GetDataOptions, DownloadFilesParams, DownloadResult, CreateTransactionOptions } from '@/types/arweave';
export declare abstract class BaseArweaveClient {
    static PlatformClass: typeof BaseArweaveClient;
    static setPlatformClass(platformClass: typeof BaseArweaveClient): void;
    static resolveGateway(): {
        protocol: 'http' | 'https';
        host: string;
    };
    /**
     * Get the current Arweave host (hostname, optionally with port — no URL scheme)
     * @returns The Arweave host (e.g. 'arweave.net' or 'localhost:1984')
     */
    static getHost(): string;
    static getProtocol(): 'http' | 'https';
    static getBaseUrl(): string;
    /**
     * Set the Arweave gateway. Plain host defaults to https; prefix with http:// for local HTTP gateways.
     * @param host - e.g. 'arweave.net', 'https://arweave.net', or 'http://localhost:1984'
     */
    static setHost(host: string): void;
    /**
     * Get the GraphQL endpoint URL
     * @returns The full GraphQL endpoint URL
     */
    static getEndpoint(): string;
    /**
     * Get the raw data URL for a transaction
     * @param transactionId - The Arweave transaction ID
     * @returns The full URL to access raw transaction data
     */
    static getRawUrl(transactionId: string): string;
    /**
     * URL used to verify that a transaction is available on the gateway (HTTP 200 = present).
     * @param transactionId - The Arweave transaction ID
     */
    static getStatusUrl(transactionId: string): string;
    /**
     * Get the GraphQL client for Arweave queries
     * @returns GraphQL client instance
     */
    static getArweaveClient(): GraphQLClient;
    /**
     * Check gateway presence for a transaction (HTTP 200). Does not parse confirmation JSON.
     * @param transactionId - The Arweave transaction ID
     * @returns Transaction status; `confirmed` is null for real gateway responses
     */
    static getTransactionStatus(transactionId: string): Promise<TransactionStatus>;
    /**
     * Get transaction data
     * @param transactionId - The Arweave transaction ID
     * @param options - Options for data retrieval (decode, string)
     * @returns Transaction data as Uint8Array or string
     */
    static getTransactionData(transactionId: string, options?: GetDataOptions): Promise<Uint8Array | string>;
    /**
     * Get transaction tags
     * @param transactionId - The Arweave transaction ID
     * @returns Array of transaction tags
     */
    static getTransactionTags(transactionId: string): Promise<TransactionTag[]>;
    /**
     * Create a new unsigned transaction
     * @param data - Transaction data (string or Uint8Array)
     * @param options - Options including tags
     * @returns The created transaction object
     */
    static createTransaction(data: string | Uint8Array, options?: CreateTransactionOptions): Promise<any>;
    /**
     * Download multiple files from Arweave
     * @param params - Download parameters including transaction IDs
     * @returns Array of download results
     */
    static downloadFiles(params: DownloadFilesParams): Promise<DownloadResult[]>;
}
//# sourceMappingURL=BaseArweaveClient.d.ts.map
