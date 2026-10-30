import { afterEach, describe, expect, test } from 'bun:test'
import { initPublish, setConfigRef } from '~/config'
import { signedDataItemByteLength } from '~/helpers/arweave'
import {
  ARWEAVE_MIN_CHARGED_BYTES,
  chargedUploadBytes,
  combinePublishCostEstimate,
  estimatePublishCost,
  repricePublishCostEstimate,
  resetTurboFreeBytesCache,
  TURBO_FREE_BYTES,
} from './estimatePublishCost'
import { heuristicPublishGas, PUBLISH_GAS_HEURISTICS } from './gasHeuristics'
import { resetMarketRateCache } from './marketRates'
import type { PublishWorkSummary } from './types'

const realFetch = globalThis.fetch

afterEach(() => {
  setConfigRef(null)
  resetMarketRateCache()
  resetTurboFreeBytesCache()
  globalThis.fetch = realFetch
})

/** Signed size of an upload of `bytes` with the tags every upload carries and none configured. */
const signed = (bytes: number) =>
  signedDataItemByteLength(bytes, [
    { name: 'Content-SHA-256', value: '0'.repeat(64) },
    { name: 'Content-Type', value: 'application/octet-stream' },
  ])

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

  test('counts the revocations of retracted properties', () => {
    expect(heuristicPublishGas({ ...work, revocationCount: 2 }) - heuristicPublishGas(work)).toBe(
      PUBLISH_GAS_HEURISTICS.REVOCATION * 2n,
    )
  })
})

