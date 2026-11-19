import { describe, expect, mock, test } from 'bun:test'
import { createActor, createMachine } from 'xstate'
import { RelatedItemUnpublishedError } from '../../../../../sdk/src/db/read/publishErrors'
import { TEST_TIMEOUT_MS, waitUntilOrThrow } from '../../../../test-utils/waitUntil'

/**
 * checking refuses a multiPublish too large for one transaction before anything is uploaded,
 * sizing the payload with a placeholder Arweave id for each upload.
 */
const ADDRESS = '0x' + 'e'.repeat(40)
const ZERO = `0x${'0'.repeat(64)}`
const harness = { attestedBytes: 0, uploadsSeen: [] as { seedLocalId?: string; txId: string }[][] }

const payloadOf = (bytes: number) => [
  {
    localId: 'post0001',
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
  },
]

const realConfig = await import('~/config')
const realChainClient = await import('~/helpers/chainClient')
mock.module('@seedprotocol/sdk', () => ({
  assertLocalDbChain: async () => {},
  isItemOwned: async () => true,
  validateItemForPublish: async (_item: unknown, uploads: { seedLocalId?: string; txId: string }[]) => {
    harness.uploadsSeen.push(uploads)
    return { isValid: true, errors: [], payload: payloadOf(harness.attestedBytes) }
  },
  summarizePublishUploads: async () => ({
    uploadCount: 1,
    uploadBytes: 10,
    uploadSizes: [10],
    unpublishedRelatedItems: [],
    uploadTargets: [{ seedLocalId: 'image001', itemPropertyName: 'storageTransactionId' }],
  }),
  RelatedItemUnpublishedError,
}))
mock.module('../helpers/ensureEasSchemas', () => ({ ensureEasSchemasForItem: async () => {} }))
mock.module('~/helpers/chainClient', () => ({
  ...realChainClient,
  getAccountCodeKind: async () => 'contract',
  readUntil: async <T,>(read: () => Promise<T>) => read(),
}))
mock.module('~/helpers/publishWalletRegistry', () => ({ getPublishWallet: () => null }))
mock.module('../helpers/itemNeedsArweave', () => ({ itemNeedsArweaveUpload: async () => true }))
mock.module('~/config', () => ({ ...realConfig, getPublishConfig: () => ({ useModularExecutor: true }) }))
mock.module('../../../helpers/chainConfig', () => ({ getPublishChainName: () => 'test chain' }))
mock.module('../../../helpers/verifyPublishChain', () => ({ verifyPublishChain: async () => {} }))

const wallet = { signer: { address: ADDRESS }, txSender: { address: ADDRESS } }

const runChecking = async (seedLocalId: string) => {
  const { checking } = await import('./checking')
  const events: { type: string; error?: Error }[] = []
  const actor = createActor(
    createMachine({
      invoke: {
        src: checking,
        input: { context: { item: { seedLocalId }, wallet, address: ADDRESS, publishMode: 'patch' } },
      },
      on: { '*': { actions: ({ event }) => events.push(event as { type: string; error?: Error }) } },
    }),
  ).start()
  try {
    await waitUntilOrThrow(() => events.length > 0, 'the checking verdict')
  } finally {
    actor.stop()
  }
  return events[0]!
}

describe('checking: publish size', () => {
  test('refuses a publish over the gas limit with PUBLISH_TOO_LARGE before any upload', async () => {
    // 30,000 attested bytes is over 16M gas at what EAS charges to store them.
    harness.attestedBytes = 30_000
    harness.uploadsSeen.length = 0
    const verdict = await runChecking('tooLarge02')
    expect(verdict.type).toBe('checkingFailed')
    expect(verdict.error).toMatchObject({ code: 'PUBLISH_TOO_LARGE' })
    // Sized with an Arweave id's length standing in for the upload not yet made.
    expect(harness.uploadsSeen[0]).toEqual([
      { seedLocalId: 'image001', itemPropertyName: 'storageTransactionId', txId: expect.stringMatching(/^.{43}$/) },
    ])
  }, TEST_TIMEOUT_MS)

  test('goes ahead with a publish that fits', async () => {
    harness.attestedBytes = 100
    const verdict = await runChecking('fits0001')
    expect(verdict.type).toBe('validPublishProcess')
  }, TEST_TIMEOUT_MS)
})
