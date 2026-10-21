import { BaseArweaveClient } from '../ArweaveClient/BaseArweaveClient.js'
import type { IArweaveClient } from '../ArweaveClient/IArweaveClient.js'
import { GraphQLClient } from 'graphql-request'
import type Arweave from 'arweave'
import type {
  TransactionStatus,
  TransactionTag,
  GetDataOptions,
  DownloadFilesParams,
  DownloadResult,
  CreateTransactionOptions,
} from '../types/arweave.js'
import { GET_TRANSACTION_TAGS } from '../ArweaveClient/queries.js'
import { fetchTransactionStatusAcrossGateways } from '../gateway/transactionStatus.js'
import { getPreferredArweaveReadBaseUrls } from '../gateway/gatewayState.js'
import { fetchArweaveRawFromBaseUrl } from '../gateway/readBaseUrls.js'
import debug from 'debug'

const logger = debug('seedArweave:ArweaveClient')

// Cached Arweave instance (keyed by gateway so setHost / protocol changes apply)
let _arweaveInstance: Arweave | null = null
let _arweaveGatewayKey: string | null = null

/**
 * arweave-js instance for the configured gateway. Loaded on first use, so importing this package
 * does not load arweave-js; only the data fallback and createTransaction need it.
 */
const getArweaveInstance = async (): Promise<Arweave> => {
  const gatewayKey = `${BaseArweaveClient.getProtocol()}://${BaseArweaveClient.getHost()}`
  if (_arweaveInstance && _arweaveGatewayKey === gatewayKey) {
    return _arweaveInstance
  }

  const mod = (await import('arweave')) as unknown as { default?: unknown }
  // ESM and CJS builds of arweave-js nest the class differently.
  let ArweaveClass = (mod.default ?? mod) as { init?: unknown; default?: { init?: unknown } }
  if (typeof ArweaveClass.init !== 'function' && typeof ArweaveClass.default?.init === 'function') {
    ArweaveClass = ArweaveClass.default
  }

  _arweaveGatewayKey = gatewayKey
  _arweaveInstance = (ArweaveClass as typeof Arweave).init(BaseArweaveClient.getArweaveJsApiConfig())
  return _arweaveInstance
}

/**
 * Fetch-based Arweave client; works in Node and browsers. Registering it is up to the caller.
 * Data reads try the preferred read gateways first (usually the one the item was uploaded through),
 * which serve data items before they reach L1.
 */
export class DefaultArweaveClient implements IArweaveClient {
  getArweaveClient(): GraphQLClient {
    return new GraphQLClient(BaseArweaveClient.getEndpoint())
  }

  async getTransactionStatus(transactionId: string): Promise<TransactionStatus> {
    return fetchTransactionStatusAcrossGateways(transactionId)
  }

  async getTransactionData(
    transactionId: string,
    options?: GetDataOptions,
  ): Promise<Uint8Array | string> {
    // `/raw` is already decoded, so skip the preferred gateways when the caller asked for undecoded data.
    const preferred = options?.decode === false ? [] : getPreferredArweaveReadBaseUrls()
    for (const base of preferred) {
      const response = await fetchArweaveRawFromBaseUrl(base, transactionId)
      if (!response) continue
      try {
        if (options?.string) {
          return await response.text()
        }
        return new Uint8Array(await response.arrayBuffer())
      } catch (error) {
        logger('Error reading preferred gateway response:', error)
      }
    }

    // Path-prefixed proxies (app-server Hyper proxy) are not supported by arweave.init host;
    // fetch via getRawUrl so /api/seed-gateway/... works.
    if (BaseArweaveClient.getGatewayPath()) {
      const response = await fetch(BaseArweaveClient.getRawUrl(transactionId))
      if (!response.ok) {
        throw new Error(`Failed to fetch transaction data: HTTP ${response.status}`)
      }
      if (options?.string) {
        return response.text()
      }
      return new Uint8Array(await response.arrayBuffer())
    }

    const arweave = await getArweaveInstance()

    try {
      const data = await arweave.transactions.getData(transactionId, {
        decode: options?.decode ?? true,
        string: options?.string ?? false,
      })

      if (options?.string && typeof data === 'string') {
        return data
      }

      if (data instanceof Uint8Array) {
        return data
      }

      // Handle string data when not requesting string
      if (typeof data === 'string') {
        return new TextEncoder().encode(data)
      }

      return data as Uint8Array
    } catch (error) {
      logger('Error fetching transaction data:', error)
      throw error
    }
  }

  async getTransactionTags(transactionId: string): Promise<TransactionTag[]> {
    const client = this.getArweaveClient()

    try {
      const result = await client.request(GET_TRANSACTION_TAGS, { transactionId })

      if (!result.tags?.tags) {
        return []
      }

      return result.tags.tags.map((tag: { name: string; value: string }) => ({
        name: tag.name,
        value: tag.value,
      }))
    } catch (error) {
      logger('Error fetching transaction tags:', error)
      return []
    }
  }

  async createTransaction(
    data: string | Uint8Array,
    options?: CreateTransactionOptions,
  ): Promise<any> {
    const arweave = await getArweaveInstance()

    const tx = await arweave.createTransaction({
      data,
    })

    if (options?.tags) {
      for (const tag of options.tags) {
        tx.addTag(tag.name, tag.value)
      }
    }

    return tx
  }

  async downloadFiles(params: DownloadFilesParams): Promise<DownloadResult[]> {
    const { transactionIds, excludedTransactions } = params
    const results: DownloadResult[] = []
    const baseUrl = BaseArweaveClient.getBaseUrl()

    for (const transactionId of transactionIds) {
      if (excludedTransactions?.has(transactionId)) {
        continue
      }

      try {
        const url = `${baseUrl}/raw/${transactionId}`
        const response = await fetch(url)

        if (!response.ok) {
          results.push({
            transactionId,
            success: false,
            error: `HTTP ${response.status}: ${response.statusText}`,
          })
          continue
        }

        const data = new Uint8Array(await response.arrayBuffer())
        const contentType = response.headers.get('content-type') || undefined

        results.push({
          transactionId,
          success: true,
          contentType,
          data,
        })
      } catch (error) {
        logger(`Error downloading transaction ${transactionId}:`, error)
        results.push({
          transactionId,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    return results
  }
}
