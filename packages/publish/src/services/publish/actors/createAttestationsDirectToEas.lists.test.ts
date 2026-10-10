import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { SchemaEncoder } from '@ethereum-attestation-service/eas-sdk'
import { encodeBytes32String } from 'ethers'

/**
 * createAttestationsDirectToEas with relation and list properties whose targets are drafts published
 * in the same publish. The payloads mirror getPublishPayload: requests ordered referenced-first, a
 * draft target fills the referring property through propertiesToUpdate, and a List of Relation
 * attestation carries its per-slot raw ids in `_rawListIdsForResolve` (draft slots encoded as
 * encodeBytes32String(localId) until resolved). The contract path resolves lists client side
 * (resolvePublishPayloadValues; SeedPublishLib.setSeedReference fills single-value relations only),
 * so the final list attestation holds every member's seed uid in order.
 */

const realSdk = await import('@seedprotocol/sdk')
const realChainClient = await import('../../../helpers/chainClient')
const realEasDirect = await import('../../../helpers/easDirect')
const realConfig = await import('../../../config')

const EAS = '0x00000000000000000000000000000000000000eb' as `0x${string}`
const PUBLISHER = '0x00000000000000000000000000000000000000cd' as `0x${string}`
const ZERO = `0x${'0'.repeat(64)}`
const h = (c: string) => `0x${c.repeat(64)}` as `0x${string}`

const SCHEMA_POST_SEED = h('1')
const SCHEMA_IDENTITY_SEED = h('2')
const SCHEMA_VERSION = h('3')
const SCHEMA_TITLE = h('4')
const SCHEMA_AUTHORS = h('5')
const SCHEMA_AUTHOR = h('6')
const SCHEMA_IDENTITY_NAME = h('7')
const SCHEMA_IDENTITY_POSTS = h('8')

const PUBLISHED_IDENTITY = h('e')

const AUTHORS_DEF = 'bytes32[] author_identity_ids'
const AUTHOR_DEF = 'bytes32 author'

type AttestData = {
  recipient: string
  expirationTime: bigint
  revocable: boolean
  refUID: string
  data: string
  value: bigint
}
type FakeTx =
  | { kind: 'attest'; schema: string; refUID: string }
  | { kind: 'multi'; requests: Array<{ schema: string; data: AttestData[] }> }

const sentTxs = new Map<string, FakeTx>()
/** Seed uids created, in creation order. */
let createdSeeds: string[] = []
let uidCounter = 0
const nextUid = (prefix: string) => `0x${prefix}${(++uidCounter).toString(16).padStart(64 - prefix.length, '0')}`

