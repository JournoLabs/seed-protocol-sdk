import { describe, expect, mock, test } from 'bun:test'
import { encodeAbiParameters, encodeEventTopics, zeroAddress } from 'viem'
import { executorEventsAbi } from '../../../helpers/abi/executor'
import { publisherEventsAbi } from '../../../helpers/abi/publisher'
import { easAbi } from '../../../helpers/abi/eas'

/**
 * Several items published in one multiPublish transaction: each item's property uids are recorded
 * against its own version, from its own events (not the first SeedPublished/version of the batch).
 */
// Loaded before the SDK mock below: config imports the real SDK.
const realConfig = await import('../../../config')
const applyPropertyAttestationUidsFromPublish = mock(async (_: unknown) => {})

mock.module('@seedprotocol/sdk', () => ({
  applyPropertyAttestationUidsFromPublish,
  Item: {},
}))
const EAS = '0x00000000000000000000000000000000000000ea' as `0x${string}`
mock.module('../../../config', () => ({
  ...realConfig,
  getPublishConfig: () => ({ easContractAddress: EAS }),
}))
mock.module('../helpers/receiptAttestationMs', () => ({
  attestationMsFromReceipt: async () => 1_700_000_000_000,
}))

const { persistPropertyMetadataUidsFromContractReceipt } = await import('./persistPropertyMetadataUids')

const MODULE = '0x00000000000000000000000000000000000000aa' as `0x${string}`
const ATTESTER = '0x00000000000000000000000000000000000000bb' as `0x${string}`
const ZERO = `0x${'0'.repeat(64)}`
const h = (c: string) => `0x${c.repeat(64)}` as `0x${string}`

const SCHEMA_IMAGE_SEED = h('1')
const SCHEMA_POST_SEED = h('2')
const SCHEMA_VERSION = h('3')
const SCHEMA_IMAGE_SRC = h('4')
const SCHEMA_POST_TITLE = h('5')
const SCHEMA_POST_COVER = h('6')

const IMAGE_SEED = h('a')
const IMAGE_VERSION = h('b')
const IMAGE_SRC = h('c')
const POST_SEED = h('d')
const POST_VERSION = h('e')
const POST_TITLE = h('f')
const POST_COVER = `0x${'9'.repeat(63)}8` as `0x${string}`

