import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { initPublish, setConfigRef } from '~/config'

/**
 * Batch 18 item 5: the estimate carries the number of transactions a publish through the contract
 * is expected to go out in, so a host can price them before the author pays for uploads.
 */
const ZERO = `0x${'0'.repeat(64)}`
const ADDRESS = '0x' + 'e'.repeat(40)
const request = (localId: string, bytes = 0) => ({
  localId,
  seedUid: ZERO,
  seedSchemaUid: `0x${'1'.repeat(64)}`,
  versionUid: ZERO,
  versionSchemaUid: `0x${'2'.repeat(64)}`,
  seedIsRevocable: true,
  propertiesToUpdate: [],
  listOfAttestations: [
    {
      schema: `0x${'3'.repeat(64)}`,
      data: [{ recipient: ADDRESS, expirationTime: 0n, revocable: true, refUID: ZERO, data: `0x${'ab'.repeat(bytes)}`, value: 0n }],
    },
  ],
})

const harness = {
  payload: [] as ReturnType<typeof request>[],
  uploadsSeen: [] as unknown[][],
  backReferencesSeen: [] as unknown[],
  invalid: false,
}

const realSdk = await import('@seedprotocol/sdk')
mock.module('@seedprotocol/sdk', () => ({
  ...realSdk,
  summarizePublishWork: async () => ({
    publishMode: 'patch',
    seedCount: harness.payload.length,
    newSeedCount: harness.payload.length,
    newVersionCount: harness.payload.length,
    attestationCount: harness.payload.length,
    uploadCount: 0,
    uploadBytes: 0,
  }),
  summarizePublishUploads: async () => ({
    uploadCount: 1,
    uploadBytes: 10,
    uploadSizes: [10],
    unpublishedRelatedItems: [],
    uploadTargets: [{ seedLocalId: 'image001', itemPropertyName: 'storageTransactionId' }],
  }),
  validateItemForPublish: async (_item: unknown, uploads: unknown[], options: { backReferences?: unknown }) => {
    harness.uploadsSeen.push(uploads)
    harness.backReferencesSeen.push(options?.backReferences)
    return harness.invalid
      ? { isValid: false, errors: [{ message: 'no' }] }
      : { isValid: true, errors: [], payload: harness.payload }
  },
}))

const { estimatePublishCost } = await import('./estimatePublishCost')
const { resetMarketRateCache } = await import('./marketRates')

const rates = { ethUsd: 2000, arUsd: 10, fetchedAt: 1, gasPriceWei: 1_000_000n, winstonPerByte: 1000 }
const item = { seedLocalId: 'item1234567' } as never

const publishConfig = {
  uploadApiBaseUrl: 'https://example.test',
  bundlerUrl: 'https://bundler.example',
  getTokenPrices: async () => ({ ethUsd: 1, arUsd: 1 }),
}

beforeEach(() => {
  initPublish(publishConfig)
})

afterEach(() => {
  setConfigRef(null)
  resetMarketRateCache()
  harness.invalid = false
  harness.uploadsSeen.length = 0
  harness.backReferencesSeen.length = 0
})

describe('estimatePublishCost expectedPublishTransactions', () => {
  test('is 1 for a publish that fits in a transaction', async () => {
    harness.payload = [request('post0001', 100)]
    const estimate = await estimatePublishCost(item, { rates })
    expect(estimate.expectedPublishTransactions).toBe(1)
    // Sized with an Arweave id's length standing in for each upload not yet made, linking back references.
    expect(harness.uploadsSeen[0]).toEqual([
      { seedLocalId: 'image001', itemPropertyName: 'storageTransactionId', txId: expect.stringMatching(/^.{43}$/) },
    ])
    expect(harness.backReferencesSeen[0]).toBe('link')
  })

  test('counts the parts of a graph over one transaction, as checking does', async () => {
    // 50 new seeds need 17.5M gas, over 16M: 35 fit in a transaction with headroom.
    harness.payload = Array.from({ length: 50 }, (_, i) => request(`item${String(i).padStart(4, '0')}`))
    expect((await estimatePublishCost(item, { rates })).expectedPublishTransactions).toBe(2)
  })

  // D67 asked how slow the count is on a large graph. Measured on the dev machine with requests of
  // one small attestation each: 200 items about 150 ms, 500 items 220 ms, 2,000 items 1 s. The bound is
  // loose; the printed times are the measurement.
  test('counts a graph of hundreds of items in a fraction of a second', async () => {
    for (const [size, parts, limitMs] of [
      [200, 6, 500],
      [500, 15, 1000],
      [2000, 58, 10_000],
    ] as const) {
      harness.payload = Array.from({ length: size }, (_, i) => request(`item${String(i).padStart(5, '0')}`))
      const started = performance.now()
      const estimate = await estimatePublishCost(item, { rates })
      const elapsed = performance.now() - started
      console.info(`expectedPublishTransactions for ${size} items: ${estimate.expectedPublishTransactions} parts in ${elapsed.toFixed(0)} ms`)
      expect(estimate.expectedPublishTransactions).toBe(parts)
      expect(elapsed).toBeLessThan(limitMs)
    }
  })

  test('is absent on the direct EAS route, which sends no parts', async () => {
    initPublish({ ...publishConfig, useDirectEas: true })
    harness.payload = [request('post0001')]
    const estimate = await estimatePublishCost(item, { rates })
    expect(estimate.expectedPublishTransactions).toBeUndefined()
    expect(harness.uploadsSeen).toHaveLength(0)
  })

  test('is absent before initPublish, which the size limits come from', async () => {
    setConfigRef(null)
    harness.payload = [request('post0001')]
    expect((await estimatePublishCost(item, { rates })).expectedPublishTransactions).toBeUndefined()
  })

  test('is absent when one item is too large for a transaction, which the publish refuses', async () => {
    harness.payload = [request('post0001', 30_000)]
    const estimate = await estimatePublishCost(item, { rates })
    expect(estimate.expectedPublishTransactions).toBeUndefined()
    expect(estimate.work.seedCount).toBe(1)
  })

  test('is absent when the payload is invalid, and a given work summary skips the count', async () => {
    harness.invalid = true
    harness.payload = [request('post0001')]
    expect((await estimatePublishCost(item, { rates })).expectedPublishTransactions).toBeUndefined()
    harness.invalid = false
    harness.uploadsSeen.length = 0
    const work = { publishMode: 'patch', seedCount: 1, newSeedCount: 1, newVersionCount: 1, attestationCount: 1, uploadCount: 0, uploadBytes: 0 } as const
    expect((await estimatePublishCost(item, { rates, work })).expectedPublishTransactions).toBeUndefined()
    expect(harness.uploadsSeen).toHaveLength(0)
  })
})