mock.module('@seedprotocol/sdk', () => ({
  ...realSdk,
  updateVersionUid: async () => {},
  applyPropertyAttestationUidsFromPublish: async () => {},
  Item: { find: async () => undefined },
  clearHtmlEmbeddedImageCoPublishRows: async () => {},
}))
mock.module('../../../helpers/easDirect', () => ({
  ...realEasDirect,
  prepareEasAttest: (p: { schema: string; data: { refUID: string } }) =>
    ({ kind: 'attest', schema: p.schema, refUID: p.data.refUID }) as unknown,
  prepareEasMultiAttest: (requests: Array<{ schema: string; data: AttestData[] }>) =>
    ({ kind: 'multi', requests: structuredClone(requests) }) as unknown,
  getAttestationUidFromReceipt: (receipt: { hash: string; uid: string }) => receipt.uid,
  getAttestedUidsFromReceipt: (receipt: { hash: string; uids: Array<{ schemaUid: string; uid: string }> }) =>
    receipt.uids,
}))
mock.module('../../../config', () => ({
  ...realConfig,
  getPublishConfig: () => ({ useModularExecutor: false, easContractAddress: EAS }),
}))
mock.module('../../../helpers/chainClient', () => ({
  ...realChainClient,
  waitForPublishReceipt: async (hash: string) => {
    const tx = sentTxs.get(hash)!
    if (tx.kind === 'attest') {
      const isSeed = tx.refUID === ZERO
      const uid = nextUid(isSeed ? '5eed' : 'fe')
      if (isSeed) createdSeeds.push(uid)
      return { hash, uid }
    }
    return {
      hash,
      uids: tx.requests.flatMap((r) => r.data.map(() => ({ schemaUid: r.schema, uid: nextUid('a7') }))),
    }
  },
}))
mock.module('../helpers/receiptAttestationMs', () => ({
  attestationMsFromReceipt: async () => 1_700_000_000_000,
}))
mock.module('../helpers/ensureEasSchemas', () => ({ ensureEasSchemasForItem: async () => {} }))
mock.module('../helpers/verifyArweaveTransactionsExist', () => ({
  verifyArweaveTransactionsExist: async () => {},
}))
mock.module('../helpers/verifyAttestations', () => ({ verifyAttestations: async () => {} }))
mock.module('./recordMultiPublishReceipt', () => ({ recordRelatedSeedUid: async () => {} }))
mock.module('../../../helpers/resolvePublishWallet', () => ({
  resolvePublishWallet: () => ({
    txSender: {
      address: PUBLISHER,
      sendTransaction: async (tx: FakeTx) => {
        const hash = `0xtx${sentTxs.size + 1}`
        sentTxs.set(hash, tx)
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

const dataEntry = (data: string): AttestData => ({
  recipient: '0x0000000000000000000000000000000000000000',
  expirationTime: 0n,
  revocable: true,
  refUID: ZERO,
  data,
  value: 0n,
})

const encode = (def: string, type: string, value: unknown) => {
  const [, name] = def.split(' ')
  return new SchemaEncoder(def).encodeData([{ name: name!, type, value: value as any }])
}
const decodeList = (data: string): string[] | string => {
  try {
    return (new SchemaEncoder(AUTHORS_DEF).decodeData(data)[0]!.value.value as string[]).map((v) => v.toLowerCase())
  } catch {
    return `not a bytes32[]: ${data}`
  }
}
const decodeOne = (data: string) =>
  String(new SchemaEncoder(AUTHOR_DEF).decodeData(data)[0]!.value.value).toLowerCase()

const titleAttestation = () => ({
  schema: SCHEMA_TITLE,
  data: [dataEntry(encode('string title', 'string', 'Hello'))],
  _propertyName: 'title',
})
const nameAttestation = (name: string) => ({
  schema: SCHEMA_IDENTITY_NAME,
  data: [dataEntry(encode('string name', 'string', name))],
  _propertyName: 'name',
})

/** A List of Relation attestation as getPublishPayload builds it (processBasicProperties). */
const listAttestation = (rawIds: string[]) => ({
  schema: SCHEMA_AUTHORS,
  data: [
    dataEntry(
      encode(
        AUTHORS_DEF,
        'bytes32[]',
        rawIds.map((id) => (id.startsWith('0x') ? id : encodeBytes32String(id))),
      ),
    ),
  ],
  _propertyName: 'authors',
  _propertyNameForSchema: 'author_identity_ids',
  _schemaDef: AUTHORS_DEF,
  _easDataType: 'bytes32[]',
  ...(rawIds.some((id) => !id.startsWith('0x')) ? { _rawListIdsForResolve: rawIds } : {}),
})

/** A single Relation attestation pointing at a draft (value = its localId). */
const relationAttestation = (localId: string) => ({
  schema: SCHEMA_AUTHOR,
  data: [dataEntry(encode(AUTHOR_DEF, 'bytes32', encodeBytes32String(localId)))],
  _propertyName: 'author',
  _propertyNameForSchema: 'author',
  _schemaDef: AUTHOR_DEF,
  _easDataType: 'bytes32',
  _unresolvedValue: localId,
})

const draftRequest = (
  localId: string,
  seedSchemaUid: string,
  listOfAttestations: unknown[],
  propertiesToUpdate: Array<{ publishLocalId: string; propertySchemaUid: string }> = [],
) => ({
  localId,
  seedUid: ZERO,
  seedSchemaUid,
  versionUid: ZERO,
  versionSchemaUid: SCHEMA_VERSION,
  seedIsRevocable: true,
  listOfAttestations,
  propertiesToUpdate,
})

const POST = 'postLocal01'
const A = 'identityA01'
const B = 'identityB01'

const runPublish = async (payload: unknown[]) => {
  const item = {
    seedLocalId: POST,
    seedUid: undefined as string | undefined,
    getPublishUploads: async () => [],
    getPublishPayload: async () => payload,
    persistSeedUid: async () => {},
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
  await toPromise(actor)
}

/** The data entries attested for `schema` across every multiAttest sent. */
const attested = (schema: string) =>
  [...sentTxs.values()].flatMap((tx) =>
    tx.kind === 'multi' ? tx.requests.filter((r) => r.schema === schema).flatMap((r) => r.data) : [],
  )

beforeEach(() => {
  sentTxs.clear()
  createdSeeds = []
  uidCounter = 0
})

describe('createAttestationsDirectToEas: relation and list properties with draft targets', () => {
  test('a list of [published, draft A, draft B] attests every member seed uid in order', async () => {
    const listLink = { publishLocalId: POST, propertySchemaUid: SCHEMA_AUTHORS }
    await runPublish([
      draftRequest(A, SCHEMA_IDENTITY_SEED, [nameAttestation('A')], [listLink]),
      draftRequest(B, SCHEMA_IDENTITY_SEED, [nameAttestation('B')], [listLink]),
      draftRequest(POST, SCHEMA_POST_SEED, [titleAttestation(), listAttestation([PUBLISHED_IDENTITY, A, B])]),
    ])

    const [seedA, seedB, seedPost] = createdSeeds
    expect(createdSeeds).toHaveLength(3)
    const lists = attested(SCHEMA_AUTHORS)
    expect(lists).toHaveLength(1)
    expect(decodeList(lists[0]!.data)).toEqual([PUBLISHED_IDENTITY, seedA!, seedB!])
    // The list belongs to the Post: it references the Post's version, not a member's.
    expect(seedPost).toBeDefined()
    expect(lists[0]!.refUID).not.toBe(ZERO)
  })

  test('a single relation to a draft still attests the draft seed uid', async () => {
    await runPublish([
      draftRequest(A, SCHEMA_IDENTITY_SEED, [nameAttestation('A')], [
        { publishLocalId: POST, propertySchemaUid: SCHEMA_AUTHOR },
      ]),
      draftRequest(POST, SCHEMA_POST_SEED, [titleAttestation(), relationAttestation(A)]),
    ])

    const [seedA] = createdSeeds
    const relations = attested(SCHEMA_AUTHOR)
    expect(relations).toHaveLength(1)
    expect(decodeOne(relations[0]!.data)).toBe(seedA!)
  })

  test('a single relation filled only through propertiesToUpdate (no resolve hint) still updates', async () => {
    await runPublish([
      draftRequest(A, SCHEMA_IDENTITY_SEED, [nameAttestation('A')], [
        { publishLocalId: POST, propertySchemaUid: SCHEMA_AUTHOR },
      ]),
      draftRequest(POST, SCHEMA_POST_SEED, [
        titleAttestation(),
        { schema: SCHEMA_AUTHOR, data: [dataEntry(ZERO)], _propertyName: 'author' },
      ]),
    ])

    const [seedA] = createdSeeds
    const relations = attested(SCHEMA_AUTHOR)
    expect(relations).toHaveLength(1)
    expect(relations[0]!.data.toLowerCase()).toBe(seedA!)
  })

  test('a list containing a back-reference is deferred; its other draft member is published unlinked', async () => {
    // Post.authors = [A]; A.posts = [Post, B]. A.posts holds the Post, still being published: it is
    // a back edge, so getPublishPayload leaves A.posts out of this publish (docs/PUBLISHING.md, cycle
    // deferral) and publishes its draft member B with no link. A still links into Post.authors.
    const bLocal = B
    await runPublish([
      draftRequest(bLocal, SCHEMA_IDENTITY_SEED, [nameAttestation('B')], []),
      draftRequest(A, SCHEMA_IDENTITY_SEED, [nameAttestation('A')], [
        { publishLocalId: POST, propertySchemaUid: SCHEMA_AUTHORS },
      ]),
      draftRequest(POST, SCHEMA_POST_SEED, [titleAttestation(), listAttestation([A])]),
    ])

    const [, seedA] = createdSeeds
    expect(createdSeeds).toHaveLength(3)
    expect(attested(SCHEMA_IDENTITY_POSTS)).toHaveLength(0)
    const lists = attested(SCHEMA_AUTHORS)
    expect(lists).toHaveLength(1)
    expect(decodeList(lists[0]!.data)).toEqual([seedA!])
    const titles = attested(SCHEMA_TITLE)
    expect(titles[0]!.data).toBe(encode('string title', 'string', 'Hello'))
  })
})