const created = (
  schemaUid: `0x${string}`,
  attestationUid: `0x${string}`,
  abi: typeof executorEventsAbi | typeof publisherEventsAbi = executorEventsAbi,
) => ({
  address: MODULE,
  topics: encodeEventTopics({ abi, eventName: 'CreatedAttestation' }),
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

const attested = (schemaUID: `0x${string}`, uid: `0x${string}`) => ({
  address: EAS,
  topics: encodeEventTopics({
    abi: easAbi,
    eventName: 'Attested',
    args: { recipient: zeroAddress, attester: ATTESTER, schemaUID },
  }),
  data: encodeAbiParameters([{ type: 'bytes32' }], [uid]),
})

const seedPublished = (seedUid: `0x${string}`, versionUid: `0x${string}`) => ({
  address: MODULE,
  topics: encodeEventTopics({ abi: executorEventsAbi, eventName: 'SeedPublished' }),
  data: encodeAbiParameters(
    [
      { type: 'bytes32', name: 'seedUid' },
      { type: 'bytes32', name: 'versionUid' },
    ],
    [seedUid, versionUid],
  ),
})

const extensionSeedPublished = (uids: `0x${string}`[]) => ({
  address: MODULE,
  topics: encodeEventTopics({ abi: publisherEventsAbi, eventName: 'SeedPublished' }),
  data: encodeAbiParameters([{ type: 'bytes' }], [encodeAbiParameters([{ type: 'bytes32[]' }], [uids])]),
})

const att = (schema: `0x${string}`, name: string) => ({ schema, data: [{ data: '0x' }], _propertyName: name })

/** An Image published with the Post that shows it (both new), in the order they are sent. */
const requests = () => [
  {
    localId: 'imageLocal1',
    seedUid: ZERO,
    seedSchemaUid: SCHEMA_IMAGE_SEED,
    versionUid: ZERO,
    versionSchemaUid: SCHEMA_VERSION,
    listOfAttestations: [att(SCHEMA_IMAGE_SRC, 'storageTransactionId')],
  },
  {
    localId: 'postLocal01',
    seedUid: ZERO,
    seedSchemaUid: SCHEMA_POST_SEED,
    versionUid: ZERO,
    versionSchemaUid: SCHEMA_VERSION,
    listOfAttestations: [att(SCHEMA_POST_TITLE, 'title'), att(SCHEMA_POST_COVER, 'coverImage')],
  },
]

const callsBySeed = () =>
  Object.fromEntries(
    applyPropertyAttestationUidsFromPublish.mock.calls.map(([arg]) => {
      const a = arg as { seedLocalId: string; versionUid: string | null; pairs: unknown[] }
      return [a.seedLocalId, { versionUid: a.versionUid, pairs: a.pairs }]
    }),
  )

const expected = {
  imageLocal1: {
    versionUid: IMAGE_VERSION,
    pairs: [{ schemaUid: SCHEMA_IMAGE_SRC, attestationUid: IMAGE_SRC, propertyName: 'storageTransactionId' }],
  },
  postLocal01: {
    versionUid: POST_VERSION,
    pairs: [
      { schemaUid: SCHEMA_POST_TITLE, attestationUid: POST_TITLE, propertyName: 'title' },
      { schemaUid: SCHEMA_POST_COVER, attestationUid: POST_COVER, propertyName: 'coverImage' },
    ],
  },
}

describe('persistPropertyMetadataUidsFromContractReceipt with several items in one transaction', () => {
  test('modular executor: each request gets its own version and property uids', async () => {
    applyPropertyAttestationUidsFromPublish.mockClear()
    // As SeedProtocolExecutor.multiPublish emits them: per request, EAS Attested + CreatedAttestation
    // for the seed and the version, EAS Attested per property, then SeedPublished(seed, version).
    const receipt = {
      logs: [
        attested(SCHEMA_IMAGE_SEED, IMAGE_SEED),
        created(SCHEMA_IMAGE_SEED, IMAGE_SEED),
        attested(SCHEMA_VERSION, IMAGE_VERSION),
        created(SCHEMA_VERSION, IMAGE_VERSION),
        attested(SCHEMA_IMAGE_SRC, IMAGE_SRC),
        seedPublished(IMAGE_SEED, IMAGE_VERSION),
        attested(SCHEMA_POST_SEED, POST_SEED),
        created(SCHEMA_POST_SEED, POST_SEED),
        attested(SCHEMA_VERSION, POST_VERSION),
        created(SCHEMA_VERSION, POST_VERSION),
        attested(SCHEMA_POST_TITLE, POST_TITLE),
        attested(SCHEMA_POST_COVER, POST_COVER),
        seedPublished(POST_SEED, POST_VERSION),
      ],
    }
    await persistPropertyMetadataUidsFromContractReceipt({
      receipt,
      normalizedRequests: requests(),
      useModularExecutor: true,
      contractAddressForEvents: MODULE,
    })
    expect(callsBySeed()).toEqual(expected)
  })

  test('version uid from SeedPublished: the second item gets the second event, not the first', async () => {
    applyPropertyAttestationUidsFromPublish.mockClear()
    // No CreatedAttestation logs: the version uid comes from each request's SeedPublished.
    const receipt = {
      logs: [
        attested(SCHEMA_IMAGE_SEED, IMAGE_SEED),
        attested(SCHEMA_VERSION, IMAGE_VERSION),
        attested(SCHEMA_IMAGE_SRC, IMAGE_SRC),
        seedPublished(IMAGE_SEED, IMAGE_VERSION),
        attested(SCHEMA_POST_SEED, POST_SEED),
        attested(SCHEMA_VERSION, POST_VERSION),
        attested(SCHEMA_POST_TITLE, POST_TITLE),
        attested(SCHEMA_POST_COVER, POST_COVER),
        seedPublished(POST_SEED, POST_VERSION),
      ],
    }
    await persistPropertyMetadataUidsFromContractReceipt({
      receipt,
      normalizedRequests: requests(),
      useModularExecutor: true,
      contractAddressForEvents: MODULE,
    })
    expect(callsBySeed()).toEqual(expected)
  })

  test('ManagedAccount extension: each SeedPublished carries its own request property uids', async () => {
    applyPropertyAttestationUidsFromPublish.mockClear()
    const receipt = {
      logs: [
        created(SCHEMA_IMAGE_SEED, IMAGE_SEED, publisherEventsAbi),
        created(SCHEMA_VERSION, IMAGE_VERSION, publisherEventsAbi),
        extensionSeedPublished([IMAGE_SRC]),
        created(SCHEMA_POST_SEED, POST_SEED, publisherEventsAbi),
        created(SCHEMA_VERSION, POST_VERSION, publisherEventsAbi),
        extensionSeedPublished([POST_TITLE, POST_COVER]),
      ],
    }
    await persistPropertyMetadataUidsFromContractReceipt({
      receipt,
      normalizedRequests: requests(),
      useModularExecutor: false,
      contractAddressForEvents: MODULE,
    })
    expect(callsBySeed()).toEqual(expected)
  })
})
