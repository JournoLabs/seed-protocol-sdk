import { describe, expect, mock, test } from 'bun:test'
import { encodeAbiParameters, encodeEventTopics, zeroAddress } from 'viem'
import { easAbi } from '../../../helpers/abi/eas'
import { LICENSE_OFFER_SCHEMA_DEF, LICENSE_OFFER_SCHEMA_UID } from '@seedprotocol/eas'
import { SchemaEncoder } from '@ethereum-attestation-service/eas-sdk'

/**
 * createAttestations with a license offer (ADR 0039): the offer goes in the root request of the
 * multiPublish with a zero refUID, and its uid is reported apart from the property uids.
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

const attested = (schemaUID: `0x${string}`, uid: `0x${string}`) => ({
  address: EAS,
  topics: encodeEventTopics({
    abi: easAbi,
    eventName: 'Attested',
    args: { recipient: zeroAddress, attester: PUBLISHER, schemaUID },
  }),
  data: encodeAbiParameters([{ type: 'bytes32' }], [uid]),
})

const OFFER = h('9')

/** As SeedProtocolExtensionBase.multiPublish emits them for [Image, Post], the Post carrying the offer. */
const RECEIPT = {
  logs: [
    attested(SCHEMA_IMAGE_SEED, IMAGE_SEED),
    attested(SCHEMA_VERSION, IMAGE_VERSION),
    attested(SCHEMA_POST_SEED, POST_SEED),
    attested(SCHEMA_VERSION, POST_VERSION),
    attested(SCHEMA_IMAGE_SRC, IMAGE_SRC),
    attested(SCHEMA_POST_TITLE, POST_TITLE),
    attested(LICENSE_OFFER_SCHEMA_UID as `0x${string}`, OFFER),
  ],
}

const updateVersionUid = mock(async (_: unknown) => {})
const applyPropertyAttestationUidsFromPublish = mock(async (_: unknown) => {})
// The real one writes them in one transaction; here it hands each to its mock
const recordPublishRequests = mock(async (records: Array<{ version?: unknown; properties?: unknown }>) => {
  for (const { version, properties } of records) {
    if (version) await updateVersionUid(version)
    if (properties) await applyPropertyAttestationUidsFromPublish(properties)
  }
})
const openAttempts: Array<Record<string, unknown>> = []
const sendTransaction = mock(async () => ({ transactionHash: '0x01' }))
const relatedImage = {
  seedLocalId: 'imageLocal2',
  seedUid: undefined as string | undefined,
  persistSeedUid: mock(async (_publisher?: string, _ms?: number) => {}),
}
/** The publishing item as Item.find loads it, for a publish restored with the item as plain data. */
let reloadedPost: Record<string, unknown> | undefined
const itemFind = mock(async (q: { seedLocalId?: string }) =>
  q.seedLocalId === relatedImage.seedLocalId
    ? relatedImage
    : q.seedLocalId === 'postLocal02'
      ? reloadedPost
      : undefined,
)

