import { afterEach, describe, expect, test } from 'bun:test'
import { initPublish, setConfigRef } from '~/config'
import {
  ARWEAVE_MIN_CHARGED_BYTES,
  chargedUploadBytes,
  combinePublishCostEstimate,
  estimatePublishCost,
} from './estimatePublishCost'
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
    expect(estimate.arweave.userPays).toBe(false)
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

  test('EIP-7702 bundler with a paymaster sets evm.userPays false', async () => {
    initPublish({
      uploadApiBaseUrl: 'https://example.test',
      bundlerUrl: 'https://bundler.example',
      paymasterUrl: 'https://paymaster.example',
      getTokenPrices: async () => ({ ethUsd: 1, arUsd: 1 }),
    })
    const estimate = await estimatePublishCost(dummyItem(), { work, rates })
    expect(estimate.evm.userPays).toBe(false)
  })

  test('EIP-7702 bundler without paymasterUrl is sponsored (the bundler is the paymaster)', async () => {
    initPublish({
      uploadApiBaseUrl: 'https://example.test',
      bundlerUrl: 'https://bundler.example',
      getTokenPrices: async () => ({ ethUsd: 1, arUsd: 1 }),
    })
    const estimate = await estimatePublishCost(dummyItem(), { work, rates })
    expect(estimate.evm.userPays).toBe(false)
  })

  test("EIP-7702 with payment.gas 'user': the user pays gas", async () => {
    initPublish({
      uploadApiBaseUrl: 'https://example.test',
      bundlerUrl: 'https://bundler.example',
      payment: { gas: 'user' },
      getTokenPrices: async () => ({ ethUsd: 1, arUsd: 1 }),
    })
    const estimate = await estimatePublishCost(dummyItem(), { work, rates })
    expect(estimate.evm.userPays).toBe(true)
  })

  test("modular executor with payment.gas 'user': the user pays gas", async () => {
    initPublish({
      uploadApiBaseUrl: 'https://example.test',
      useModularExecutor: true,
      payment: { gas: 'user' },
      getTokenPrices: async () => ({ ethUsd: 1, arUsd: 1 }),
    })
    const estimate = await estimatePublishCost(dummyItem(), { work, rates })
    expect(estimate.evm.userPays).toBe(true)
  })

  test('paymasterUrl alone does not sponsor a plain EOA publish', async () => {
    initPublish({
      uploadApiBaseUrl: 'https://example.test',
      paymasterUrl: 'https://paymaster.example',
      getTokenPrices: async () => ({ ethUsd: 1, arUsd: 1 }),
    })
    const estimate = await estimatePublishCost(dummyItem(), { work, rates })
    expect(estimate.evm.userPays).toBe(true)
  })

  test("payment.storage 'user' reports storage as user-paid", async () => {
    initPublish({
      uploadApiBaseUrl: 'https://example.test',
      payment: { storage: 'user' },
      getTokenPrices: async () => ({ ethUsd: 1, arUsd: 1 }),
    })
    const estimate = await estimatePublishCost(dummyItem(), { work, rates })
    expect(estimate.arweave.userPays).toBe(true)
    expect(estimate.arweave.path).toBe('bundler')
  })

  test('modular executor is sponsored by default (thirdweb.sponsorGas)', async () => {
    initPublish({
      uploadApiBaseUrl: 'https://example.test',
      useModularExecutor: true,
      getTokenPrices: async () => ({ ethUsd: 1, arUsd: 1 }),
    })
    const estimate = await estimatePublishCost(dummyItem(), { work, rates })
    expect(estimate.evm.userPays).toBe(false)
  })

  test('modular executor with sponsorGas false: the user pays gas', async () => {
    initPublish({
      uploadApiBaseUrl: 'https://example.test',
      useModularExecutor: true,
      thirdweb: { sponsorGas: false },
      getTokenPrices: async () => ({ ethUsd: 1, arUsd: 1 }),
    })
    const estimate = await estimatePublishCost(dummyItem(), { work, rates })
    expect(estimate.evm.userPays).toBe(true)
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

describe('Arweave charges per transaction', () => {
  const small = { ...work, uploadCount: 3, uploadBytes: 3_000, uploadSizes: [1_000, 1_000, 1_000] }

  test('L1: each upload is charged for at least 256 KiB', () => {
    expect(chargedUploadBytes(small, 'l1')).toBe(3 * ARWEAVE_MIN_CHARGED_BYTES)
    const estimate = combinePublishCostEstimate(small, rates, { arweavePath: 'l1' })
    expect(estimate.arweave.bytes).toBe(3_000)
    expect(estimate.arweave.chargedBytes).toBe(3 * ARWEAVE_MIN_CHARGED_BYTES)
    // 1 KB used to cost 1/262 of what Arweave charges.
    expect(Number(estimate.arweave.ar)).toBeCloseTo((3 * ARWEAVE_MIN_CHARGED_BYTES * 1000) / 1e12, 12)
  })

  test('bundler: one transaction for the whole bundle', () => {
    expect(chargedUploadBytes(small, 'bundler')).toBe(ARWEAVE_MIN_CHARGED_BYTES)
    expect(chargedUploadBytes({ ...work, uploadSizes: [1_000_000] }, 'bundler')).toBe(1_000_000)
  })

  test('Turbo: uploads of 100 KiB or less are free', () => {
    const mixed = { ...work, uploadCount: 2, uploadBytes: 1_001_000, uploadSizes: [1_000, 1_000_000] }
    expect(chargedUploadBytes(mixed, 'bundler', 'turbo')).toBe(1_000_000)
    expect(chargedUploadBytes(small, 'bundler', 'turbo')).toBe(0)
  })

  test('without upload sizes, uploads are equal parts of the total', () => {
    expect(chargedUploadBytes({ uploadCount: 2, uploadBytes: 2_000 }, 'l1')).toBe(2 * ARWEAVE_MIN_CHARGED_BYTES)
    expect(chargedUploadBytes({ uploadCount: 0, uploadBytes: 0 }, 'l1')).toBe(0)
  })
})

describe('testnet gas', () => {
  test('is worth $0, not mainnet ETH-USD', () => {
    // 10 gwei, so mainnet gas is worth more than a rounded cent.
    const pricier = { ...rates, gasPriceWei: 10_000_000_000n }
    const estimate = combinePublishCostEstimate(work, pricier, { testnet: true })
    expect(estimate.evm.testnet).toBe(true)
    expect(Number(estimate.evm.eth)).toBeGreaterThan(0)
    expect(estimate.evm.usd).toBe(0)
    expect(combinePublishCostEstimate(work, pricier).evm.usd).toBeGreaterThan(0)
  })
})
