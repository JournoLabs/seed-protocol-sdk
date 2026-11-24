import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { LICENSE_OFFER_SCHEMA_UID } from '@seedprotocol/eas'

/**
 * createAttestationsDirectToEas with a license offer (ADR 0039): the offer goes in the root's
 * property transaction with the root's Version as refUID, and its uid is not recorded as a property.
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
const OFFER = h('c')
const PROPERTY_BY_SCHEMA: Record<string, string> = {
  [SCHEMA_IMAGE_SRC]: IMAGE_SRC,
  [SCHEMA_POST_TITLE]: POST_TITLE,
  [LICENSE_OFFER_SCHEMA_UID]: OFFER,
}

type FakeTx =
  | { kind: 'attest'; schema: string; refUID: string }
  | { kind: 'multi'; schemas: string[]; refUIDs: string[] }
const sentTxs = new Map<string, FakeTx>()
/** Transactions an earlier, crashed start of a run sent. */
const landedTxs = new Map<string, FakeTx>()
/** The offer uid each landed transaction attested, when not OFFER. */
const offerUidByTx = new Map<string, string>()
const receiptMs = new Map<string, number>()
/** License offers as EAS holds them, by uid. */
const offersOnChain = new Map<string, { attester: string; revocationTime: bigint; data: string }>()
const ZERO_ADDRESS = `0x${'0'.repeat(40)}`

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

let recordFailure: Error | undefined
/** Attempts left open by a run that crashed after its transaction was sent. */
const openAttempts: Array<Record<string, unknown>> = []
const recordedAttempts: Array<Record<string, unknown>> = []

mock.module('@seedprotocol/sdk', () => ({
  ...realSdk,
  updateVersionUid,
  applyPropertyAttestationUidsFromPublish,
  // The real one writes them in one transaction; here it hands each to its mock
  claimPublishAttempt: async () => undefined,
  findOpenPublishAttempts: async () => [...openAttempts],
  findRecordedPublishAttempts: async (seedLocalIds: string[]) =>
    recordedAttempts.filter((a) => (JSON.parse(a.seedLocalIds as string) as string[]).some((id) => seedLocalIds.includes(id))),
  updatePublishAttempt: async () => {},
  recordPublishRequests: async (
    records: Array<{ version?: unknown; properties?: unknown }>,
    opts?: { attemptId?: string },
  ) => {
    if (recordFailure) throw recordFailure
    for (const { version, properties } of records) {
      if (version) await updateVersionUid(version)
      if (properties) await applyPropertyAttestationUidsFromPublish(properties)
    }
    // Recording ends the attempt.
    const i = openAttempts.findIndex((a) => a.id === opts?.attemptId)
    if (i >= 0) recordedAttempts.push({ ...openAttempts.splice(i, 1)[0]!, status: 'recorded' })
  },
  Item: { find: itemFind },
  clearHtmlEmbeddedImageCoPublishRows: async () => {},
}))
mock.module('../../../helpers/easDirect', () => ({
  ...realEasDirect,
  prepareEasAttest: (p: { schema: string; data: { refUID: string } }) =>
    ({ kind: 'attest', schema: p.schema, refUID: p.data.refUID }) as unknown,
  prepareEasMultiAttest: (reqs: Array<{ schema: string; data: Array<{ refUID: string }> }>) =>
    ({
      kind: 'multi',
      schemas: reqs.flatMap((r) => r.data.map(() => r.schema)),
      refUIDs: reqs.flatMap((r) => r.data.map((d) => d.refUID)),
    }) as unknown,
  getAttestedUidsFromReceipt: (receipt: { hash: string }) => {
    const tx = sentTxs.get(receipt.hash) ?? landedTxs.get(receipt.hash)
    if (!tx) return []
    if (tx.kind === 'attest') {
      return [{ schemaUid: tx.schema, uid: (SEED_BY_SCHEMA[tx.schema] ?? VERSION_BY_SEED[tx.refUID])! }]
    }
    const offerUid = offerUidByTx.get(receipt.hash)
    return tx.schemas.map((schemaUid) => ({
      schemaUid,
      uid: schemaUid === LICENSE_OFFER_SCHEMA_UID && offerUid ? offerUid : PROPERTY_BY_SCHEMA[schemaUid]!,
    }))
  },
}))
mock.module('../../../config', () => ({
  ...realConfig,
  getPublishConfig: () => ({ useModularExecutor: false, easContractAddress: EAS }),
}))
mock.module('../../../helpers/chainClient', () => ({
  ...realChainClient,
  getPublishBlockNumber: async () => 100n,
  waitForPublishReceipt: async (hash: string) => ({ hash }),
  getPublishPublicClient: () => ({
    readContract: async ({ functionName, args }: { functionName: string; args: [string] }) => {
      if (functionName !== 'getAttestation') throw new Error(`unexpected read ${functionName}`)
      const onChain = offersOnChain.get(args[0])
      return onChain ? { uid: args[0], ...onChain } : { uid: ZERO, attester: ZERO_ADDRESS, revocationTime: 0n, data: '0x' }
    },
  }),
}))
mock.module('../helpers/receiptAttestationMs', () => ({
  attestationMsFromReceipt: async (receipt: { hash: string }) => receiptMs.get(receipt.hash) ?? 0,
}))
const ensureEasSchemasForItem = mock(async () => {})
mock.module('../helpers/ensureEasSchemas', () => ({ ensureEasSchemasForItem }))
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
const { encodeLicenseOfferData } = await import('../../licenseOffer')
const { settleOpenAttempts } = await import('../settleOpenAttempts')
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

