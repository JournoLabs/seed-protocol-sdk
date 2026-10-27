import type { IItem } from '@seedprotocol/sdk'
import type { TransactionTag } from '@seedprotocol/sdk'
import { getPublishConfig } from '~/config'
import { signedDataItemByteLength } from '~/helpers/arweave'
import { getTurboFreeUploadLimitBytes } from '~/helpers/turbo'
import { getPublishViemChain } from '~/helpers/chainConfig'
import { resolvePublishPayment } from '~/payment'
import { heuristicPublishGas } from './gasHeuristics'
import { getCachedMarketRates, type MarketRates } from './marketRates'
import type { EstimatePublishCostOptions, PublishCostEstimate, PublishWorkSummary } from './types'

const WINSTON_PER_AR = 1e12
const WEI_PER_ETH = 1e18
/** Arweave charges every transaction for at least this much data; a bundle is one transaction. */
export const ARWEAVE_MIN_CHARGED_BYTES = 256 * 1024
/**
 * Turbo's free data item size when its `/v1/info` doesn't answer (102,400 bytes; Turbo reported
 * 107,520 on 2026-10-17).
 */
export const TURBO_FREE_BYTES = 100 * 1024
const TURBO_FREE_BYTES_CACHE_MS = 10 * 60_000

type PublishCostFlags = {
  evmUserPays?: boolean
  arweaveUserPays?: boolean
  /** Ignored: uploads are always bundled. Accepted so a previous estimate's `arweave.path` can be passed back. */
  arweavePath?: 'bundler'
  /** Where uploads go; with 'turbo' small uploads are free. */
  uploadTo?: 'upload-api' | 'turbo'
  /** Largest data item Turbo stores for free (default {@link TURBO_FREE_BYTES}). */
  freeBytes?: number
  /** Tags every upload carries beyond Content-SHA-256 and Content-Type (`arweaveUploadTags`). */
  uploadTags?: TransactionTag[]
  /** The publish chain is a testnet. */
  testnet?: boolean
}

/** Who pays, from the same resolution the publish flow uses ({@link resolvePublishPayment}). */
function readPublishFlags(): PublishCostFlags & {
  turbo?: { uploadUrl: string; paymentUrl: string }
} {
  let testnet = false
  try {
    testnet = getPublishViemChain().testnet === true
  } catch {
    testnet = false
  }
  try {
    const config = getPublishConfig()
    const payment = resolvePublishPayment(config)
    return {
      evmUserPays: payment.gas.payer === 'user',
      arweaveUserPays: payment.storage.payer === 'user',
      uploadTo: payment.storage.uploadTo,
      turbo: payment.storage.turbo,
      uploadTags: config.arweaveUploadTags,
      testnet,
    }
  } catch {
    return { evmUserPays: true, arweaveUserPays: false, uploadTo: 'upload-api', testnet }
  }
}

const turboFreeBytesCache = new Map<string, { bytes: number; at: number }>()

/** Turbo's free data item size, read from its `/v1/info` at most every 10 minutes per endpoint. */
async function turboFreeBytes(turbo: { uploadUrl: string; paymentUrl: string }): Promise<number> {
  const cached = turboFreeBytesCache.get(turbo.uploadUrl)
  if (cached && Date.now() - cached.at < TURBO_FREE_BYTES_CACHE_MS) return cached.bytes
  const live = await getTurboFreeUploadLimitBytes(turbo)
  // 0: Turbo didn't answer or didn't say. Don't cache the fallback, so the next estimate asks again.
  if (live <= 0) return TURBO_FREE_BYTES
  turboFreeBytesCache.set(turbo.uploadUrl, { bytes: live, at: Date.now() })
  return live
}

/** Clears the cached Turbo free size (tests). */
export function resetTurboFreeBytesCache(): void {
  turboFreeBytesCache.clear()
}

/**
 * Tags an upload's data item carries, for its size: Content-SHA-256 (64 hex characters), a
 * Content-Type as long as `application/octet-stream` (a composite upload's), then the configured ones.
 */
function sizingTags(uploadTags: TransactionTag[] | undefined): TransactionTag[] {
  return [
    { name: 'Content-SHA-256', value: '0'.repeat(64) },
    { name: 'Content-Type', value: 'application/octet-stream' },
    ...(uploadTags ?? []),
  ]
}

