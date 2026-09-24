import { getPublishConfig } from '~/config'

export type TokenPrices = {
  ethUsd: number
  arUsd: number
  fetchedAt: number
}

const TTL_MS = 60_000

let cache: TokenPrices | null = null
let inflight: Promise<TokenPrices> | null = null

function readConfigGetter(): (() => Promise<{ ethUsd: number; arUsd: number }>) | undefined {
  try {
    return getPublishConfig().getTokenPrices
  } catch {
    return undefined
  }
}

export async function fetchCoinbaseSpot(symbol: 'ETH' | 'AR'): Promise<number> {
  const res = await fetch(`https://api.coinbase.com/v2/prices/${symbol}-USD/spot`)
  if (!res.ok) {
    throw new Error(`Coinbase ${symbol}-USD spot failed: ${res.status}`)
  }
  const body = (await res.json()) as { data?: { amount?: string } }
  const n = Number(body.data?.amount)
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Invalid ${symbol} USD price`)
  }
  return n
}

async function fetchDefaultTokenPrices(): Promise<{ ethUsd: number; arUsd: number }> {
  const [ethUsd, arUsd] = await Promise.all([
    fetchCoinbaseSpot('ETH'),
    fetchCoinbaseSpot('AR'),
  ])
  return { ethUsd, arUsd }
}

/** Process-wide ETH/USD + AR/USD cache (60s). Failed refresh keeps the last good values. */
export async function getCachedTokenPrices(options?: {
  forceRefresh?: boolean
}): Promise<TokenPrices> {
  const now = Date.now()
  if (!options?.forceRefresh && cache && now - cache.fetchedAt < TTL_MS) {
    return cache
  }
  if (inflight && !options?.forceRefresh) {
    return inflight
  }

  inflight = (async () => {
    try {
      const getter = readConfigGetter()
      const prices = getter ? await getter() : await fetchDefaultTokenPrices()
      const next: TokenPrices = {
        ethUsd: prices.ethUsd,
        arUsd: prices.arUsd,
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

export function resetTokenPriceCache(): void {
  cache = null
  inflight = null
}
