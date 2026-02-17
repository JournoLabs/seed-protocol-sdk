import { GraphQLClient } from 'graphql-request'
import type {
  TransactionStatus,
  TransactionTag,
  GetDataOptions,
  DownloadFilesParams,
  DownloadResult,
  CreateTransactionOptions,
} from '@/types/arweave'

// Default configuration
const DEFAULT_HOST = 'arweave.net'

// Internal state
let _host = DEFAULT_HOST
let _hostExplicitlySet = false

export abstract class BaseArweaveClient {
  static PlatformClass: typeof BaseArweaveClient

  static setPlatformClass(platformClass: typeof BaseArweaveClient) {
    this.PlatformClass = platformClass
  }

  // ============================================
  // Configuration Methods
  // ============================================

  /**
   * Get the current Arweave host
   * @returns The Arweave host (e.g., 'arweave.net')
   */
  static getHost(): string {
    // Check for environment variable override in production
    if (process.env.NODE_ENV === 'production') {
      const envHost = typeof process !== 'undefined' && process.env
        ? process.env.NEXT_PUBLIC_ARWEAVE_HOST || process.env.ARWEAVE_HOST
        : undefined
      if (envHost && !_hostExplicitlySet) {
        return envHost
      }
    }
    return _host
  }

  /**
   * Set the Arweave host
   * @param host - The new host to use (e.g., 'arweave.net')
   */
  static setHost(host: string): void {
    _host = host
    _hostExplicitlySet = true
  }

  /**
   * Get the GraphQL endpoint URL
   * @returns The full GraphQL endpoint URL
   */
  static getEndpoint(): string {
    return `https://${this.getHost()}/graphql`
  }

  /**
   * Get the raw data URL for a transaction
   * @param transactionId - The Arweave transaction ID
   * @returns The full URL to access raw transaction data
   */
  static getRawUrl(transactionId: string): string {
    return `https://${this.getHost()}/raw/${transactionId}`
  }

  /**
   * Get the transaction status URL
   * @param transactionId - The Arweave transaction ID
   * @returns The full URL to check transaction status
   */
  static getStatusUrl(transactionId: string): string {
    return `https://${this.getHost()}/tx/${transactionId}/status`
  }

  // ============================================
  // GraphQL Client
  // ============================================

  /**
   * Get the GraphQL client for Arweave queries
   * @returns GraphQL client instance
   */
  static getArweaveClient(): GraphQLClient {
    return this.PlatformClass.getArweaveClient()
  }

  // ============================================
  // Transaction Operations (delegated to platform)
  // ============================================

  /**
   * Get the status of a transaction
   * @param transactionId - The Arweave transaction ID
   * @returns Transaction status including confirmation details
   */
  static getTransactionStatus(transactionId: string): Promise<TransactionStatus> {
    return this.PlatformClass.getTransactionStatus(transactionId)
  }

  /**
   * Get transaction data
   * @param transactionId - The Arweave transaction ID
   * @param options - Options for data retrieval (decode, string)
   * @returns Transaction data as Uint8Array or string
   */
  static getTransactionData(
    transactionId: string,
    options?: GetDataOptions
  ): Promise<Uint8Array | string> {
    return this.PlatformClass.getTransactionData(transactionId, options)
  }

  /**
   * Get transaction tags
   * @param transactionId - The Arweave transaction ID
   * @returns Array of transaction tags
   */
  static getTransactionTags(transactionId: string): Promise<TransactionTag[]> {
    return this.PlatformClass.getTransactionTags(transactionId)
  }

  /**
   * Create a new unsigned transaction
   * @param data - Transaction data (string or Uint8Array)
   * @param options - Options including tags
   * @returns The created transaction object
   */
  static createTransaction(
    data: string | Uint8Array,
    options?: CreateTransactionOptions
  ): Promise<any> {
    return this.PlatformClass.createTransaction(data, options)
  }

  // ============================================
  // Bulk Operations
  // ============================================

  /**
   * Download multiple files from Arweave
   * @param params - Download parameters including transaction IDs
   * @returns Array of download results
   */
  static downloadFiles(params: DownloadFilesParams): Promise<DownloadResult[]> {
    return this.PlatformClass.downloadFiles(params)
  }
}