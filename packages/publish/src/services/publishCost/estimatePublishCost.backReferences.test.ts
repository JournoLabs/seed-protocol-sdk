import { afterEach, describe, expect, mock, test } from 'bun:test'

/**
 * The estimate counts back references the way the publish attests them: linked through the
 * publish contract, deferred with `useDirectEas`. Its own file: it mocks `@seedprotocol/sdk`.
 */

const real = await import('@seedprotocol/sdk')
// Two properties attested now; a third, a reference back to an item the publish creates, only
// when references are linked
mock.module('@seedprotocol/sdk', () => ({
  ...real,
  summarizePublishWork: async (_item: unknown, options?: { backReferences?: 'link' | 'defer' }) => ({
    publishMode: 'patch',
    seedCount: 2,
    newSeedCount: 2,
    newVersionCount: 2,
    attestationCount: options?.backReferences === 'link' ? 3 : 2,
    revocationCount: 0,
    uploadCount: 0,
    uploadBytes: 0,
    uploadSizes: [],
    unpublishedRelatedItems: [],
  }),
}))

const { initPublish, setConfigRef } = await import('~/config')
const { estimatePublishCost } = await import('./estimatePublishCost')

const rates = { ethUsd: 2000, arUsd: 10, fetchedAt: 1, gasPriceWei: 1_000_000n, winstonPerByte: 1000 }
const item = { seedLocalId: 'item1234567' } as never

afterEach(() => setConfigRef(null))

describe('estimatePublishCost back references', () => {
  test('counts a back reference for a contract publish', async () => {
    initPublish({ uploadApiBaseUrl: 'https://example.test' })
    expect((await estimatePublishCost(item, { rates })).work.attestationCount).toBe(3)
  })

  test('leaves it out with useDirectEas, which defers it to the next publish', async () => {
    initPublish({ uploadApiBaseUrl: 'https://example.test', useDirectEas: true })
    expect((await estimatePublishCost(item, { rates })).work.attestationCount).toBe(2)
  })

  test('takes the mode the caller gives', async () => {
    initPublish({ uploadApiBaseUrl: 'https://example.test' })
    expect((await estimatePublishCost(item, { rates, backReferences: 'defer' })).work.attestationCount).toBe(2)
  })
})