/** The bytes Arweave (or Turbo) charges for, given where the uploads go, on the signed data items. */
export function chargedUploadBytes(
  work: Pick<PublishWorkSummary, 'uploadCount' | 'uploadBytes' | 'uploadSizes'>,
  uploadTo: 'upload-api' | 'turbo' = 'upload-api',
  options?: { freeBytes?: number; uploadTags?: TransactionTag[] },
): number {
  const sizes =
    work.uploadSizes ??
    (work.uploadCount > 0 ? Array.from({ length: work.uploadCount }, () => work.uploadBytes / work.uploadCount) : [])
  if (sizes.length === 0) return 0
  const tags = sizingTags(options?.uploadTags)
  const signed = sizes.map((size) => signedDataItemByteLength(size, tags))
  if (uploadTo === 'turbo') {
    const freeBytes = options?.freeBytes ?? TURBO_FREE_BYTES
    return signed.filter((size) => size > freeBytes).reduce((a, b) => a + b, 0)
  }
  return Math.max(signed.reduce((a, b) => a + b, 0), ARWEAVE_MIN_CHARGED_BYTES)
}

function roundUsd(n: number): number {
  return Math.round(n * 100) / 100
}

export function combinePublishCostEstimate(
  work: PublishWorkSummary,
  rates: MarketRates,
  flags?: PublishCostFlags,
): PublishCostEstimate {
  const uploadTo = flags?.uploadTo ?? 'upload-api'
  const freeBytes = uploadTo === 'turbo' ? (flags?.freeBytes ?? TURBO_FREE_BYTES) : 0
  return priceEstimate(
    work,
    heuristicPublishGas(work),
    chargedUploadBytes(work, uploadTo, { freeBytes, uploadTags: flags?.uploadTags }),
    rates,
    {
      evmUserPays: flags?.evmUserPays ?? true,
      arweaveUserPays: flags?.arweaveUserPays ?? false,
      testnet: flags?.testnet ?? false,
      uploadTo,
      freeBytes,
    },
  )
}

/**
 * `estimate` at new market rates: the same gas, charged bytes and payers, without re-summarizing
 * the item or reading the config again.
 */
export function repricePublishCostEstimate(
  estimate: PublishCostEstimate,
  rates: MarketRates,
): PublishCostEstimate {
  return priceEstimate(estimate.work, estimate.evm.gas, estimate.arweave.chargedBytes, rates, {
    evmUserPays: estimate.evm.userPays,
    arweaveUserPays: estimate.arweave.userPays,
    testnet: estimate.evm.testnet,
    uploadTo: estimate.arweave.uploadTo,
    freeBytes: estimate.arweave.freeBytes,
  })
}

function priceEstimate(
  work: PublishWorkSummary,
  gas: bigint,
  chargedBytes: number,
  rates: MarketRates,
  flags: {
    evmUserPays: boolean
    arweaveUserPays: boolean
    testnet: boolean
    uploadTo: 'upload-api' | 'turbo'
    freeBytes: number
  },
): PublishCostEstimate {
  const { evmUserPays, arweaveUserPays, testnet } = flags
  const evmWei = gas * rates.gasPriceWei
  const evmEth = Number(evmWei) / WEI_PER_ETH
  // Testnet ETH is worth nothing; mainnet's ETH-USD price doesn't apply to it.
  const evmUsd = testnet ? 0 : evmEth * rates.ethUsd

  const winston = Math.max(0, Math.round(chargedBytes * rates.winstonPerByte))
  const ar = winston / WINSTON_PER_AR
  const arUsd = ar * rates.arUsd

  return {
    totalUsd: roundUsd(evmUsd + arUsd),
    evm: {
      eth: evmEth.toPrecision(6),
      usd: roundUsd(evmUsd),
      gas,
      userPays: evmUserPays,
      testnet,
    },
    arweave: {
      ar: ar.toPrecision(6),
      usd: roundUsd(arUsd),
      bytes: work.uploadBytes,
      chargedBytes,
      uploadCount: work.uploadCount,
      uploadTo: flags.uploadTo,
      freeBytes: flags.freeBytes,
      path: 'bundler',
      userPays: arweaveUserPays,
    },
    prices: {
      ethUsd: rates.ethUsd,
      arUsd: rates.arUsd,
      fetchedAt: rates.fetchedAt,
    },
    work,
    estimatedAt: Date.now(),
  }
}

export async function estimatePublishCost(
  item: IItem<any>,
  options?: EstimatePublishCostOptions,
): Promise<PublishCostEstimate> {
  const { turbo, ...flags } = readPublishFlags()
  if (flags.uploadTo === 'turbo' && turbo) flags.freeBytes = await turboFreeBytes(turbo)
  let work = options?.work
  if (!work) {
    const { summarizePublishWork } = await import('@seedprotocol/sdk')
    work = await summarizePublishWork(item, { publishMode: options?.publishMode })
  }
  const rates = options?.rates ?? (await getCachedMarketRates())
  return combinePublishCostEstimate(work, rates, flags)
}