/** What each send claimed its attempt with: the requests as sent. */
const claimed: unknown[] = []
mock.module('@seedprotocol/sdk', () => ({
  ...realSdk,
  claimPublishAttempt: async (claim: unknown) => {
    claimed.push(claim)
    return undefined
  },
  findOpenPublishAttempts: async () => openAttempts,
  updatePublishAttempt: async () => {},
  updateVersionUid,
  applyPropertyAttestationUidsFromPublish,
  recordPublishRequests,
  Item: { find: itemFind },
  clearHtmlEmbeddedImageCoPublishRows: async () => {},
}))
mock.module('../../../config', () => ({
  ...realConfig,
  getPublishConfig: () => ({ useModularExecutor: false, easContractAddress: EAS }),
}))
mock.module('../../../helpers/chainClient', () => ({
  ...realChainClient,
  getPublishBlockNumber: async () => 100n,
  isContractDeployed: async () => true,
  waitForPublishReceipt: async () => RECEIPT,
  getPublishPublicClient: () => ({ readContract: async () => 0n }),
}))
mock.module('../helpers/receiptAttestationMs', () => ({
  attestationMsFromReceipt: async () => 1_700_000_000_000,
}))
const ensureEasSchemasForItem = mock(async () => {})
mock.module('../helpers/ensureEasSchemas', () => ({ ensureEasSchemasForItem }))
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
/** Set to the EntryPoint when the publish wallet's sender pins its nonce. */
let pinsNonceOn: string | undefined
mock.module('../../../helpers/resolvePublishWallet', () => ({
  resolvePublishWallet: () => ({
    txSender: { address: PUBLISHER, sendTransaction, ...(pinsNonceOn && { pinsNonceOn }) },
  }),
}))
mock.module('../../../helpers/multiPublishRoute', () => ({ assertMultiPublishRouted: async () => {} }))
const realPublishGas = await import('../../../helpers/publishGas')
mock.module('../../../helpers/publishGas', () => ({
  ...realPublishGas,
  publishGasLimit: async () => 1_234_567n,
  publishGasCeiling: async () => 16_000_000n,
  estimatePublishGas: async () => undefined,
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

const TERMS = `0x${'ab'.repeat(32)}`

describe('createAttestations: a license offer', () => {
  test('goes in the root request, after its properties, and is not recorded as a property', async () => {
    claimed.length = 0
    applyPropertyAttestationUidsFromPublish.mockClear()
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
          licenseOffer: { termsHash: TERMS, spdx: 'CC-BY-4.0' },
        } as any,
        event: {},
      },
    })
    actor.start()
    const result = await toPromise(actor)

    const sent = JSON.parse(JSON.stringify(claimed, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)))
    const requestsSent = JSON.parse(sent[0].requests)
    const [image, post] = requestsSent
    expect(image.listOfAttestations.map((a: any) => a.schema)).toEqual([SCHEMA_IMAGE_SRC])
    expect(post.listOfAttestations.map((a: any) => a.schema)).toEqual([SCHEMA_POST_TITLE, LICENSE_OFFER_SCHEMA_UID])
    const offer = post.listOfAttestations[1].data[0]
    expect(offer.refUID).toBe(ZERO)
    const fields = new SchemaEncoder(LICENSE_OFFER_SCHEMA_DEF).decodeData(offer.data)
    expect(fields.find((f) => f.name === 'terms_hash')?.value.value).toBe(TERMS)
    expect(fields.find((f) => f.name === 'spdx')?.value.value).toBe('CC-BY-4.0')

    const postPairs = applyPropertyAttestationUidsFromPublish.mock.calls
      .map(([a]) => a as any)
      .find((a) => a.seedLocalId === 'postLocal02')!.pairs
    expect(postPairs.map((p: any) => p.attestationUid)).toEqual([POST_TITLE])

    expect(result.publishedBatch?.licenseOfferUid).toBe(OFFER)
    expect(result.publishedBatch?.attestationUids).toContain(OFFER)
  })

  test('without the option the request carries no offer', async () => {
    claimed.length = 0
    const item = {
      seedLocalId: 'postLocal02',
      seedUid: undefined as string | undefined,
      getPublishUploads: async () => [],
      getPublishPayload: async () => requests(),
      persistSeedUid: mock(async (_publisher?: string, _ms?: number) => {}),
    }
    const actor = createActor(createAttestations, {
      input: {
        context: { address: PUBLISHER, account: {}, item, arweaveTransactions: [], publishUploads: [], publishMode: 'patch' } as any,
        event: {},
      },
    })
    actor.start()
    const result = await toPromise(actor)
    const requestsSent = JSON.parse((claimed[0] as any).requests)
    expect(requestsSent[1].listOfAttestations).toHaveLength(1)
    expect(result.publishedBatch?.licenseOfferUid).toBeUndefined()
  })
})