const TERMS = `0x${'ab'.repeat(32)}`

const run = async (getPublishPayload: () => Promise<unknown>, extraContext: Record<string, unknown> = {}) => {
  sentTxs.clear()
  applyPropertyAttestationUidsFromPublish.mockClear()
  const item = {
    seedLocalId: 'postLocalD1',
    seedUid: undefined as string | undefined,
    getPublishUploads: async () => [],
    getPublishPayload,
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
        licenseOffer: { termsHash: TERMS, spdx: 'CC-BY-4.0' },
        ...extraContext,
      } as any,
      event: {},
    },
  })
  actor.start()
  return toPromise(actor)
}

const multis = () => [...sentTxs.values()].filter((tx): tx is Extract<FakeTx, { kind: 'multi' }> => tx.kind === 'multi')

describe('createAttestationsDirectToEas: a license offer', () => {
  test("goes in the root's property transaction on its Version, and is not recorded as a property", async () => {
    const result = await run(async () => requests())

    const [imageTx, postTx] = multis()
    expect(imageTx!.schemas).toEqual([SCHEMA_IMAGE_SRC])
    expect(postTx!.schemas).toEqual([SCHEMA_POST_TITLE, LICENSE_OFFER_SCHEMA_UID])
    expect(postTx!.refUIDs).toEqual([POST_VERSION, POST_VERSION])

    const postPairs = applyPropertyAttestationUidsFromPublish.mock.calls
      .map(([a]) => a as any)
      .find((a) => a.seedLocalId === 'postLocalD1')!.pairs
    expect(postPairs.map((p: any) => [p.attestationUid, p.propertyName])).toEqual([[POST_TITLE, 'title']])

    expect(result.publishedBatch?.licenseOfferUid).toBe(OFFER)
    expect(result.publishedBatch?.attestationUids).toContain(OFFER)
  })

  test('is sent on its own when the root has no property to attest', async () => {
    const result = await run(async () => {
      const [image, post] = requests()
      return [image, { ...post!, listOfAttestations: [] }]
    })
    expect(multis().at(-1)!.schemas).toEqual([LICENSE_OFFER_SCHEMA_UID])
    expect(result.publishedBatch?.licenseOfferUid).toBe(OFFER)
  })
})

