import { describe, expect, mock, test } from 'bun:test'
import { createActor, createMachine } from 'xstate'
import { RelatedItemUnpublishedError } from '../../../../../sdk/src/db/read/publishErrors'
import { TEST_TIMEOUT_MS, waitUntilOrThrow } from '../../../../test-utils/waitUntil'

/**
 * checking refuses a publish it can't finish before registering EAS schemas, which costs
 * transactions: a wallet that can't revoke a pending retraction, or no publisher address (batch 12).
 */
const ADDRESS = '0x' + 'e'.repeat(40)
const schemaRegistrations: string[] = []

mock.module('@seedprotocol/sdk', () => ({
  assertLocalDbChain: async () => {},
  isItemOwned: async () => true,
  validateItemForPublish: async () => ({ isValid: true, errors: [] }),
  getUnpublishedRelatedItems: async () => [],
  getPendingRetractions: async () => [{ propertyName: 'title' }],
  RelatedItemUnpublishedError,
}))
mock.module('../../revoke/revokeAttestations', () => ({
  assertCanRevokeSeedAttestations: async () => {
    throw new Error('This wallet cannot revoke the seed attestations')
  },
}))
mock.module('../helpers/ensureEasSchemas', () => ({
  ensureEasSchemasForItem: async (item: { seedLocalId: string }) => {
    schemaRegistrations.push(item.seedLocalId)
  },
}))
mock.module('~/helpers/chainClient', () => ({
  getAccountCodeKind: async () => 'contract',
  readUntil: async <T,>(read: () => Promise<T>) => read(),
}))
mock.module('~/helpers/publishWalletRegistry', () => ({ getPublishWallet: () => null }))
mock.module('../helpers/itemNeedsArweave', () => ({ itemNeedsArweaveUpload: async () => false }))
mock.module('~/config', () => ({ getPublishConfig: () => ({ useModularExecutor: false, useDirectEas: false }) }))
mock.module('../../../helpers/chainConfig', () => ({ getPublishChainName: () => 'test chain' }))
mock.module('../../../helpers/verifyPublishChain', () => ({ verifyPublishChain: async () => {} }))

const runChecking = async (context: Record<string, unknown>) => {
  const { checking } = await import('./checking')
  const events: { type: string; error?: Error; errors?: { message: string }[] }[] = []
  const actor = createActor(
    createMachine({
      invoke: { src: checking, input: { context } },
      on: { '*': { actions: ({ event }) => events.push(event as any) } },
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

describe('checking order', () => {
  test("refuses a wallet that can't revoke before registering schemas", async () => {
    schemaRegistrations.length = 0
    const verdict = await runChecking({
      item: { seedLocalId: 'retracting', seedUid: '0x' + '1'.repeat(64) },
      wallet,
      address: ADDRESS,
      publishMode: 'patch',
    })
    expect(verdict.type).toBe('checkingFailed')
    expect(verdict.error?.message).toContain('cannot revoke')
    expect(schemaRegistrations).toEqual([])
  }, TEST_TIMEOUT_MS)

  test('refuses a publish with no publisher address before registering schemas', async () => {
    schemaRegistrations.length = 0
    const verdict = await runChecking({ item: { seedLocalId: 'no-address' }, wallet, address: '', publishMode: 'patch' })
    expect(verdict.type).toBe('validationFailed')
    expect(schemaRegistrations).toEqual([])
  }, TEST_TIMEOUT_MS)
})
