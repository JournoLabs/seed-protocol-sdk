import type { IItem } from '@seedprotocol/sdk'
import { getPublishConfig } from '~/config'
import { heuristicPublishGas } from './gasHeuristics'
import { getCachedMarketRates, type MarketRates } from './marketRates'
import type { EstimatePublishCostOptions, PublishCostEstimate, PublishWorkSummary } from './types'

const WINSTON_PER_AR = 1e12
const WEI_PER_ETH = 1e18

function readPublishFlags(): { evmUserPays: boolean; arweavePath: 'l1' | 'bundler' } {
  try {
    const cfg = getPublishConfig()
    return {
      evmUserPays: !cfg.paymasterUrl,
      arweavePath: cfg.useArweaveBundler ? 'bundler' : 'l1',
    }
  } catch {
    return { evmUserPays: true, arweavePath: 'l1' }
  }
}

function roundUsd(n: number): number {
  return Math.round(n * 100) / 100
}

export function combinePublishCostEstimate(
  work: PublishWorkSummary,
  rates: MarketRates,
  flags?: { evmUserPays?: boolean; arweavePath?: 'l1' | 'bundler' },
): PublishCostEstimate {
  const evmUserPays = flags?.evmUserPays ?? true
  const arweavePath = flags?.arweavePath ?? 'l1'
  const gas = heuristicPublishGas(work)
  const evmWei = gas * rates.gasPriceWei
  const evmEth = Number(evmWei) / WEI_PER_ETH
  const evmUsd = evmEth * rates.ethUsd

  const winston = Math.max(0, Math.round(work.uploadBytes * rates.winstonPerByte))
  const ar = winston / WINSTON_PER_AR
  const arUsd = ar * rates.arUsd

  return {
    totalUsd: roundUsd(evmUsd + arUsd),
    evm: {
      eth: evmEth.toPrecision(6),
      usd: roundUsd(evmUsd),
      gas,
      userPays: evmUserPays,
    },
    arweave: {
      ar: ar.toPrecision(6),
      usd: roundUsd(arUsd),
      bytes: work.uploadBytes,
      uploadCount: work.uploadCount,
      path: arweavePath,
      userPays: true,
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
