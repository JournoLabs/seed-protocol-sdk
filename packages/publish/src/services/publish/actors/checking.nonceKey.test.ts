import { describe, expect, mock, test } from 'bun:test'
import { createActor, createMachine } from 'xstate'
import { RelatedItemUnpublishedError } from '../../../../../sdk/src/db/read/publishErrors'
import { TEST_TIMEOUT_MS, waitUntilOrThrow } from '../../../../test-utils/waitUntil'

/**
 * A host's nonceKey that can't be used fails the publish in checking, before anything is uploaded:
 * a sender that doesn't pin, a direct EAS publish, or a key an earlier try already spent.
 */
const PUBLISHER = '0x' + '5'.repeat(40)
const EOA = '0x' + 'e'.repeat(40)
const ENTRY_POINT = '0x' + '7'.repeat(40)

const MANAGED = '0x' + '6'.repeat(40)
const IN_APP = '0x' + '8'.repeat(40)

const harness = {
  useModularExecutor: false,
  /** Arguments of each EntryPoint getNonce read. */
  nonceReads: [] as unknown[][],
  codeKind: 'contract' as 'none' | 'contract',
  /** The EntryPoint nonce under the key: its low 64 bits are how many UserOps landed. */
  chainNonce: 0n,
}

mock.module('@seedprotocol/sdk', () => ({
  assertLocalDbChain: async () => {},
  isItemOwned: async () => true,
  validateItemForPublish: async () => ({ isValid: true, errors: [] }),
  summarizePublishUploads: async () => ({ uploadCount: 0, uploadBytes: 0, uploadSizes: [], unpublishedRelatedItems: [] }),
  RelatedItemUnpublishedError,
}))
mock.module('~/helpers/chainClient', () => ({
  getAccountCodeKind: async () => harness.codeKind,
  readUntil: async <T,>(read: () => Promise<T>) => read(),
  getPublishPublicClient: () => ({
    readContract: async ({ args }: { args: unknown[] }) => {
      harness.nonceReads.push(args)
      return harness.chainNonce
    },
  }),
}))
mock.module('~/helpers/ensureAutomationSessionKey', () => ({ isAutomationSessionActive: async () => false }))
mock.module('~/helpers/thirdweb', () => ({ getConnectedManagedAccountAddress: async () => MANAGED }))
mock.module('~/helpers/thirdwebChain', () => ({ getPublishThirdwebChain: () => ({ id: 84532 }) }))
mock.module('~/helpers/publishWalletRegistry', () => ({ getPublishWallet: () => null }))
mock.module('../helpers/itemNeedsArweave', () => ({ itemNeedsArweaveUpload: async () => true }))
mock.module('../helpers/ensureEasSchemas', () => ({ ensureEasSchemasForItem: async () => {} }))
mock.module('~/config', () => ({
  getPublishConfig: () => ({ useModularExecutor: harness.useModularExecutor, useDirectEas: false }),
}))
mock.module('../../../helpers/chainConfig', () => ({ getPublishChainName: () => 'test chain' }))
mock.module('../../../helpers/verifyPublishChain', () => ({ verifyPublishChain: async () => {} }))

const { pinnedNonce, publishNonceKey } = await import('~/helpers/pinnedNonce')

const pinning = { signer: { address: PUBLISHER }, txSender: { address: PUBLISHER, pinsNonceOn: ENTRY_POINT } }

let n = 0
const runChecking = async (address: string, wallet: unknown, nonceKey = 'run-7') => {
  const { checking } = await import('./checking')
  const events: { type: string; error?: Error & { code?: string } }[] = []
  const machine = createMachine({
    invoke: {
      src: checking,
      input: {
        context: { item: { seedLocalId: `seed${++n}` }, wallet, address, publishMode: 'patch', nonceKey },
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

describe('checking: CreatePublishOptions.nonceKey', () => {
  test('a pinning sender with an unspent key goes on to the uploads', async () => {
    harness.codeKind = 'contract'
    harness.chainNonce = pinnedNonce(publishNonceKey('run-7'))
    expect((await runChecking(PUBLISHER, pinning)).type).toBe('validPublishProcess')
  }, TEST_TIMEOUT_MS)

  test('a sender that does not pin fails before any upload', async () => {
    harness.codeKind = 'contract'
    const event = await runChecking(PUBLISHER, { signer: { address: PUBLISHER }, txSender: { address: PUBLISHER } })
    expect(event.type).toBe('checkingFailed')
    expect(event.error).toMatchObject({ name: 'PublishNonceKeyError', code: 'NONCE_KEY_NOT_PINNED', nonceKey: 'run-7' })
  }, TEST_TIMEOUT_MS)

  test('a key an earlier try landed under fails before any upload', async () => {
    harness.codeKind = 'contract'
    harness.chainNonce = pinnedNonce(publishNonceKey('run-7')) + 1n
    const event = await runChecking(PUBLISHER, pinning)
    expect(event.type).toBe('checkingFailed')
    expect(event.error).toMatchObject({ code: 'NONCE_KEY_SPENT', sender: PUBLISHER })
  }, TEST_TIMEOUT_MS)

  // Batch 16 item 41: ConnectButton's in-app wallet; the publish sends from the ManagedAccount
  test('with useModularExecutor, checks the ManagedAccount sender the publish sends from', async () => {
    harness.codeKind = 'contract'
    harness.useModularExecutor = true
    harness.nonceReads = []
    harness.chainNonce = pinnedNonce(publishNonceKey('run-7'))
    try {
      const inApp = { signer: { address: IN_APP }, txSender: { address: IN_APP } }
      expect((await runChecking(PUBLISHER, inApp)).type).toBe('validPublishProcess')
      expect(harness.nonceReads).toEqual([[MANAGED, publishNonceKey('run-7')]])
    } finally {
      harness.useModularExecutor = false
    }
  }, TEST_TIMEOUT_MS)

  test('a direct EAS publish fails before any upload', async () => {
    harness.codeKind = 'none'
    const eoa = { signer: { address: EOA }, txSender: { address: EOA }, kind: 'eoa' }
    const event = await runChecking(EOA, eoa)
    expect(event.type).toBe('checkingFailed')
    expect(event.error).toMatchObject({ code: 'NONCE_KEY_DIRECT_EAS' })
  }, TEST_TIMEOUT_MS)
})
