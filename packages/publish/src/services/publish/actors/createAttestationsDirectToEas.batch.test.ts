import { describe, expect, mock, test } from 'bun:test'

/**
 * createAttestationsDirectToEas: an Image published together with the Post that shows it, the Image
 * being request [0]. Each request records its own seed, version and property uids; the publishing
 * item gets the Post's seed and the related Image records its own.
 */

// Real modules first (they import the real SDK, config and EAS helpers), then the mocks spread over them.
const realSdk = await import('@seedprotocol/sdk')
const realChainClient = await import('../../../helpers/chainClient')
const realEasDirect = await import('../../../helpers/easDirect')
const realConfig = await import('../../../config')

const EAS = '0x00000000000000000000000000000000000000eb' as `0x${string}`
const PUBLISHER = '0x00000000000000000000000000000000000000cd' as `0x${string}`
const ZERO = `0x${'0'.repeat(64)}`
const h = (c: string) => `0x${c.repeat(64)}` as `0x${string}`

const SCHEMA_IMAGE_SEED = h('1')
const SCHEMA_POST_SEED = h('2')
const SCHEMA_VERSION = h('3')
const SCHEMA_IMAGE_SRC = h('4')
const SCHEMA_POST_TITLE = h('5')

const IMAGE_SEED = h('6')
const IMAGE_VERSION = h('7')
const IMAGE_SRC = h('8')
const POST_SEED = h('9')
const POST_VERSION = h('a')
const POST_TITLE = h('b')

/** What each attestation transaction creates, keyed by schema (Seed) or by the seed it references (Version). */
const SEED_BY_SCHEMA: Record<string, string> = { [SCHEMA_IMAGE_SEED]: IMAGE_SEED, [SCHEMA_POST_SEED]: POST_SEED }
const VERSION_BY_SEED: Record<string, string> = { [IMAGE_SEED]: IMAGE_VERSION, [POST_SEED]: POST_VERSION }
const PROPERTY_BY_SCHEMA: Record<string, string> = { [SCHEMA_IMAGE_SRC]: IMAGE_SRC, [SCHEMA_POST_TITLE]: POST_TITLE }

type FakeTx =
  | { kind: 'attest'; schema: string; refUID: string }
  | { kind: 'multi'; schemas: string[] }
const sentTxs = new Map<string, FakeTx>()
const receiptMs = new Map<string, number>()

