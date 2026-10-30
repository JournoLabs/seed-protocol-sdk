import { describe, expect, test } from 'bun:test'
import { encodeAbiParameters, encodeEventTopics, parseAbi, zeroAddress } from 'viem'
import { easAbi } from '../../../helpers/abi/eas'
import { attributeMultiPublishReceipt } from './multiPublishReceipt'

/**
 * The three-phase multiPublish (SeedProtocolExtension / SeedProtocolExecutor) creates every seed
 * and version first, then attests each request's properties, so EAS's Attested events come in that
 * order. They are the record: the Seed contracts' own events and other accounts' attestations in
 * the same receipt are ignored.
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

const attested = (schemaUID: `0x${string}`, uid: `0x${string}`, attester = ATTESTER, address = EAS) => ({
  address,
  topics: encodeEventTopics({
    abi: easAbi,
    eventName: 'Attested',
    args: { recipient: zeroAddress, attester, schemaUID },
  }),
  data: encodeAbiParameters([{ type: 'bytes32' }], [uid]),
})
/** What any contract can have the shared executor emit, from the executor's own address. */
const executorEvents = parseAbi([
  'event CreatedAttestation((bytes32 schemaUid, bytes32 attestationUid) result)',
  'event SeedPublished(bytes32 seedUid, bytes32 versionUid)',
])
const fakeCreated = (schemaUid: `0x${string}`, attestationUid: `0x${string}`) => ({
  address: CONTRACT,
  topics: encodeEventTopics({ abi: executorEvents, eventName: 'CreatedAttestation' }),
  data: encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }], [schemaUid, attestationUid]),
})
const fakePublished = (seedUid: `0x${string}`, versionUid: `0x${string}`) => ({
  address: CONTRACT,
  topics: encodeEventTopics({ abi: executorEvents, eventName: 'SeedPublished' }),
  data: encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }], [seedUid, versionUid]),
})

/** Phase 1: every seed and version, in request order. */
const creations = [
  attested(SCHEMA_AUTHOR_SEED, AUTHOR_SEED),
  attested(SCHEMA_VERSION, AUTHOR_VERSION),
  attested(SCHEMA_TAG_SEED, TAG_SEED),
  attested(SCHEMA_VERSION, TAG_VERSION),
  attested(SCHEMA_POST_SEED, POST_SEED),
  attested(SCHEMA_VERSION, POST_VERSION),
]
/** Phase 3: each request's properties. */
const properties = [
  attested(SCHEMA_AUTHOR_LATEST, AUTHOR_LATEST),
  attested(SCHEMA_POST_AUTHOR, POST_AUTHOR),
  attested(SCHEMA_POST_TITLE, POST_TITLE),
]

const attribute = (logs: unknown[], batch: typeof requests = requests) =>
  attributeMultiPublishReceipt({
    receipt: { logs: logs as any },
    requests: batch,
    easContractAddress: EAS,
    attester: ATTESTER,
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

const FAKE = h('8')
const OTHER_ACCOUNT = '0x00000000000000000000000000000000000000cc' as `0x${string}`

describe('attributeMultiPublishReceipt: three-phase multiPublish', () => {
  test('each request gets its own uids, the property-less one included', () => {
    expect(attribute([...creations, ...properties])).toEqual(expected)
  })

  test('matches addresses in any case', () => {
    expect(
      attributeMultiPublishReceipt({
        receipt: { logs: [...creations, ...properties] as any },
        requests,
        easContractAddress: EAS.toUpperCase().replace('0X', '0x'),
        attester: ATTESTER.toUpperCase().replace('0X', '0x'),
      }),
    ).toEqual(expected)
  })

  test("another account's attestations in the bundle are not this publish's", () => {
    const logs = [
      attested(SCHEMA_AUTHOR_SEED, FAKE, OTHER_ACCOUNT),
      attested(SCHEMA_VERSION, FAKE, OTHER_ACCOUNT),
      ...creations,
      attested(SCHEMA_POST_TITLE, FAKE, OTHER_ACCOUNT),
      ...properties,
    ]
    expect(attribute(logs)).toEqual(expected)
  })

  test('an attestation on another EAS is ignored', () => {
    const logs = [attested(SCHEMA_AUTHOR_SEED, FAKE, ATTESTER, CONTRACT), ...creations, ...properties]
    expect(attribute(logs)).toEqual(expected)
  })

  test('events from the shared executor are not a record', () => {
    const logs = [
      fakeCreated(SCHEMA_AUTHOR_SEED, FAKE),
      fakeCreated(SCHEMA_VERSION, FAKE),
      fakePublished(FAKE, FAKE),
      ...creations,
      ...properties,
    ]
    expect(attribute(logs)).toEqual(expected)
  })

  test('with only fake events, nothing is recorded', () => {
    const logs = [fakeCreated(SCHEMA_AUTHOR_SEED, FAKE), fakePublished(FAKE, FAKE)]
    const none = { seedUid: undefined, versionUid: undefined, propertyPairs: [] }
    expect(attribute(logs)).toEqual([none, none, none])
  })

  test('a supplied seed or version takes no event', () => {
    const patch = { ...requests[0]!, seedUid: AUTHOR_SEED, versionUid: AUTHOR_VERSION }
    expect(attribute([attested(SCHEMA_AUTHOR_LATEST, AUTHOR_LATEST)], [patch])).toEqual([
      {
        propertyPairs: [{ schemaUid: SCHEMA_AUTHOR_LATEST, attestationUid: AUTHOR_LATEST, propertyName: 'latestPost' }],
      },
    ])
  })
})