describe('combinePublishCostEstimate', () => {
  test('prices EVM and Arweave into USD', () => {
    const estimate = combinePublishCostEstimate(work, rates)
    expect(estimate.work).toEqual(work)
    expect(estimate.arweave.bytes).toBe(1_000_000)
    expect(estimate.arweave.uploadCount).toBe(1)
    expect(estimate.arweave.path).toBe('bundler')
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
    // Turbo's /v1/info, read for its free size.
    globalThis.fetch = (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch
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

  test('reports the bundler path', async () => {
    initPublish({
      uploadApiBaseUrl: 'https://example.test',
      getTokenPrices: async () => ({ ethUsd: 1, arUsd: 1 }),
    })
    const estimate = await estimatePublishCost(dummyItem(), { work, rates })
    expect(estimate.arweave.path).toBe('bundler')
  })
})

describe('Arweave charges per transaction', () => {
  const small = { ...work, uploadCount: 3, uploadBytes: 3_000, uploadSizes: [1_000, 1_000, 1_000] }

  test('one transaction for the whole bundle, charged for at least 256 KiB', () => {
    expect(chargedUploadBytes(small)).toBe(ARWEAVE_MIN_CHARGED_BYTES)
    expect(chargedUploadBytes({ ...work, uploadSizes: [1_000_000] })).toBe(signed(1_000_000))
    const estimate = combinePublishCostEstimate(small, rates)
    expect(estimate.arweave.bytes).toBe(3_000)
    expect(estimate.arweave.chargedBytes).toBe(ARWEAVE_MIN_CHARGED_BYTES)
    expect(Number(estimate.arweave.ar)).toBeCloseTo((ARWEAVE_MIN_CHARGED_BYTES * 1000) / 1e12, 12)
  })

  test('Turbo: data items of 100 KiB or less are free', () => {
    const mixed = { ...work, uploadCount: 2, uploadBytes: 1_001_000, uploadSizes: [1_000, 1_000_000] }
    expect(chargedUploadBytes(mixed, 'turbo')).toBe(signed(1_000_000))
    expect(chargedUploadBytes(small, 'turbo')).toBe(0)
  })

  test("sizes the signed data item: an upload just under Turbo's free size isn't free once signed", () => {
    const nearLimit = TURBO_FREE_BYTES - 100
    expect(signed(nearLimit)).toBeGreaterThan(TURBO_FREE_BYTES)
    const upload = { ...work, uploadCount: 1, uploadBytes: nearLimit, uploadSizes: [nearLimit] }
    expect(chargedUploadBytes(upload, 'turbo')).toBe(signed(nearLimit))
    // Configured tags count too.
    const tags = [{ name: 'App-Name', value: 'PermaPress' }]
    expect(chargedUploadBytes(upload, 'turbo', { uploadTags: tags })).toBeGreaterThan(signed(nearLimit))
  })

  test('without upload sizes, uploads are equal parts of the total', () => {
    expect(chargedUploadBytes({ uploadCount: 2, uploadBytes: 400_000 }, 'turbo')).toBe(2 * signed(200_000))
    expect(chargedUploadBytes({ uploadCount: 0, uploadBytes: 0 })).toBe(0)
  })

  test("user-paid storage uses Turbo's free size from /v1/info", async () => {
    const requested: string[] = []
    globalThis.fetch = (async (url: string) => {
      requested.push(String(url))
      return new Response(JSON.stringify({ freeUploadLimitBytes: 107_520 }), { status: 200 })
    }) as typeof fetch
    initPublish({
      uploadApiBaseUrl: 'https://example.test',
      payment: { storage: 'user', userStorage: { uploadUrl: 'https://turbo.example.test', paymentUrl: 'https://pay.example.test' } },
      getTokenPrices: async () => ({ ethUsd: 1, arUsd: 1 }),
    })
    // Over the 102,400-byte fallback, under Turbo's live 107,520 once signed.
    const upload = { ...work, uploadCount: 1, uploadBytes: 105_000, uploadSizes: [105_000] }
    const estimate = await estimatePublishCost(dummyItem(), { work: upload, rates })
    expect(requested).toEqual(['https://turbo.example.test/v1/info'])
    expect(estimate.arweave.uploadTo).toBe('turbo')
    expect(estimate.arweave.freeBytes).toBe(107_520)
    expect(estimate.arweave.chargedBytes).toBe(0)
    // Cached: a second estimate doesn't ask again.
    await estimatePublishCost(dummyItem(), { work: upload, rates })
    expect(requested).toHaveLength(1)
  })

  test("falls back to 100 KiB when Turbo's /v1/info doesn't answer", async () => {
    globalThis.fetch = (async () => new Response('down', { status: 503 })) as unknown as typeof fetch
    initPublish({
      uploadApiBaseUrl: 'https://example.test',
      payment: { storage: 'user', userStorage: { uploadUrl: 'https://turbo.example.test', paymentUrl: 'https://pay.example.test' } },
      getTokenPrices: async () => ({ ethUsd: 1, arUsd: 1 }),
    })
    const upload = { ...work, uploadCount: 1, uploadBytes: 105_000, uploadSizes: [105_000] }
    const estimate = await estimatePublishCost(dummyItem(), { work: upload, rates })
    expect(estimate.arweave.freeBytes).toBe(TURBO_FREE_BYTES)
    expect(estimate.arweave.chargedBytes).toBe(signed(105_000))
  })
})

describe('repricePublishCostEstimate', () => {
  test('keeps the payers, upload target, free size and testnet of the estimate it reprices', () => {
    const upload = { ...work, uploadCount: 2, uploadBytes: 1_001_000, uploadSizes: [1_000, 1_000_000] }
    const first = combinePublishCostEstimate(upload, rates, {
      evmUserPays: false,
      arweaveUserPays: true,
      uploadTo: 'turbo',
      freeBytes: 107_520,
      testnet: true,
    })
    const pricier = { ...rates, arUsd: 20, gasPriceWei: 10_000_000_000n, winstonPerByte: 2000, fetchedAt: 2 }
    const next = repricePublishCostEstimate(first, pricier)
    expect(next.evm.userPays).toBe(false)
    expect(next.arweave.userPays).toBe(true)
    expect(next.arweave.uploadTo).toBe('turbo')
    expect(next.arweave.freeBytes).toBe(107_520)
    expect(next.evm.testnet).toBe(true)
    expect(next.evm.usd).toBe(0)
    expect(next.evm.gas).toBe(first.evm.gas)
    // Turbo's free first upload stays free: only the 1 MB one is charged, at the new rate.
    expect(next.arweave.chargedBytes).toBe(first.arweave.chargedBytes)
    expect(next.arweave.ar).toBe(((first.arweave.chargedBytes * 2000) / 1e12).toPrecision(6))
    expect(next.prices.fetchedAt).toBe(2)
  })
})

describe('upload estimate', () => {
  test('applies the publish config limits', async () => {
    initPublish({
      uploadApiBaseUrl: 'https://example.test',
      maxUploadBytes: 500_000,
      confirmUploadAboveBytes: 100_000,
      uplinkBitsPerSecond: 8_000_000,
      getTokenPrices: async () => ({ ethUsd: 1, arUsd: 1 }),
    })
    const estimate = await estimatePublishCost(dummyItem(), { work, rates })
    expect(estimate.upload).toMatchObject({
      uploadBytes: 1_000_000,
      maxUploadBytes: 500_000,
      confirmUploadAboveBytes: 100_000,
      uploadSeconds: 1,
      tooLarge: true,
      requiresConfirm: true,
    })
  })

  test('repricing keeps the upload estimate', () => {
    const first = combinePublishCostEstimate(work, rates, { uploadLimits: { maxUploadBytes: 10 } })
    expect(repricePublishCostEstimate(first, { ...rates, arUsd: 20 }).upload).toEqual(first.upload)
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