const updateVersionUid = mock(async (_: unknown) => {})
const applyPropertyAttestationUidsFromPublish = mock(async (_: unknown) => {})
const relatedImage = {
  seedLocalId: 'imageLocalD',
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
mock.module('../../../helpers/easDirect', () => ({
  ...realEasDirect,
  prepareEasAttest: (p: { schema: string; data: { refUID: string } }) =>
    ({ kind: 'attest', schema: p.schema, refUID: p.data.refUID }) as unknown,
  prepareEasMultiAttest: (reqs: Array<{ schema: string; data: unknown[] }>) =>
    ({ kind: 'multi', schemas: reqs.flatMap((r) => r.data.map(() => r.schema)) }) as unknown,
  getAttestationUidFromReceipt: (receipt: { hash: string }) => {
    const tx = sentTxs.get(receipt.hash)
    if (tx?.kind !== 'attest') return undefined
    return SEED_BY_SCHEMA[tx.schema] ?? VERSION_BY_SEED[tx.refUID]
  },
  getAttestedUidsFromReceipt: (receipt: { hash: string }) => {
    const tx = sentTxs.get(receipt.hash)
    if (tx?.kind !== 'multi') return []
    return tx.schemas.map((schemaUid) => ({ schemaUid, uid: PROPERTY_BY_SCHEMA[schemaUid]! }))
  },
}))
mock.module('../../../config', () => ({
  ...realConfig,
  getPublishConfig: () => ({ useModularExecutor: false, easContractAddress: EAS }),
}))
mock.module('../../../helpers/chainClient', () => ({
  ...realChainClient,
  waitForPublishReceipt: async (hash: string) => ({ hash }),
}))
mock.module('../helpers/receiptAttestationMs', () => ({
  attestationMsFromReceipt: async (receipt: { hash: string }) => receiptMs.get(receipt.hash) ?? 0,
}))
mock.module('../helpers/ensureEasSchemas', () => ({ ensureEasSchemasForItem: async () => {} }))
mock.module('../helpers/verifyArweaveTransactionsExist', () => ({
  verifyArweaveTransactionsExist: async () => {},
}))
mock.module('../helpers/verifyAttestations', () => ({ verifyAttestations: async () => {} }))
mock.module('../../../helpers/resolvePublishWallet', () => ({
  resolvePublishWallet: () => ({
    txSender: {
      address: PUBLISHER,
      sendTransaction: async (tx: FakeTx) => {
        const hash = `0xtx${sentTxs.size + 1}`
        sentTxs.set(hash, tx)
        receiptMs.set(hash, 1_700_000_000_000 + sentTxs.size * 1000)
        return { transactionHash: hash }
      },
    },
  }),
}))
mock.module('../../arweaveL1Finalize/enqueue', () => ({
  enqueueArweaveL1FinalizeJobsFromPublishContext: async () => {},
}))

const { createAttestationsDirectToEas } = await import('./createAttestationsDirectToEas')
const { createActor, toPromise } = await import('xstate')

const attestation = (schema: string, name: string) => ({
  schema,
  data: [
    {
      recipient: '0x0000000000000000000000000000000000000000',
      expirationTime: 0n,
      revocable: true,
      refUID: ZERO,
      data: '0x1234',
      value: 0n,
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
    localId: 'postLocalD1',
    seedUid: ZERO,
    seedSchemaUid: SCHEMA_POST_SEED,
    versionUid: ZERO,
    versionSchemaUid: SCHEMA_VERSION,
    seedIsRevocable: true,
    listOfAttestations: [attestation(SCHEMA_POST_TITLE, 'title')],
    propertiesToUpdate: [],
  },
]

describe('createAttestationsDirectToEas: related items published with the item', () => {
  test('every request records its own seed, version and property uids', async () => {
    const item = {
      seedLocalId: 'postLocalD1',
      seedUid: undefined as string | undefined,
      getPublishUploads: async () => [],
      getPublishPayload: async () => requests(),
      persistSeedUid: mock(async (_publisher?: string, _ms?: number) => {}),
    }
    const actor = createActor(createAttestationsDirectToEas, {
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

    const versions = Object.fromEntries(
      updateVersionUid.mock.calls.map(([a]) => [(a as any).seedLocalId, (a as any).versionUid]),
    )
    expect(versions).toEqual({ imageLocalD: IMAGE_VERSION, postLocalD1: POST_VERSION })

    const properties = Object.fromEntries(
      applyPropertyAttestationUidsFromPublish.mock.calls.map(([a]) => [
        (a as any).seedLocalId,
        { versionUid: (a as any).versionUid, uids: (a as any).pairs.map((p: any) => p.attestationUid) },
      ]),
    )
    expect(properties).toEqual({
      imageLocalD: { versionUid: IMAGE_VERSION, uids: [IMAGE_SRC] },
      postLocalD1: { versionUid: POST_VERSION, uids: [POST_TITLE] },
    })

    // Seeds: the publishing item gets the Post seed; the related Image (request [0]) records its own,
    // each with the time of the transaction that created it (Image seed: tx 1, Post seed: tx 4).
    expect(item.seedUid).toBe(POST_SEED)
    expect(item.persistSeedUid).toHaveBeenCalledTimes(1)
    expect(item.persistSeedUid.mock.calls[0]).toEqual([PUBLISHER, 1_700_000_004_000])
    expect(relatedImage.seedUid).toBe(IMAGE_SEED)
    expect(relatedImage.persistSeedUid).toHaveBeenCalledTimes(1)
    expect(relatedImage.persistSeedUid.mock.calls[0]).toEqual([PUBLISHER, 1_700_000_001_000])

    expect(result.publishedBatch?.seedUid?.toLowerCase()).toBe(POST_SEED)
  })
})
