import { afterEach, describe, expect, test } from 'bun:test'
import { initPublish, setConfigRef } from '~/config'
import { combinePublishCostEstimate, estimatePublishCost } from './estimatePublishCost'
import { heuristicPublishGas, PUBLISH_GAS_HEURISTICS } from './gasHeuristics'
import { resetMarketRateCache } from './marketRates'
import type { PublishWorkSummary } from './types'

afterEach(() => {
  setConfigRef(null)
  resetMarketRateCache()
})

const work: PublishWorkSummary = {
  publishMode: 'patch',
  seedCount: 1,
  newSeedCount: 1,
  newVersionCount: 1,
  attestationCount: 3,
  uploadCount: 1,
  uploadBytes: 1_000_000,
}

const rates = {
  ethUsd: 2000,
  arUsd: 10,
  fetchedAt: 1,
  gasPriceWei: 1_000_000n,
  winstonPerByte: 1000,
}

function dummyItem() {
  return { seedLocalId: 'item1234567' } as any
}

describe('heuristicPublishGas', () => {
  test('matches documented constants', () => {
    expect(heuristicPublishGas(work)).toBe(
      PUBLISH_GAS_HEURISTICS.BASE +
        PUBLISH_GAS_HEURISTICS.NEW_SEED +
        PUBLISH_GAS_HEURISTICS.NEW_VERSION +
        PUBLISH_GAS_HEURISTICS.ATTESTATION * 3n,
    )
  })
})

describe('combinePublishCostEstimate', () => {
  test('prices EVM and Arweave into USD', () => {
    const estimate = combinePublishCostEstimate(work, rates)
    expect(estimate.work).toEqual(work)
    expect(estimate.arweave.bytes).toBe(1_000_000)
    expect(estimate.arweave.uploadCount).toBe(1)
    expect(estimate.arweave.path).toBe('l1')
    expect(estimate.arweave.userPays).toBe(true)
    expect(estimate.evm.userPays).toBe(true)
    expect(estimate.totalUsd).toBe(estimate.evm.usd + estimate.arweave.usd)
    expect(estimate.arweave.usd).toBe(0.01)
  })
})

describe('estimatePublishCost', () => {
  test('uses supplied work and rates without network', async () => {
    const estimate = await estimatePublishCost(dummyItem(), { work, rates })
    expect(estimate.work.attestationCount).toBe(3)
    expect(estimate.prices.ethUsd).toBe(2000)
  })

  test('paymaster sets evm.userPays false', async () => {
    initPublish({
      uploadApiBaseUrl: 'https://example.test',
      paymasterUrl: 'https://paymaster.example',
      getTokenPrices: async () => ({ ethUsd: 1, arUsd: 1 }),
    })
    const estimate = await estimatePublishCost(dummyItem(), { work, rates })
    expect(estimate.evm.userPays).toBe(false)
  })

  test('bundler path is reported when configured', async () => {
    initPublish({
      uploadApiBaseUrl: 'https://example.test',
      useArweaveBundler: true,
      getTokenPrices: async () => ({ ethUsd: 1, arUsd: 1 }),
    })
    const estimate = await estimatePublishCost(dummyItem(), { work, rates })
    expect(estimate.arweave.path).toBe('bundler')
  })
})
