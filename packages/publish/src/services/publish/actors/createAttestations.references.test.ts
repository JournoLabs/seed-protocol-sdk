import { describe, expect, mock, test } from 'bun:test'
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  stringToHex,
} from 'viem'
import { multiPublishAbi, publisherEventsAbi } from '../../../helpers/abi/publisher'

/**
 * createAttestations with a draft relation: a Post whose author is an Identity published with it.
 * The contract creates every seed before it attests any property, so both go in one transaction,
 * with the author slot holding the Identity's placeholder for the contract to fill.
 */

const realSdk = await import('@seedprotocol/sdk')
const realConfig = await import('../../../config')
const realChainClient = await import('../../../helpers/chainClient')

const EAS = '0x00000000000000000000000000000000000000ea' as `0x${string}`
const PUBLISHER = '0x00000000000000000000000000000000000000cc' as `0x${string}`
const ZERO = `0x${'0'.repeat(64)}`
const h = (c: string) => `0x${c.repeat(64)}` as `0x${string}`

const SCHEMA_IDENTITY_SEED = h('1')
const SCHEMA_POST_SEED = h('2')
const SCHEMA_VERSION = h('3')
const SCHEMA_IDENTITY_NAME = h('4')
const SCHEMA_POST_AUTHOR = h('5')

const IDENTITY_SEED = h('a')
const IDENTITY_VERSION = h('b')
const IDENTITY_NAME = h('c')
const POST_SEED = h('d')
const POST_VERSION = h('e')
const POST_AUTHOR = h('f')

const IDENTITY = 'identLocal01'
const POST = 'postLocal001'

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

/** As the extension emits them for [Identity, Post]: every seed and version, then each request's properties. */
const RECEIPT = {
  logs: [
    created(SCHEMA_IDENTITY_SEED, IDENTITY_SEED),
    created(SCHEMA_VERSION, IDENTITY_VERSION),
    created(SCHEMA_POST_SEED, POST_SEED),
    created(SCHEMA_VERSION, POST_VERSION),
    seedPublished([IDENTITY_NAME]),
    seedPublished([POST_AUTHOR]),
  ],
}

const sendTransaction = mock(async (_tx: { data: `0x${string}` }) => ({ transactionHash: '0x01' }))
const identity = {
  seedLocalId: IDENTITY,
  seedUid: undefined as string | undefined,
  persistSeedUid: mock(async (_publisher?: string, _ms?: number) => {}),
}

mock.module('@seedprotocol/sdk', () => ({
  ...realSdk,
  recordPublishRequest: async () => {},
  Item: { find: async (q: { seedLocalId?: string }) => (q.seedLocalId === IDENTITY ? identity : undefined) },
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
  resolvePublishWallet: () => ({ txSender: { address: PUBLISHER, sendTransaction } }),
}))
mock.module('../../arweaveL1Finalize/enqueue', () => ({
  enqueueArweaveL1FinalizeJobsFromPublishContext: async () => {},
}))

const { createAttestations } = await import('./createAttestations')
const { createActor, toPromise } = await import('xstate')

const entry = (data: string) => ({
  recipient: '0x0000000000000000000000000000000000000000',
  expirationTime: 0,
  revocable: true,
  refUID: ZERO,
  data,
  value: 0,
})

/** As getPublishPayload builds them: the Identity first, its seed filling the Post's author. */
const requests = () => [
  {
    localId: IDENTITY,
    seedUid: ZERO,
    seedSchemaUid: SCHEMA_IDENTITY_SEED,
    versionUid: ZERO,
    versionSchemaUid: SCHEMA_VERSION,
    seedIsRevocable: true,
    listOfAttestations: [
      { schema: SCHEMA_IDENTITY_NAME, data: [entry(encodeAbiParameters([{ type: 'string' }], ['Ada']))], _propertyName: 'name' },
    ],
    propertiesToUpdate: [{ publishLocalId: POST, propertySchemaUid: SCHEMA_POST_AUTHOR }],
  },
  {
    localId: POST,
    seedUid: ZERO,
    seedSchemaUid: SCHEMA_POST_SEED,
    versionUid: ZERO,
    versionSchemaUid: SCHEMA_VERSION,
    seedIsRevocable: true,
    listOfAttestations: [
      {
        schema: SCHEMA_POST_AUTHOR,
        data: [entry(stringToHex(IDENTITY, { size: 32 }))],
        _propertyName: 'author',
        _unresolvedValue: IDENTITY,
        _easDataType: 'bytes32',
        _schemaDef: 'bytes32 author',
        _propertyNameForSchema: 'author',
      },
    ],
    propertiesToUpdate: [],
  },
]

describe('createAttestations: a draft relation', () => {
  test('publishes both items in one transaction, the author slot holding the Identity placeholder', async () => {
    const item = {
      seedLocalId: POST,
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
    await toPromise(actor)

    expect(sendTransaction).toHaveBeenCalledTimes(1)
    const { args } = decodeFunctionData({ abi: multiPublishAbi, data: sendTransaction.mock.calls[0]![0].data })
    const [sentIdentity, sentPost] = args[0]
    expect(sentIdentity.localId).toBe(IDENTITY)
    expect(sentIdentity.propertiesToUpdate).toEqual([
      { publishIndex: 1n, propertySchemaUid: SCHEMA_POST_AUTHOR, listElement: false, elementIndex: 0n },
    ])
    expect(sentPost.listOfAttestations[0]!.data[0]!.data).toBe(`0x${'0'.repeat(63)}1`)

    expect(item.seedUid).toBe(POST_SEED)
    expect(identity.seedUid).toBe(IDENTITY_SEED)
  })
})
