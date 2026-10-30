import { describe, expect, mock, test } from 'bun:test'
import { encodeAbiParameters, encodeEventTopics, zeroAddress } from 'viem'
import { easAbi } from '../../../helpers/abi/eas'

/**
 * recordMultiPublishReceipt. Several items published in one multiPublish transaction: each item's
 * property uids are recorded against its own version, from its own `Attested` events.
 */
// Loaded before the SDK mock below: config imports the real SDK.
const realConfig = await import('../../../config')
const applyPropertyAttestationUidsFromPublish = mock(async (_: unknown) => {})
const updateVersionUid = mock(async (_: unknown) => {})

mock.module('@seedprotocol/sdk', () => ({
  applyPropertyAttestationUidsFromPublish,
  updateVersionUid,
  // The real one writes both in one transaction; here it hands each to its mock
  recordPublishRequest: async ({ version, properties }: { version?: unknown; properties?: unknown }) => {
    if (version) await updateVersionUid(version)
    if (properties) await applyPropertyAttestationUidsFromPublish(properties)
  },
  // Related seeds are not recorded here (no item found): this file is about properties and versions.
  Item: { find: async () => undefined },
}))
const EAS = '0x00000000000000000000000000000000000000ea' as `0x${string}`
mock.module('../../../config', () => ({
  ...realConfig,
  getPublishConfig: () => ({ easContractAddress: EAS }),
}))
mock.module('../helpers/receiptAttestationMs', () => ({
  attestationMsFromReceipt: async () => 1_700_000_000_000,
}))

const { recordMultiPublishReceipt } = await import('./recordMultiPublishReceipt')

const record = (
  receipt: unknown,
  normalizedRequests: any[],
  resolvedSeedUids?: Record<string, string>,
) =>
  recordMultiPublishReceipt({
    receipt: receipt as any,
    requests: normalizedRequests,
    rootSeedLocalId: 'postLocal01',
    publisherAddress: ATTESTER,
    attester: ATTESTER,
    ...(resolvedSeedUids ? { resolvedSeedUids } : {}),
  })

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

const attested = (schemaUID: `0x${string}`, uid: `0x${string}`) => ({
  address: EAS,
  topics: encodeEventTopics({
    abi: easAbi,
    eventName: 'Attested',
    args: { recipient: zeroAddress, attester: ATTESTER, schemaUID },
  }),
  data: encodeAbiParameters([{ type: 'bytes32' }], [uid]),
})

const att = (schema: `0x${string}`, name: string, metadataLocalId?: string) => ({
  schema,
  data: [{ data: '0x' }],
  _propertyName: name,
  ...(metadataLocalId ? { _metadataLocalId: metadataLocalId } : {}),
})

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
    listOfAttestations: [att(SCHEMA_POST_TITLE, 'title', 'titleRow01'), att(SCHEMA_POST_COVER, 'coverImage')],
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
      // The title row the payload read is recorded by id (audit 1.1).
      {
        schemaUid: SCHEMA_POST_TITLE,
        attestationUid: POST_TITLE,
        propertyName: 'title',
        metadataLocalId: 'titleRow01',
      },
      { schemaUid: SCHEMA_POST_COVER, attestationUid: POST_COVER, propertyName: 'coverImage' },
    ],
  },
}

/** As multiPublish attests them: every seed and version, then each request's properties. */
const RECEIPT = {
  logs: [
    attested(SCHEMA_IMAGE_SEED, IMAGE_SEED),
    attested(SCHEMA_VERSION, IMAGE_VERSION),
    attested(SCHEMA_POST_SEED, POST_SEED),
    attested(SCHEMA_VERSION, POST_VERSION),
    attested(SCHEMA_IMAGE_SRC, IMAGE_SRC),
    attested(SCHEMA_POST_TITLE, POST_TITLE),
    attested(SCHEMA_POST_COVER, POST_COVER),
  ],
}

describe('recordMultiPublishReceipt: properties of several items in one transaction', () => {
  test('each request gets its own version and property uids', async () => {
    applyPropertyAttestationUidsFromPublish.mockClear()
    await record(RECEIPT, requests())
    expect(callsBySeed()).toEqual(expected)
  })

  test('relation/list values: every seed of this transaction and of earlier ones is passed to resolve', async () => {
    applyPropertyAttestationUidsFromPublish.mockClear()
    const EARLIER = h('9')
    await record(RECEIPT, requests(), { earlierLocal: EARLIER })
    const post = applyPropertyAttestationUidsFromPublish.mock.calls
      .map(([a]) => a as { seedLocalId: string; resolvedSeedUids?: Record<string, string> })
      .find((a) => a.seedLocalId === 'postLocal01')
    expect(post?.resolvedSeedUids).toEqual({
      earlierLocal: EARLIER,
      imageLocal1: IMAGE_SEED,
      postLocal01: POST_SEED,
    })
  })
})

describe('recordMultiPublishReceipt: versions', () => {
  const single = (versionUid: string) => [
    {
      localId: 'seedLocal01',
      seedUid: IMAGE_SEED,
      seedSchemaUid: SCHEMA_IMAGE_SEED,
      versionUid,
      versionSchemaUid: SCHEMA_VERSION,
      listOfAttestations: [att(SCHEMA_IMAGE_SRC, 'storageTransactionId')],
    },
  ]

  test('patch publish (request carried the version uid): records no new version', async () => {
    updateVersionUid.mockClear()
    await record({ logs: [attested(SCHEMA_IMAGE_SRC, IMAGE_SRC)] }, single(IMAGE_VERSION))
    expect(updateVersionUid).not.toHaveBeenCalled()
  })

  test('new version (request version uid zero): records the attested version uid', async () => {
    updateVersionUid.mockClear()
    const { requests: out } = await record(
      { logs: [attested(SCHEMA_VERSION, IMAGE_VERSION), attested(SCHEMA_IMAGE_SRC, IMAGE_SRC)] },
      single(ZERO),
    )
    expect(updateVersionUid).toHaveBeenCalledTimes(1)
    expect(updateVersionUid.mock.calls[0]![0]).toMatchObject({
      seedLocalId: 'seedLocal01',
      versionUid: IMAGE_VERSION,
    })
    expect(out[0]!.versionUid).toBe(IMAGE_VERSION)
  })

  test('a batch records each request its own new version', async () => {
    updateVersionUid.mockClear()
    await record(RECEIPT, requests())
    expect(updateVersionUid.mock.calls.map(([a]) => [(a as any).seedLocalId, (a as any).versionUid])).toEqual([
      ['imageLocal1', IMAGE_VERSION],
      ['postLocal01', POST_VERSION],
    ])
  })
})
