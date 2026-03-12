import { GraphQLClient } from 'graphql-request';
import type { TransactionStatus, TransactionTag, GetDataOptions, DownloadFilesParams, DownloadResult, CreateTransactionOptions } from '@/types/arweave';
export declare abstract class BaseArweaveClient {
    static PlatformClass: typeof BaseArweaveClient;
    static setPlatformClass(platformClass: typeof BaseArweaveClient): void;
    /**
     * Get the current Arweave host
     * @returns The Arweave host (e.g., 'arweave.net')
     */
    static getHost(): string;
    /**
     * Set the Arweave host
     * @param host - The new host to use (e.g., 'arweave.net')
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
     * Get the transaction status URL
     * @param transactionId - The Arweave transaction ID
     * @returns The full URL to check transaction status
     */
    static getStatusUrl(transactionId: string): string;
    /**
     * Get the GraphQL client for Arweave queries
     * @returns GraphQL client instance
     */
    static getArweaveClient(): GraphQLClient;
    /**
     * Get the status of a transaction
     * @param transactionId - The Arweave transaction ID
     * @returns Transaction status including confirmation details
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