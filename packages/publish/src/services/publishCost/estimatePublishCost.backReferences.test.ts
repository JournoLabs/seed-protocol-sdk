import { afterEach, describe, expect, mock, test } from 'bun:test'

/**
 * The estimate counts back references the way the publish attests them: linked through the
 * publish contract, deferred when it attests directly to EAS (`useDirectEas`, or an EOA publisher). Its own file: it mocks `@seedprotocol/sdk`.
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

// Batch 17 item 18: the publisher's account kind, which decides the route without useDirectEas
const harness = {
  codeKind: 'contract' as 'contract' | 'eoa',
  publisher: undefined as string | undefined,
  /** The publisher's sender's EIP-7702 delegate. */
  delegatesTo: undefined as string | undefined,
}
const realChain = await import('../../helpers/chainClient')
mock.module('../../helpers/chainClient', () => ({
  ...realChain,
  getAccountCodeKind: async () => harness.codeKind,
  // An EOA with no code, for the Seed delegate route; read only when a delegate is configured.
  getPublishPublicClient: () => ({ getCode: async () => '0x' }),
}))
const realRegistry = await import('../../helpers/publishWalletRegistry')
mock.module('../../helpers/publishWalletRegistry', () => ({
  ...realRegistry,
  getPublishWallet: () =>
    harness.publisher
      ? {
          kind: 'eoa',
          txSender: { address: harness.publisher, delegatesTo: harness.delegatesTo },
          signer: { address: harness.publisher },
        }
      : null,
}))

const { initPublish, setConfigRef } = await import('~/config')
const { estimatePublishCost } = await import('./estimatePublishCost')

const rates = { ethUsd: 2000, arUsd: 10, fetchedAt: 1, gasPriceWei: 1_000_000n, winstonPerByte: 1000 }
const item = { seedLocalId: 'item1234567' } as never

afterEach(() => {
  setConfigRef(null)
  harness.codeKind = 'contract'
  harness.publisher = undefined
  harness.delegatesTo = undefined
})

describe('estimatePublishCost back references', () => {
  test('counts a back reference for a contract publish', async () => {
    initPublish({ uploadApiBaseUrl: 'https://example.test' })
    expect((await estimatePublishCost(item, { rates })).work.attestationCount).toBe(3)
  })

  test('leaves it out with useDirectEas, which defers it to the next publish', async () => {
    initPublish({ uploadApiBaseUrl: 'https://example.test', useDirectEas: true })
    expect((await estimatePublishCost(item, { rates })).work.attestationCount).toBe(2)
  })

  test('leaves it out for an EOA publisher, which attests directly to EAS', async () => {
    initPublish({ uploadApiBaseUrl: 'https://example.test' })
    harness.publisher = `0x${'a'.repeat(40)}`
    harness.codeKind = 'eoa'
    expect((await estimatePublishCost(item, { rates })).work.attestationCount).toBe(2)
  })

  test('counts it for a smart account publisher, which publishes through the contract', async () => {
    initPublish({ uploadApiBaseUrl: 'https://example.test' })
    harness.publisher = `0x${'a'.repeat(40)}`
    expect((await estimatePublishCost(item, { rates })).work.attestationCount).toBe(3)
  })

  test('takes the mode the caller gives', async () => {
    initPublish({ uploadApiBaseUrl: 'https://example.test' })
    expect((await estimatePublishCost(item, { rates, backReferences: 'defer' })).work.attestationCount).toBe(2)
  })
})

describe('estimatePublishCost on the Seed delegate', () => {
  test("adds the authorization's gas to an EOA's first publish through it", async () => {
    const delegate = `0x${'5e'.repeat(20)}`
    initPublish({ uploadApiBaseUrl: 'https://example.test', accountMode: 'eip7702', seedDelegateAddress: delegate })
    harness.publisher = `0x${'a'.repeat(40)}`
    harness.codeKind = 'eoa'
    // A sender that doesn't delegate: no authorization (links set by hand, to compare like with like).
    const plain = await estimatePublishCost(item, { rates, backReferences: 'link' })
    harness.delegatesTo = delegate
    const first = await estimatePublishCost(item, { rates })
    // multiPublish links the back reference
    expect(first.work.attestationCount).toBe(3)
    expect(first.evm.gas - plain.evm.gas).toBe(25_000n)
  })

  test('counts the authorization with the chain default delegate too', async () => {
    const { SEED_DELEGATE_ADDRESSES } = await import('../../helpers/constants')
    const table = SEED_DELEGATE_ADDRESSES as Record<number, `0x${string}`>
    const delegate = `0x${'5e'.repeat(20)}` as const
    table[11155420] = delegate
    try {
      initPublish({ uploadApiBaseUrl: 'https://example.test', accountMode: 'eip7702' })
      harness.publisher = `0x${'a'.repeat(40)}`
      harness.codeKind = 'eoa'
      const plain = await estimatePublishCost(item, { rates, backReferences: 'link' })
      harness.delegatesTo = delegate
      const first = await estimatePublishCost(item, { rates })
      expect(first.evm.gas - plain.evm.gas).toBe(25_000n)
    } finally {
      delete table[11155420]
    }
  })
})
