import { GraphQLClient } from 'graphql-request'
import type {
  TransactionStatus,
  TransactionTag,
  GetDataOptions,
  DownloadFilesParams,
  DownloadResult,
  CreateTransactionOptions,
} from '@/types/arweave'
import { DEFAULT_ARWEAVE_HOST } from '@/helpers/constants'

function parseGateway(input: string): { protocol: 'http' | 'https'; host: string } {
  const t = input.trim()
  if (t.startsWith('http://')) {
    return { protocol: 'http', host: t.slice(7).replace(/\/$/, '') }
  }
  if (t.startsWith('https://')) {
    return { protocol: 'https', host: t.slice(8).replace(/\/$/, '') }
  }
  return { protocol: 'https', host: t.replace(/\/$/, '') }
}

// Internal state
let _host = DEFAULT_ARWEAVE_HOST
let _protocol: 'http' | 'https' = 'https'
let _hostExplicitlySet = false

export abstract class BaseArweaveClient {
  static PlatformClass: typeof BaseArweaveClient

  static setPlatformClass(platformClass: typeof BaseArweaveClient) {
    this.PlatformClass = platformClass
  }

  /**
   * Resolved gateway host (no scheme) and protocol from env override or setHost().
   */
  static resolveGateway(): { protocol: 'http' | 'https'; host: string } {
    if (process.env.NODE_ENV === 'production') {
      const envHost =
        typeof process !== 'undefined' && process.env
          ? process.env.NEXT_PUBLIC_ARWEAVE_HOST || process.env.ARWEAVE_HOST
          : undefined
      if (envHost && !_hostExplicitlySet) {
        return parseGateway(envHost)
      }
    }
    return { protocol: _protocol, host: _host }
  }

  // ============================================
  // Configuration Methods
  // ============================================

  /**
   * Get the current Arweave host (hostname, optionally with port — no URL scheme)
   * @returns The Arweave host (e.g. 'arweave.net' or 'localhost:1984')
   */
  static getHost(): string {
    return this.resolveGateway().host
  }

  /**
   * Get whether requests use http or https
   */
  static getProtocol(): 'http' | 'https' {
    return this.resolveGateway().protocol
  }

  /**
   * Base URL for the configured gateway (e.g. https://arweave.net or http://localhost:1984)
   */
  static getBaseUrl(): string {
    const { protocol, host } = this.resolveGateway()
    return `${protocol}://${host}`
  }

  /**
   * Set the Arweave gateway. Plain host defaults to https; prefix with http:// for local HTTP gateways.
   * @param host - e.g. 'arweave.net', 'https://arweave.net', or 'http://localhost:1984'
   */
  static setHost(host: string): void {
    const parsed = parseGateway(host)
    _host = parsed.host
    _protocol = parsed.protocol
    _hostExplicitlySet = true
  }

  /**
   * Get the GraphQL endpoint URL
   * @returns The full GraphQL endpoint URL
   */
  static getEndpoint(): string {
    return `${this.getBaseUrl()}/graphql`
  }

  /**
   * Get the raw data URL for a transaction
   * @param transactionId - The Arweave transaction ID
   * @returns The full URL to access raw transaction data
   */
  static getRawUrl(transactionId: string): string {
    return `${this.getBaseUrl()}/raw/${transactionId}`
  }

  /**
   * URL used to verify that a transaction is available on the gateway (HTTP 200 = present).
   * @param transactionId - The Arweave transaction ID
   */
  static getStatusUrl(transactionId: string): string {
    return `${this.getBaseUrl()}/${transactionId}`
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
   * Check gateway presence for a transaction (HTTP 200). Does not parse confirmation JSON.
   * @param transactionId - The Arweave transaction ID
   * @returns Transaction status; `confirmed` is null for real gateway responses
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
