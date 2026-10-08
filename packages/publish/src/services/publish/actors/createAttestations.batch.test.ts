import { describe, expect, mock, test } from 'bun:test'
import { encodeAbiParameters, encodeEventTopics } from 'viem'
import { publisherEventsAbi } from '../../../helpers/abi/publisher'

/**
 * createAttestations, one-transaction path: an Image published together with the Post that shows
 * it. Every request records its own seed uid, version uid and property uids, matched to its own
 * events, and the publishing item gets its own seed uid (not the first request's).
 */

// Real modules first (they import the real SDK and config), then the mocks spread over them.
const realSdk = await import('@seedprotocol/sdk')
const realConfig = await import('../../../config')
const realChainClient = await import('../../../helpers/chainClient')

const EAS = '0x00000000000000000000000000000000000000ea' as `0x${string}`
const PUBLISHER = '0x00000000000000000000000000000000000000cc' as `0x${string}`
const ZERO = `0x${'0'.repeat(64)}`
const h = (c: string) => `0x${c.repeat(64)}` as `0x${string}`

const SCHEMA_IMAGE_SEED = h('1')
const SCHEMA_POST_SEED = h('2')
const SCHEMA_VERSION = h('3')
const SCHEMA_IMAGE_SRC = h('4')
const SCHEMA_POST_TITLE = h('5')

const IMAGE_SEED = h('a')
const IMAGE_VERSION = h('b')
const IMAGE_SRC = h('c')
const POST_SEED = h('d')
const POST_VERSION = h('e')
const POST_TITLE = h('f')

const created = (schemaUid: `0x${string}`, attestationUid: `0x${string}`) => ({
  address: PUBLISHER,
  topics: encodeEventTopics({ abi: publisherEventsAbi, eventName: 'CreatedAttestation' }),
  data: encodeAbiParameters(
    [
      {
        type: 'tuple',
        components: [
          { name: 'schemaUid', type: 'bytes32' },
          { name: 'attestationUid', type: 'bytes32' },
        ],
      },
    ],
    [{ schemaUid, attestationUid }],
  ),
})
const seedPublished = (uids: `0x${string}`[]) => ({
  address: PUBLISHER,
  topics: encodeEventTopics({ abi: publisherEventsAbi, eventName: 'SeedPublished' }),
  data: encodeAbiParameters([{ type: 'bytes' }], [encodeAbiParameters([{ type: 'bytes32[]' }], [uids])]),
})

/** As SeedProtocolExtensionBase.multiPublish emits them for [Image, Post]. */
const RECEIPT = {
  logs: [
    created(SCHEMA_IMAGE_SEED, IMAGE_SEED),
    created(SCHEMA_VERSION, IMAGE_VERSION),
    seedPublished([IMAGE_SRC]),
    created(SCHEMA_POST_SEED, POST_SEED),
    created(SCHEMA_VERSION, POST_VERSION),
    seedPublished([POST_TITLE]),
  ],
}

const updateVersionUid = mock(async (_: unknown) => {})
const applyPropertyAttestationUidsFromPublish = mock(async (_: unknown) => {})
const relatedImage = {
  seedLocalId: 'imageLocal2',
  seedUid: undefined as string | undefined,
  persistSeedUid: mock(async (_publisher?: string, _ms?: number) => {}),
}
const itemFind = mock(async (q: { seedLocalId?: string }) =>
  q.seedLocalId === relatedImage.seedLocalId ? relatedImage : undefined,
)

