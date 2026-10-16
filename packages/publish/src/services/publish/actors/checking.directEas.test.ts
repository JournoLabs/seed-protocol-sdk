import { describe, expect, mock, test } from 'bun:test'
import { createActor, createMachine } from 'xstate'
import { RelatedItemUnpublishedError } from '../../../../../sdk/src/db/read/publishErrors'
import { TEST_TIMEOUT_MS, waitUntilOrThrow } from '../../../../test-utils/waitUntil'

/**
 * A publisher with no bytecode goes straight to EAS only when the wallet says it is an EOA
 * (kind: 'eoa') and signs as the publisher, or when useDirectEas is set. An undeployed smart
 * account, a wallet of unknown kind, or one that sends as someone else is refused.
 */
const EOA = '0x' + 'e'.repeat(40)
const ADMIN = '0x' + 'a'.repeat(40)
const SMART = '0x' + '5'.repeat(40)

const harness = {
  useDirectEas: false,
  session: null as null | { signer: { address: string }; kind?: 'eoa' | 'smart' },
}

mock.module('@seedprotocol/sdk', () => ({
  assertLocalDbChain: async () => {},
  isItemOwned: async () => true,
  validateItemForPublish: async () => ({ isValid: true, errors: [] }),
  getUnpublishedRelatedItems: async () => [],
  RelatedItemUnpublishedError,
}))
mock.module('~/helpers/chainClient', () => ({ isContractDeployed: async () => false }))
mock.module('~/helpers/publishWalletRegistry', () => ({ getPublishWallet: () => harness.session }))
mock.module('../helpers/itemNeedsArweave', () => ({ itemNeedsArweaveUpload: async () => false }))
mock.module('../helpers/ensureEasSchemas', () => ({ ensureEasSchemasForItem: async () => {} }))
mock.module('~/config', () => ({
  getPublishConfig: () => ({ useModularExecutor: false, useDirectEas: harness.useDirectEas }),
}))
mock.module('../../../helpers/chainConfig', () => ({ getPublishChainName: () => 'test chain' }))
mock.module('../../../helpers/verifyPublishChain', () => ({ verifyPublishChain: async () => {} }))

const wallet = (address: string, kind?: 'eoa' | 'smart', signer = address) => ({
  signer: { address: signer },
  txSender: { address },
  ...(kind && { kind }),
})

let n = 0
const runChecking = async (address: string, publishWallet: unknown) => {
  const { checking } = await import('./checking')
  const events: { type: string; attestationStrategy?: string; error?: Error & { code?: string } }[] = []
  const machine = createMachine({
    invoke: {
      src: checking,
      input: {
        context: { item: { seedLocalId: `seed${++n}` }, wallet: publishWallet, address, publishMode: 'patch' },
      },
    },
    on: { '*': { actions: ({ event }) => events.push(event as any) } },
  })
  const actor = createActor(machine).start()
  try {
    await waitUntilOrThrow(() => events.length > 0, 'the checking verdict')
  } finally {
    actor.stop()
  }
  return events[0]!
}

describe('checking: direct EAS for publishers with no bytecode', () => {
  test('an EOA publishes straight to EAS', async () => {
    harness.useDirectEas = false
    harness.session = null
    const verdict = await runChecking(EOA, wallet(EOA, 'eoa'))
    expect(verdict.type).toBe('skipArweave')
    expect(verdict.attestationStrategy).toBe('directEas')
  }, TEST_TIMEOUT_MS)

  test('an undeployed smart account is refused', async () => {
    harness.useDirectEas = false
    harness.session = null
    // A thirdweb smart wallet signs and sends as the smart account itself.
    const verdict = await runChecking(SMART, wallet(SMART, 'smart'))
    expect(verdict.type).toBe('checkingFailed')
    expect(verdict.error?.code).toBe('MANAGED_ACCOUNT_NOT_DEPLOYED')
    expect(verdict.error?.message).toContain('not deployed')
  }, TEST_TIMEOUT_MS)

  test("a wallet that doesn't say what it is is refused, unless its session does", async () => {
    harness.useDirectEas = false
    harness.session = null
    const unknown = await runChecking(SMART, wallet(SMART))
    expect(unknown.type).toBe('checkingFailed')
    expect(unknown.error?.message).toContain("doesn't say whether it is an EOA")

    harness.session = { signer: { address: EOA }, kind: 'eoa' }
    const fromSession = await runChecking(EOA, wallet(EOA))
    expect(fromSession.attestationStrategy).toBe('directEas')
  }, TEST_TIMEOUT_MS)

  test('a wallet sending as another address than the publisher is refused', async () => {
    harness.useDirectEas = false
    harness.session = null
    const verdict = await runChecking(SMART, wallet(ADMIN, 'eoa'))
    expect(verdict.type).toBe('checkingFailed')
    expect(verdict.error?.message).toContain('wrong attester')
  }, TEST_TIMEOUT_MS)

  test('an EOA wallet signing as someone else is refused', async () => {
    harness.useDirectEas = false
    harness.session = null
    const verdict = await runChecking(EOA, wallet(EOA, 'eoa', ADMIN))
    expect(verdict.type).toBe('checkingFailed')
    expect(verdict.error?.message).toContain('signs as')
  }, TEST_TIMEOUT_MS)

  test('useDirectEas keeps the direct path, even for a smart account', async () => {
    harness.useDirectEas = true
    harness.session = null
    const verdict = await runChecking(SMART, wallet(SMART, 'smart'))
    expect(verdict.type).toBe('skipArweave')
    expect(verdict.attestationStrategy).toBe('directEas')
  }, TEST_TIMEOUT_MS)
})