/** A run sent the post's property transaction with an offer, then crashed. */
const landedOffer = (
  status: 'sent' | 'recorded',
  publishRunId = 'run1',
  { terms = TERMS, uid = OFFER, attester = PUBLISHER, revocationTime = 0n }: { terms?: string; uid?: string; attester?: string; revocationTime?: bigint } = {},
) => {
  const hash = `0xlanded-${uid}`
  landedTxs.set(hash, {
    kind: 'multi',
    schemas: [SCHEMA_POST_TITLE, LICENSE_OFFER_SCHEMA_UID],
    refUIDs: [POST_VERSION, POST_VERSION],
  })
  offerUidByTx.set(hash, uid)
  offersOnChain.set(uid, { attester, revocationTime, data: encodeLicenseOfferData({ termsHash: terms, spdx: 'CC-BY-4.0' }) })
  const attempt = {
    id: `attempt-${uid}`,
    publishRunId,
    seedLocalIds: JSON.stringify(['postLocalD1']),
    txHash: hash,
    step: 'properties',
    attester,
    status,
    requests: JSON.stringify([
      { localId: 'postLocalD1', versionUid: POST_VERSION, properties: [{ _propertyName: 'title' }], licenseOffer: true },
    ]),
  }
  if (status === 'sent') openAttempts.push(attempt)
  else recordedAttempts.push(attempt)
}

/** The restored run's payload: every seed, Version and property is recorded. */
const allRecorded = async () =>
  requests().map((r, i) => ({
    ...r,
    seedUid: [IMAGE_SEED, POST_SEED][i]!,
    versionUid: [IMAGE_VERSION, POST_VERSION][i]!,
    listOfAttestations: [],
  }))

describe('createAttestationsDirectToEas: a license offer after a crash', () => {
  beforeEach(() => {
    openAttempts.length = 0
    recordedAttempts.length = 0
    landedTxs.clear()
    offerUidByTx.clear()
    offersOnChain.clear()
  })

  test("is reported from the run's landed transaction that reconcile recorded, and not sent again", async () => {
    landedOffer('sent')
    const reconciled = await settleOpenAttempts({ seedLocalId: 'postLocalD1', publishRunId: 'run1', publisher: PUBLISHER })
    expect(reconciled.outcome).toBe('send')
    expect(openAttempts).toHaveLength(0)

    const result = await run(allRecorded, { publishRunId: 'run1' })

    expect(multis()).toEqual([])
    expect(result.publishedBatch?.licenseOfferUid).toBe(OFFER)
    expect(result.publishedBatch?.attestationUids).toContain(OFFER)
  })

  test('is not sent again when the run restarts from state saved before reconcile recorded it', async () => {
    // Reconcile recorded the attempt, and the run's saved state was never updated after that.
    landedOffer('recorded')

    const result = await run(allRecorded, { publishRunId: 'run1' })

    expect(multis()).toEqual([])
    expect(result.publishedBatch?.licenseOfferUid).toBe(OFFER)
  })

  test("is not sent again when another run's offer with the same terms is the Seed's newest", async () => {
    // A run that crashed and was replaced, not restored, attested it.
    landedOffer('recorded', 'run0', { uid: h('d') })

    const result = await run(allRecorded, { publishRunId: 'run1' })

    expect(multis()).toEqual([])
    expect(result.publishedBatch?.licenseOfferUid).toBe(h('d'))
  })

  test('is sent when the newest offer has other terms, though an older one has the same', async () => {
    landedOffer('recorded', 'run0', { uid: h('d') })
    landedOffer('recorded', 'run2', { uid: h('e'), terms: `0x${'cd'.repeat(32)}` })

    const result = await run(allRecorded, { publishRunId: 'run1' })

    expect(multis().map((tx) => tx.schemas)).toEqual([[LICENSE_OFFER_SCHEMA_UID]])
    expect(result.publishedBatch?.licenseOfferUid).toBe(OFFER)
  })

  test('is sent when the same-terms offer was revoked', async () => {
    landedOffer('recorded', 'run0', { uid: h('d'), revocationTime: 1_700_000_100n })

    const result = await run(allRecorded, { publishRunId: 'run1' })

    expect(multis().map((tx) => tx.schemas)).toEqual([[LICENSE_OFFER_SCHEMA_UID]])
    expect(result.publishedBatch?.licenseOfferUid).toBe(OFFER)
  })

  test('is sent when only another attester made the same-terms offer', async () => {
    landedOffer('recorded', 'run0', { uid: h('d'), attester: `0x${'ef'.repeat(20)}` })

    const result = await run(allRecorded, { publishRunId: 'run1' })

    expect(multis().map((tx) => tx.schemas)).toEqual([[LICENSE_OFFER_SCHEMA_UID]])
    expect(result.publishedBatch?.licenseOfferUid).toBe(OFFER)
  })
})
