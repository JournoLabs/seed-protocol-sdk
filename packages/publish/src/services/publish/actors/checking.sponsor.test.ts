import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { createActor, createMachine } from 'xstate'
import { RelatedItemUnpublishedError } from '../../../../../sdk/src/db/read/publishErrors'
import { TEST_TIMEOUT_MS, waitUntilOrThrow } from '../../../../test-utils/waitUntil'
import type { SelfPayRequest } from '~/payment'

/**
 * With `payment.sponsorPaymaster`, checking reads the paymaster's deposit and asks
 * `confirmSelfPay` before any upload when the deposit is under twice the publish's gas cost.
 */
const ADDRESS = '0x' + 'e'.repeat(40)
const PAYMASTER = '0x' + '9'.repeat(40)
// 10 attestations at the heuristic's gas, priced at 1 wei per gas: a few hundred thousand wei.
const GAS_PRICE = 1n
let depositWei = 0n
let order: string[] = []
let asked: SelfPayRequest[] = []
let answer: () => Promise<boolean> = async () => true
let payment: Record<string, unknown> = {}

const realConfig = await import('~/config')
const realChainClient = await import('~/helpers/chainClient')
mock.module('@seedprotocol/sdk', () => ({
  assertLocalDbChain: async () => {},
  isItemOwned: async () => true,
  validateItemForPublish: async () => ({ isValid: true, errors: [], payload: [] }),
  summarizePublishUploads: async () => ({ uploadCount: 0, uploadBytes: 0, uploadSizes: [], unpublishedRelatedItems: [], uploadTargets: [] }),
  summarizePublishWork: async () => ({
    publishMode: 'patch',
    seedCount: 1,
    newSeedCount: 1,
    newVersionCount: 1,
    attestationCount: 10,
    uploadCount: 0,
    uploadBytes: 0,
  }),
  getPendingRetractions: async () => [],
  RelatedItemUnpublishedError,
}))
mock.module('../helpers/ensureEasSchemas', () => ({ ensureEasSchemasForItem: async () => {} }))
mock.module('~/helpers/chainClient', () => ({
  ...realChainClient,
  getAccountCodeKind: async () => 'eoa',
  readUntil: async <T,>(read: () => Promise<T>) => read(),
  getPublishPublicClient: () => ({
    readContract: async () => {
      order.push('readDeposit')
      return depositWei
    },
    getGasPrice: async () => GAS_PRICE,
  }),
}))
mock.module('../helpers/itemNeedsArweave', () => ({ itemNeedsArweaveUpload: async () => true }))
mock.module('~/config', () => ({
  ...realConfig,
  getPublishConfig: () => ({
    bundlerUrl: 'http://127.0.0.1:1/bundler',
    paymasterUrl: 'http://127.0.0.1:1/paymaster',
    useModularExecutor: false,
    useDirectEas: true,
    payment,
  }),
}))
mock.module('../../../helpers/chainConfig', () => ({ getPublishChainName: () => 'test chain' }))
mock.module('../../../helpers/verifyPublishChain', () => ({ verifyPublishChain: async () => {} }))

const confirmSelfPay = async (request: SelfPayRequest) => {
  order.push('confirmSelfPay')
  asked.push(request)
  return answer()
}

const runChecking = async () => {
  const { checking } = await import('./checking')
  const events: { type: string; error?: Error }[] = []
  const actor = createActor(
    createMachine({
      invoke: { src: checking, input: { context: { item: { seedLocalId: `s${Math.random()}` }, wallet, address: ADDRESS, publishMode: 'patch' } } },
      on: {
        '*': {
          actions: ({ event }) => {
            order.push(`verdict:${event.type}`)
            events.push(event as never)
          },
        },
      },
    }),
  ).start()
  try {
    await waitUntilOrThrow(() => events.length > 0, 'the checking verdict')
  } finally {
    actor.stop()
  }
  return events[0]!
}

const wallet = { signer: { address: ADDRESS }, txSender: { address: ADDRESS } }

beforeEach(() => {
  order = []
  asked = []
  answer = async () => true
  depositWei = 0n
  payment = { whenSponsorDeclines: 'user', sponsorPaymaster: PAYMASTER, confirmSelfPay }
})

describe('checking: sponsor deposit preflight', () => {
  test('asks before uploads when the deposit is low', async () => {
    depositWei = 1n
    const verdict = await runChecking()
    expect(verdict.type).toBe('validPublishProcess')
    expect(order).toEqual(['readDeposit', 'confirmSelfPay', 'verdict:validPublishProcess'])
    expect(asked).toHaveLength(1)
    expect(asked[0]!.reason).toBe('deposit_low')
    expect(asked[0]!.address).toBe(ADDRESS)
    expect(asked[0]!.estimatedCostWei).toBeGreaterThan(0n)
  }, TEST_TIMEOUT_MS)

  test('refusal stops before uploads', async () => {
    depositWei = 1n
    answer = async () => false
    const verdict = await runChecking()
    expect(verdict.type).toBe('checkingFailed')
    expect(verdict.error).toMatchObject({ name: 'PublishGasError', code: 'SELF_PAY_REFUSED', address: ADDRESS })
  }, TEST_TIMEOUT_MS)

  test('a throwing confirmSelfPay refuses', async () => {
    depositWei = 1n
    answer = async () => {
      throw new Error('dialog closed')
    }
    const verdict = await runChecking()
    expect(verdict.error).toMatchObject({ code: 'SELF_PAY_REFUSED' })
  }, TEST_TIMEOUT_MS)

  test('no question when funded', async () => {
    depositWei = 10n ** 30n
    const verdict = await runChecking()
    expect(verdict.type).toBe('validPublishProcess')
    expect(asked).toEqual([])
    expect(order).toContain('readDeposit')
  }, TEST_TIMEOUT_MS)

  test('the margin is twice the estimate', async () => {
    // Exactly the estimate is under 2x: still asked.
    depositWei = 1n
    await runChecking()
    const estimate = asked[0]!.estimatedCostWei!
    asked = []
    depositWei = estimate * 2n
    await runChecking()
    expect(asked).toEqual([])
    depositWei = estimate * 2n - 1n
    await runChecking()
    expect(asked).toHaveLength(1)
  }, TEST_TIMEOUT_MS)

  test('no question without sponsorPaymaster', async () => {
    payment = { whenSponsorDeclines: 'user', confirmSelfPay }
    const verdict = await runChecking()
    expect(verdict.type).toBe('validPublishProcess')
    expect(asked).toEqual([])
    expect(order).not.toContain('readDeposit')
  }, TEST_TIMEOUT_MS)

  test("no question when the app doesn't fall back", async () => {
    payment = { sponsorPaymaster: PAYMASTER, confirmSelfPay }
    await runChecking()
    expect(asked).toEqual([])
    expect(order).not.toContain('readDeposit')
  }, TEST_TIMEOUT_MS)
})
