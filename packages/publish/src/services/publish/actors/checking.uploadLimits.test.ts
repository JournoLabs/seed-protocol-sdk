import { describe, expect, mock, test } from 'bun:test'
import { createActor, createMachine } from 'xstate'
import { RelatedItemUnpublishedError } from '../../../../../sdk/src/db/read/publishErrors'
import { TEST_TIMEOUT_MS, waitUntilOrThrow } from '../../../../test-utils/waitUntil'
import { UploadNeedsConfirmError, UploadTooLargeError } from '../../../errors'

/**
 * checking refuses a publish over the upload size limit, and holds one over the confirm size
 * until it is given confirmUpload, before registering EAS schemas or reading any file.
 */
const ADDRESS = '0x' + 'e'.repeat(40)
const MIB = 2 ** 20
const harness = { uploadSizes: [] as number[] }
const schemaRegistrations: string[] = []

mock.module('@seedprotocol/sdk', () => ({
  assertLocalDbChain: async () => {},
  isItemOwned: async () => true,
  validateItemForPublish: async () => ({ isValid: true, errors: [] }),
  summarizePublishUploads: async () => ({
    uploadCount: harness.uploadSizes.length,
    uploadBytes: harness.uploadSizes.reduce((a, b) => a + b, 0),
    uploadSizes: harness.uploadSizes,
    unpublishedRelatedItems: [],
  }),
  RelatedItemUnpublishedError,
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
mock.module('../helpers/itemNeedsArweave', () => ({ itemNeedsArweaveUpload: async () => true }))
mock.module('~/config', () => ({ getPublishConfig: () => ({ useModularExecutor: true }) }))
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

describe('checking: upload size limits', () => {
  test('refuses a publish over 100 MiB with UploadTooLargeError, before registering schemas', async () => {
    harness.uploadSizes = [60 * MIB, 50 * MIB]
    schemaRegistrations.length = 0
    const verdict = await runChecking('tooLarge01', { confirmUpload: true })
    expect(verdict.type).toBe('checkingFailed')
    expect(verdict.error).toBeInstanceOf(UploadTooLargeError)
    expect(verdict.error).toMatchObject({ uploadBytes: 110 * MIB, maxUploadBytes: 100 * MIB })
    expect(schemaRegistrations).toEqual([])
  }, TEST_TIMEOUT_MS)

  test('holds a publish over 25 MiB with UploadNeedsConfirmError carrying the estimate', async () => {
    harness.uploadSizes = [30 * MIB]
    schemaRegistrations.length = 0
    const verdict = await runChecking('confirm01')
    expect(verdict.type).toBe('checkingFailed')
    expect(verdict.error).toBeInstanceOf(UploadNeedsConfirmError)
    expect((verdict.error as UploadNeedsConfirmError).estimate).toMatchObject({
      uploadBytes: 30 * MIB,
      largestUploadBytes: 30 * MIB,
      requiresConfirm: true,
    })
    expect(schemaRegistrations).toEqual([])
  }, TEST_TIMEOUT_MS)

  test('goes ahead with confirmUpload', async () => {
    harness.uploadSizes = [30 * MIB]
    const verdict = await runChecking('confirm02', { confirmUpload: true })
    expect(verdict.type).toBe('validPublishProcess')
  }, TEST_TIMEOUT_MS)

  test('goes ahead under the confirm size without confirmUpload', async () => {
    harness.uploadSizes = [MIB]
    const verdict = await runChecking('small01')
    expect(verdict.type).toBe('validPublishProcess')
  }, TEST_TIMEOUT_MS)

  test('uses the limits the publish was created with', async () => {
    harness.uploadSizes = [150 * MIB]
    const verdict = await runChecking('raised01', {
      uploadLimits: { maxUploadBytes: 200 * MIB, confirmUploadAboveBytes: Infinity },
    })
    expect(verdict.type).toBe('validPublishProcess')
  }, TEST_TIMEOUT_MS)
})
