import { describe, expect, mock, test } from 'bun:test'
import { createActor, createMachine } from 'xstate'
import { RelatedItemUnpublishedError } from '../../../../../sdk/src/db/read/publishErrors'
import { TEST_TIMEOUT_MS, waitUntilOrThrow } from '../../../../test-utils/waitUntil'
import { InvalidLicenseOfferError, LicenseOfferSchemaNotRegisteredError } from '../../../errors'

/**
 * checking refuses a publish with a license offer that can't be attested (ADR 0039) before any
 * upload or schema registration.
 */
const ADDRESS = '0x' + 'e'.repeat(40)
const harness = { uploadSizes: [] as number[] }
const schemaRegistrations: string[] = []
let offerSchemaRegistered = false

const realConfig = await import('~/config')
const realChainClient = await import('~/helpers/chainClient')
mock.module('@seedprotocol/sdk', () => ({
  assertLocalDbChain: async () => {},
  isItemOwned: async () => true,
  validateItemForPublish: async () => ({ isValid: true, errors: [], payload: [] }),
  summarizePublishUploads: async () => ({
    uploadCount: harness.uploadSizes.length,
    uploadBytes: harness.uploadSizes.reduce((a, b) => a + b, 0),
    uploadSizes: harness.uploadSizes,
    unpublishedRelatedItems: [],
    uploadTargets: [],
  }),
  RelatedItemUnpublishedError,
}))
mock.module('../helpers/ensureEasSchemas', () => ({
  ensureEasSchemasForItem: async (item: { seedLocalId: string }) => {
    schemaRegistrations.push(item.seedLocalId)
  },
}))
mock.module('~/helpers/chainClient', () => ({
  ...realChainClient,
  getAccountCodeKind: async () => 'contract',
  readUntil: async <T,>(read: () => Promise<T>) => read(),
}))
mock.module('~/helpers/publishWalletRegistry', () => ({ getPublishWallet: () => null }))
mock.module('~/helpers/schemaRegistry', () => ({
  getSchemaRecord: async () => (offerSchemaRegistered ? { uid: '0x01' } : null),
}))
mock.module('../helpers/itemNeedsArweave', () => ({ itemNeedsArweaveUpload: async () => true }))
mock.module('~/config', () => ({ ...realConfig, getPublishConfig: () => ({ useModularExecutor: true }) }))
mock.module('../../../helpers/chainConfig', () => ({ getPublishChainName: () => 'test chain' }))
mock.module('../../../helpers/verifyPublishChain', () => ({ verifyPublishChain: async () => {} }))

const wallet = { signer: { address: ADDRESS }, txSender: { address: ADDRESS } }

const runChecking = async (seedLocalId: string, extra: Record<string, unknown> = {}) => {
  const { checking } = await import('./checking')
  const events: { type: string; error?: Error }[] = []
  const actor = createActor(
    createMachine({
      invoke: {
        src: checking,
        input: { context: { item: { seedLocalId }, wallet, address: ADDRESS, publishMode: 'patch', ...extra } },
      },
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

const OFFER = { termsHash: `0x${'ab'.repeat(32)}`, spdx: 'CC-BY-4.0' }

describe('checking: a license offer', () => {
  test('refuses one whose schema is not registered, before registering model schemas', async () => {
    offerSchemaRegistered = false
    schemaRegistrations.length = 0
    const verdict = await runChecking('offer01', { licenseOffer: OFFER })
    expect(verdict.type).toBe('checkingFailed')
    expect(verdict.error).toBeInstanceOf(LicenseOfferSchemaNotRegisteredError)
    expect(schemaRegistrations).toEqual([])
  }, TEST_TIMEOUT_MS)

  test('refuses an invalid offer', async () => {
    offerSchemaRegistered = true
    const verdict = await runChecking('offer02', { licenseOffer: { ...OFFER, termsHash: '0x12' } })
    expect(verdict.type).toBe('checkingFailed')
    expect(verdict.error).toBeInstanceOf(InvalidLicenseOfferError)
  }, TEST_TIMEOUT_MS)

  test('goes ahead once the schema is registered', async () => {
    offerSchemaRegistered = true
    const verdict = await runChecking('offer03', { licenseOffer: OFFER })
    expect(verdict.type).toBe('validPublishProcess')
  }, TEST_TIMEOUT_MS)
})
