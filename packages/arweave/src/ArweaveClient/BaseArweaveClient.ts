import { GraphQLClient } from 'graphql-request'
import type {
  TransactionStatus,
  TransactionTag,
  GetDataOptions,
  DownloadFilesParams,
  DownloadResult,
  CreateTransactionOptions,
} from '../types/arweave.js'
import { DEFAULT_ARWEAVE_HOST, resolveArweaveHostFromEnv } from '../constants.js'
import type { IArweaveClient } from './IArweaveClient.js'

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

// Internal gateway state (process-wide; stays on the facade)
let _host = DEFAULT_ARWEAVE_HOST
let _protocol: 'http' | 'https' = 'https'
let _hostExplicitlySet = false
/** When true, env gateway host does not override `_host` (after a successful read-gateway probe). */
let _suppressEnvGatewayOverride = false

export abstract class BaseArweaveClient {
  private static _impl: IArweaveClient | null = null

  static configure(impl: IArweaveClient): void {
    if (!impl) {
      throw new Error(
        'Cannot configure ArweaveClient with undefined or null. Ensure the platform-specific ArweaveClient is properly created.',
      )
    }
    BaseArweaveClient._impl = impl
  }

  private static requireImpl(): IArweaveClient {
    if (!BaseArweaveClient._impl) {
      throw new Error(
        'ArweaveClient not configured. Import from @seedprotocol/arweave/node to register the Node.js implementation, or ensure SDK platform init has run.',
      )
    }
    return BaseArweaveClient._impl
  }

  /**
   * Resolved gateway host (no scheme) and protocol from env override or setHost().
   */
  static resolveGateway(): { protocol: 'http' | 'https'; host: string } {
    const envHost = resolveArweaveHostFromEnv()
    if (envHost && !_hostExplicitlySet && !_suppressEnvGatewayOverride) {
      return parseGateway(envHost)
    }
    return { protocol: _protocol, host: _host }
  }

  // ============================================
  // Configuration Methods (facade / process-wide)
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
    _suppressEnvGatewayOverride = false
  }

  /**
   * When true, read-path gateway probing does not change the host ({@link setHost}).
   */
  static isReadGatewayLocked(): boolean {
    return _hostExplicitlySet
  }

  /**
   * @internal Clears env override suppression after probing (for test isolation).
   */
  static resetReadGatewaySelectionStateForTests(): void {
    _suppressEnvGatewayOverride = false
  }

  /**
   * Sets the preferred read gateway without locking. Env host still takes precedence until a probe applies a host.
   * Used for seed `arweaveDomain`.
   */
  static setPreferredReadGateway(host: string): void {
    const parsed = parseGateway(host)
    _host = parsed.host
    _protocol = parsed.protocol
    _hostExplicitlySet = false
  }

  /**
   * Applies a gateway chosen by read-path health probing so {@link getHost} uses it instead of env override.
   */
  static applyProbedReadGateway(host: string): void {
    const parsed = parseGateway(host)
    _host = parsed.host
    _protocol = parsed.protocol
    _hostExplicitlySet = false
    _suppressEnvGatewayOverride = true
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
  // Delegated to platform instance
  // ============================================

  static getArweaveClient(): GraphQLClient {
    return BaseArweaveClient.requireImpl().getArweaveClient()
  }

  static getTransactionStatus(transactionId: string): Promise<TransactionStatus> {
    return BaseArweaveClient.requireImpl().getTransactionStatus(transactionId)
  }

  static getTransactionData(
    transactionId: string,
    options?: GetDataOptions
  ): Promise<Uint8Array | string> {
    return BaseArweaveClient.requireImpl().getTransactionData(transactionId, options)
  }

  static getTransactionTags(transactionId: string): Promise<TransactionTag[]> {
    return BaseArweaveClient.requireImpl().getTransactionTags(transactionId)
  }

  static createTransaction(
    data: string | Uint8Array,
    options?: CreateTransactionOptions
  ): Promise<any> {
    return BaseArweaveClient.requireImpl().createTransaction(data, options)
  }

  static downloadFiles(params: DownloadFilesParams): Promise<DownloadResult[]> {
    return BaseArweaveClient.requireImpl().downloadFiles(params)
  }
}
