import { getArweave } from '~/helpers/blockchain'
import { getPublishPublicClient } from '~/helpers/chainClient'
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

async function fetchWinstonPerByte(): Promise<number> {
  const winston = BigInt(
    await getArweave().transactions.getPrice(ARWEAVE_PRICE_REF_BYTES),
  )
  return Number(winston) / ARWEAVE_PRICE_REF_BYTES
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
