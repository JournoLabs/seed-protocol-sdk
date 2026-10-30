import { describe, expect, test } from 'bun:test'
import { encodeAbiParameters, encodeEventTopics, zeroAddress } from 'viem'
import { executorEventsAbi } from '../../../helpers/abi/executor'
import { publisherEventsAbi } from '../../../helpers/abi/publisher'
import { easAbi } from '../../../helpers/abi/eas'
import { attributeMultiPublishReceipt } from './multiPublishReceipt'

/**
 * The three-phase multiPublish (SeedProtocolExtension / SeedProtocolExecutor) creates every seed
 * and version first, then attests each request's properties. So a receipt holds all creations,
 * then each request's property attestations and SeedPublished. The extension emits SeedPublished
 * for every request; the executor only for one with properties.
 *
 * The batch: an Author and a Post that name each other (a cycle), and a Tag with no properties
 * between them.
 */

const CONTRACT = '0x00000000000000000000000000000000000000aa' as `0x${string}`
const EAS = '0x00000000000000000000000000000000000000ea' as `0x${string}`
const ATTESTER = '0x00000000000000000000000000000000000000bb' as `0x${string}`
const ZERO = `0x${'0'.repeat(64)}` as `0x${string}`
const h = (c: string) => `0x${c.repeat(64)}` as `0x${string}`

const SCHEMA_AUTHOR_SEED = h('1')
const SCHEMA_TAG_SEED = h('2')
const SCHEMA_POST_SEED = h('3')
const SCHEMA_VERSION = h('4')
const SCHEMA_AUTHOR_LATEST = h('5')
const SCHEMA_POST_AUTHOR = h('6')
const SCHEMA_POST_TITLE = h('7')

const AUTHOR_SEED = h('a')
const AUTHOR_VERSION = h('b')
const TAG_SEED = h('c')
const TAG_VERSION = h('d')
const POST_SEED = h('e')
const POST_VERSION = h('f')
const AUTHOR_LATEST = `0x${'9'.repeat(63)}1` as `0x${string}`
const POST_AUTHOR = `0x${'9'.repeat(63)}2` as `0x${string}`
const POST_TITLE = `0x${'9'.repeat(63)}3` as `0x${string}`

const att = (schema: `0x${string}`, name: string) => ({ schema, data: [{ data: '0x' }], _propertyName: name })
const request = (localId: string, seedSchemaUid: `0x${string}`, listOfAttestations: ReturnType<typeof att>[]) => ({
  localId,
  seedUid: ZERO,
  seedSchemaUid,
  versionUid: ZERO,
  versionSchemaUid: SCHEMA_VERSION,
  listOfAttestations,
})
const requests = [
  request('authorLocal1', SCHEMA_AUTHOR_SEED, [att(SCHEMA_AUTHOR_LATEST, 'latestPost')]),
  request('tagLocal0001', SCHEMA_TAG_SEED, []),
  request('postLocal001', SCHEMA_POST_SEED, [att(SCHEMA_POST_AUTHOR, 'author'), att(SCHEMA_POST_TITLE, 'title')]),
]

const created = (abi: typeof executorEventsAbi | typeof publisherEventsAbi, schemaUid: `0x${string}`, attestationUid: `0x${string}`) => ({
  address: CONTRACT,
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
const executorPublished = (seedUid: `0x${string}`, versionUid: `0x${string}`) => ({
  address: CONTRACT,
  topics: encodeEventTopics({ abi: executorEventsAbi, eventName: 'SeedPublished' }),
  data: encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }], [seedUid, versionUid]),
})
const extensionPublished = (uids: `0x${string}`[]) => ({
  address: CONTRACT,
  topics: encodeEventTopics({ abi: publisherEventsAbi, eventName: 'SeedPublished' }),
  data: encodeAbiParameters([{ type: 'bytes' }], [encodeAbiParameters([{ type: 'bytes32[]' }], [uids])]),
})

/** Phase 1: every seed and version, in request order, each with EAS's Attested and the contract's CreatedAttestation. */
const creations = (abi: typeof executorEventsAbi | typeof publisherEventsAbi) =>
  (
    [
      [SCHEMA_AUTHOR_SEED, AUTHOR_SEED],
      [SCHEMA_VERSION, AUTHOR_VERSION],
      [SCHEMA_TAG_SEED, TAG_SEED],
      [SCHEMA_VERSION, TAG_VERSION],
      [SCHEMA_POST_SEED, POST_SEED],
      [SCHEMA_VERSION, POST_VERSION],
    ] as const
  ).flatMap(([schema, uid]) => [attested(schema, uid), created(abi, schema, uid)])

const attribute = (logs: unknown[], useModularExecutor: boolean) =>
  attributeMultiPublishReceipt({
    receipt: { logs: logs as any },
    requests,
    useModularExecutor,
    easContractAddress: EAS,
    contractAddressForEvents: CONTRACT,
  })

const expected = [
  {
    seedUid: AUTHOR_SEED,
    versionUid: AUTHOR_VERSION,
    propertyPairs: [{ schemaUid: SCHEMA_AUTHOR_LATEST, attestationUid: AUTHOR_LATEST, propertyName: 'latestPost' }],
  },
  { seedUid: TAG_SEED, versionUid: TAG_VERSION, propertyPairs: [] },
  {
    seedUid: POST_SEED,
    versionUid: POST_VERSION,
    propertyPairs: [
      { schemaUid: SCHEMA_POST_AUTHOR, attestationUid: POST_AUTHOR, propertyName: 'author' },
      { schemaUid: SCHEMA_POST_TITLE, attestationUid: POST_TITLE, propertyName: 'title' },
    ],
  },
]

describe('attributeMultiPublishReceipt: three-phase multiPublish', () => {
  test('extension: SeedPublished for every request, the property-less one included', () => {
    const logs = [
      ...creations(publisherEventsAbi),
      attested(SCHEMA_AUTHOR_LATEST, AUTHOR_LATEST),
      extensionPublished([AUTHOR_LATEST]),
      extensionPublished([]),
      attested(SCHEMA_POST_AUTHOR, POST_AUTHOR),
      attested(SCHEMA_POST_TITLE, POST_TITLE),
      extensionPublished([POST_AUTHOR, POST_TITLE]),
    ]
    expect(attribute(logs, false)).toMatchObject(expected)
  })

  test('executor: no SeedPublished for the property-less request', () => {
    const logs = [
      ...creations(executorEventsAbi),
      attested(SCHEMA_AUTHOR_LATEST, AUTHOR_LATEST),
      executorPublished(AUTHOR_SEED, AUTHOR_VERSION),
      attested(SCHEMA_POST_AUTHOR, POST_AUTHOR),
      attested(SCHEMA_POST_TITLE, POST_TITLE),
      executorPublished(POST_SEED, POST_VERSION),
    ]
    expect(attribute(logs, true)).toMatchObject(expected)
  })
})
