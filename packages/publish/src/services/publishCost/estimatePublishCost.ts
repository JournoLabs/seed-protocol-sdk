import type { IItem } from '@seedprotocol/sdk'
import { getPublishConfig } from '~/config'
import { getPublishViemChain } from '~/helpers/chainConfig'
import { resolvePublishPayment } from '~/payment'
import { heuristicPublishGas } from './gasHeuristics'
import { getCachedMarketRates, type MarketRates } from './marketRates'
import type { EstimatePublishCostOptions, PublishCostEstimate, PublishWorkSummary } from './types'

const WINSTON_PER_AR = 1e12
const WEI_PER_ETH = 1e18
/** Arweave charges every L1 transaction for at least this much data. */
export const ARWEAVE_MIN_CHARGED_BYTES = 256 * 1024
/** Turbo doesn't charge for uploads up to this size. */
export const TURBO_FREE_BYTES = 100 * 1024

type PublishCostFlags = {
  evmUserPays?: boolean
  arweaveUserPays?: boolean
  arweavePath?: 'l1' | 'bundler'
  /** Where uploads go; with 'turbo' small uploads are free. */
  uploadTo?: 'upload-api' | 'turbo'
  /** The publish chain is a testnet. */
  testnet?: boolean
}

/** Who pays, from the same resolution the publish flow uses ({@link resolvePublishPayment}). */
function readPublishFlags(): PublishCostFlags {
  let testnet = false
  try {
    testnet = getPublishViemChain().testnet === true
  } catch {
    testnet = false
  }
  try {
    const payment = resolvePublishPayment(getPublishConfig())
    return {
      evmUserPays: payment.gas.payer === 'user',
      arweaveUserPays: payment.storage.payer === 'user',
      arweavePath: payment.storage.path,
      uploadTo: payment.storage.uploadTo,
      testnet,
    }
  } catch {
    return { evmUserPays: true, arweaveUserPays: false, arweavePath: 'l1', uploadTo: 'upload-api', testnet }
  }
}

/** The bytes Arweave (or Turbo) charges for, given how the uploads are sent. */
export function chargedUploadBytes(
  work: Pick<PublishWorkSummary, 'uploadCount' | 'uploadBytes' | 'uploadSizes'>,
  path: 'l1' | 'bundler',
  uploadTo: 'upload-api' | 'turbo' = 'upload-api',
): number {
  const sizes =
    work.uploadSizes ??
    (work.uploadCount > 0 ? Array.from({ length: work.uploadCount }, () => work.uploadBytes / work.uploadCount) : [])
  if (sizes.length === 0) return 0
  if (uploadTo === 'turbo') return sizes.filter((size) => size > TURBO_FREE_BYTES).reduce((a, b) => a + b, 0)
  if (path === 'l1') return sizes.reduce((total, size) => total + Math.max(size, ARWEAVE_MIN_CHARGED_BYTES), 0)
  return Math.max(sizes.reduce((a, b) => a + b, 0), ARWEAVE_MIN_CHARGED_BYTES)
}

function roundUsd(n: number): number {
  return Math.round(n * 100) / 100
}

export function combinePublishCostEstimate(
  work: PublishWorkSummary,
  rates: MarketRates,
  flags?: PublishCostFlags,
): PublishCostEstimate {
  const evmUserPays = flags?.evmUserPays ?? true
  const arweaveUserPays = flags?.arweaveUserPays ?? false
  const arweavePath = flags?.arweavePath ?? 'l1'
  const testnet = flags?.testnet ?? false
  const gas = heuristicPublishGas(work)
  const evmWei = gas * rates.gasPriceWei
  const evmEth = Number(evmWei) / WEI_PER_ETH
  // Testnet ETH is worth nothing; mainnet's ETH-USD price doesn't apply to it.
  const evmUsd = testnet ? 0 : evmEth * rates.ethUsd

  const chargedBytes = chargedUploadBytes(work, arweavePath, flags?.uploadTo)
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
      path: arweavePath,
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
  const flags = readPublishFlags()
  let work = options?.work
  if (!work) {
    const { summarizePublishWork } = await import('@seedprotocol/sdk')
    work = await summarizePublishWork(item, { publishMode: options?.publishMode })
  }
  const rates = options?.rates ?? (await getCachedMarketRates())
  return combinePublishCostEstimate(work, rates, flags)
}