mock.module('@seedprotocol/sdk', () => ({
  ...realSdk,
  updateVersionUid,
  applyPropertyAttestationUidsFromPublish,
  Item: { find: itemFind },
  clearHtmlEmbeddedImageCoPublishRows: async () => {},
}))
mock.module('../../../config', () => ({
  ...realConfig,
  getPublishConfig: () => ({ useModularExecutor: false, easContractAddress: EAS }),
}))
mock.module('../../../helpers/chainClient', () => ({
  ...realChainClient,
  isContractDeployed: async () => true,
  waitForPublishReceipt: async () => RECEIPT,
}))
mock.module('../helpers/receiptAttestationMs', () => ({
  attestationMsFromReceipt: async () => 1_700_000_000_000,
}))
mock.module('../helpers/ensureEasSchemas', () => ({ ensureEasSchemasForItem: async () => {} }))
mock.module('../helpers/verifyArweaveTransactionsExist', () => ({
  verifyArweaveTransactionsExist: async () => {},
}))
mock.module('../../../helpers/ensureManagedAccountEasConfigured', () => ({
  ensureManagedAccountEasConfigured: async () => {},
  assertManagedAccountEasMatchesConfig: async () => {},
}))
mock.module('../../../helpers/executorModuleReadiness', () => ({
  simulateCallFromAccount: async () => {},
  assertExecutorModuleReadyForAccount: async () => {},
}))
mock.module('../../../helpers/resolvePublishWallet', () => ({
  resolvePublishWallet: () => ({
    txSender: { address: PUBLISHER, sendTransaction: async () => ({ transactionHash: '0x01' }) },
  }),
}))
mock.module('../../arweaveL1Finalize/enqueue', () => ({
  enqueueArweaveL1FinalizeJobsFromPublishContext: async () => {},
}))

const { createAttestations } = await import('./createAttestations')
const { createActor, toPromise } = await import('xstate')

const attestation = (schema: string, name: string) => ({
  schema,
  data: [
    {
      recipient: '0x0000000000000000000000000000000000000000',
      expirationTime: 0,
      revocable: true,
      refUID: ZERO,
      data: '0x1234',
      value: 0,
    },
  ],
  _propertyName: name,
})

const requests = () => [
  {
    localId: relatedImage.seedLocalId,
    seedUid: ZERO,
    seedSchemaUid: SCHEMA_IMAGE_SEED,
    versionUid: ZERO,
    versionSchemaUid: SCHEMA_VERSION,
    seedIsRevocable: true,
    listOfAttestations: [attestation(SCHEMA_IMAGE_SRC, 'storageTransactionId')],
    propertiesToUpdate: [],
  },
  {
    localId: 'postLocal02',
    seedUid: ZERO,
    seedSchemaUid: SCHEMA_POST_SEED,
    versionUid: ZERO,
    versionSchemaUid: SCHEMA_VERSION,
    seedIsRevocable: true,
    listOfAttestations: [attestation(SCHEMA_POST_TITLE, 'title')],
    propertiesToUpdate: [],
  },
]

describe('createAttestations: related items published in the same transaction', () => {
  test('every request records its own seed, version and property uids', async () => {
    const item = {
      seedLocalId: 'postLocal02',
      seedUid: undefined as string | undefined,
      getPublishUploads: async () => [],
      getPublishPayload: async () => requests(),
      persistSeedUid: mock(async (_publisher?: string, _ms?: number) => {}),
    }
    const actor = createActor(createAttestations, {
      input: {
        context: {
          address: PUBLISHER,
          account: {},
          item,
          arweaveTransactions: [],
          publishUploads: [],
          publishMode: 'patch',
        } as any,
        event: {},
      },
    })
    actor.start()
    const result = await toPromise(actor)

    // Versions: each item its own.
    const versions = Object.fromEntries(
      updateVersionUid.mock.calls.map(([a]) => [(a as any).seedLocalId, (a as any).versionUid]),
    )
    expect(versions).toEqual({ imageLocal2: IMAGE_VERSION, postLocal02: POST_VERSION })

    // Properties: each item's own uids, on its own version.
    const properties = Object.fromEntries(
      applyPropertyAttestationUidsFromPublish.mock.calls.map(([a]) => [
        (a as any).seedLocalId,
        { versionUid: (a as any).versionUid, uids: (a as any).pairs.map((p: any) => p.attestationUid) },
      ]),
    )
    expect(properties).toEqual({
      imageLocal2: { versionUid: IMAGE_VERSION, uids: [IMAGE_SRC] },
      postLocal02: { versionUid: POST_VERSION, uids: [POST_TITLE] },
    })

    // Seeds: the publishing item gets the Post seed; the related Image records its own.
    expect(item.seedUid).toBe(POST_SEED)
    expect(item.persistSeedUid).toHaveBeenCalledTimes(1)
    expect(relatedImage.seedUid).toBe(IMAGE_SEED)
    expect(relatedImage.persistSeedUid).toHaveBeenCalledTimes(1)
    expect(relatedImage.persistSeedUid.mock.calls[0]![0]).toBe(PUBLISHER)

    expect(result.publishedBatch?.seedUid?.toLowerCase()).toBe(POST_SEED)
  })
})
