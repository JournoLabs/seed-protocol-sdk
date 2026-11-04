import { BaseArweaveClient } from '@seedprotocol/sdk'
import { getPublishConfig } from '~/config'
import { getPublishPublicClient } from '~/helpers/chainClient'
import { getTurboPriceWinc } from '~/helpers/turbo'
import { DEFAULT_TURBO_PAYMENT_URL, resolvePublishPayment } from '~/payment'
import { getCachedTokenPrices, resetTokenPriceCache, type TokenPrices } from './tokenPrices'

export type MarketRates = TokenPrices & {
  gasPriceWei: bigint
  winstonPerByte: number
}

const TTL_MS = 60_000
const ARWEAVE_PRICE_REF_BYTES = 1_000_000

let cache: MarketRates | null = null
let inflight: Promise<MarketRates> | null = null

async function fetchGasPriceWei(): Promise<bigint> {
  return getPublishPublicClient().getGasPrice()
}

const L1_PRICE_FALLBACK_GATEWAY = 'https://arweave.net'

/** The Turbo payment service a publish would be charged through: the configured one, else ArDrive's. */
function turboPaymentUrl(): string {
  try {
    return resolvePublishPayment(getPublishConfig()).storage.turbo?.paymentUrl ?? DEFAULT_TURBO_PAYMENT_URL
  } catch {
    return DEFAULT_TURBO_PAYMENT_URL
  }
}

/** The configured gateway, then arweave.net: an upload proxy may not serve `/price`. */
function l1PriceGateways(): string[] {
  let configured: string | undefined
  try {
    const { protocol, host, port } = BaseArweaveClient.getArweaveJsApiConfig()
    configured = `${protocol}://${host}:${port}`
  } catch {
    configured = undefined
  }
  return configured ? [configured, L1_PRICE_FALLBACK_GATEWAY] : [L1_PRICE_FALLBACK_GATEWAY]
}

async function l1Winston(gateway: string, bytes: number): Promise<bigint> {
  const res = await fetch(`${gateway}/price/${bytes}`)
  if (!res.ok) throw new Error(`${gateway}/price failed: HTTP ${res.status}`)
  return BigInt((await res.text()).trim())
}

/**
 * Winston per byte of storage. Turbo's price comes first: uploads go through a bundler, and Turbo
 * prices bundled data items. Arweave's own `/price` is the fallback, on the configured gateway and
 * then arweave.net. Throws only when every source fails.
 */
export async function fetchWinstonPerByte(): Promise<number> {
  const errors: string[] = []
  const sources: Array<() => Promise<bigint>> = [
    () => getTurboPriceWinc({ uploadUrl: '', paymentUrl: turboPaymentUrl() }, ARWEAVE_PRICE_REF_BYTES),
    ...l1PriceGateways().map((gateway) => () => l1Winston(gateway, ARWEAVE_PRICE_REF_BYTES)),
  ]
  for (const source of sources) {
    try {
      const winston = await source()
      if (winston > 0n) return Number(winston) / ARWEAVE_PRICE_REF_BYTES
      errors.push('price was 0')
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err))
    }
  }
  throw new Error(`No Arweave storage price: ${errors.join('; ')}`)
}

/** Token prices + L2 gas + AR winston/byte, shared 60s TTL. */
export async function getCachedMarketRates(options?: {
  forceRefresh?: boolean
}): Promise<MarketRates> {
  const now = Date.now()
  if (!options?.forceRefresh && cache && now - cache.fetchedAt < TTL_MS) {
    return cache
  }
  if (inflight && !options?.forceRefresh) {
    return inflight
  }

  inflight = (async () => {
    try {
      const [prices, gasPriceWei, winstonPerByte] = await Promise.all([
        getCachedTokenPrices({ forceRefresh: options?.forceRefresh }),
        fetchGasPriceWei(),
        fetchWinstonPerByte(),
      ])
      const next: MarketRates = {
        ...prices,
        gasPriceWei,
        winstonPerByte,
        fetchedAt: Date.now(),
      }
      cache = next
      return next
    } catch (err) {
      if (cache) return cache
      throw err
    } finally {
      inflight = null
    }
  })()

  return inflight
}

export function resetMarketRateCache(): void {
  cache = null
  inflight = null
  resetTokenPriceCache()
}

export { ARWEAVE_PRICE_REF_BYTES }
