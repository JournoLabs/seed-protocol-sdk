import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { encodeAbiParameters, stringToHex } from 'viem'

/**
 * createAttestations, split path (ADR 0036): a Post with draft authors that doesn't fit in one
 * transaction goes out as one multiPublish per part, rebuilt from the rows after each part records.
 * The fake payload plays getPublishGraph: a recorded author is published, so it drops out of the
 * payload and the Post's `authors` list holds its uid.
 */

// Real modules first (they import the real SDK and config), then the mocks spread over them.
const realSdk = await import('@seedprotocol/sdk')
const realConfig = await import('../../../config')
const realChainClient = await import('../../../helpers/chainClient')
const realPublishGas = await import('../../../helpers/publishGas')

const EAS = '0x00000000000000000000000000000000000000ea' as `0x${string}`
const PUBLISHER = '0x00000000000000000000000000000000000000cc' as `0x${string}`
const ZERO = `0x${'0'.repeat(64)}` as `0x${string}`
const h = (c: string) => `0x${c.repeat(64)}` as `0x${string}`

const SCHEMA_AUTHOR_SEED = h('1')
const SCHEMA_POST_SEED = h('2')
const SCHEMA_VERSION = h('3')
const SCHEMA_NAME = h('4')
const SCHEMA_AUTHORS = h('5')

const AUTHORS = ['author1', 'author2', 'author3', 'author4']
const POST = 'post1'
/** The seed uid recording gives a local id. */
const uidOf = (localId: string) => stringToHex(`uid:${localId}`, { size: 32 })

/** Local ids recorded so far: published seeds, as far as the payload is concerned. */
let recorded = new Set<string>()
/** Set by a test: author2 is edited after part 1 records, so it comes back as a patch. */
let author2Edited = false
let publishConfig: Record<string, unknown> = {}
let txCount = 0
/** Set to the EntryPoint when the publish wallet's sender pins its nonce. */
let pinsNonceOn: string | undefined

const sendTransaction = mock(async (_tx: unknown) => ({ transactionHash: `0x${(++txCount).toString(16).padStart(64, '0')}` }))
const claimPublishAttempt = mock(async (_attempt: { id: string; requests: string }) => undefined)
/** Set by a test: author2 is edited right after the first part records. */
let editAuthor2AfterFirstRecord = false
const recordMultiPublishReceipt = mock(async ({ requests }: { requests: Array<{ localId: string; seedUid?: string }> }) => {
  for (const r of requests) {
    // Recording the patch publishes the edit.
    if (r.localId === 'author2' && r.seedUid !== ZERO) author2Edited = false
    recorded.add(r.localId)
  }
  if (editAuthor2AfterFirstRecord && recordMultiPublishReceipt.mock.calls.length === 1) author2Edited = true
  return { requests: requests.map((r) => ({ ...r, seedUid: uidOf(r.localId), versionUid: h('9') })), attributed: [] }
})

mock.module('@seedprotocol/sdk', () => ({
  ...realSdk,
  claimPublishAttempt,
  findOpenPublishAttempts: async () => [],
  updatePublishAttempt: async () => {},
  clearHtmlEmbeddedImageCoPublishRows: async () => {},
}))
mock.module('../../../config', () => ({
  ...realConfig,
  getPublishConfig: () => ({ useModularExecutor: false, easContractAddress: EAS, ...publishConfig }),
}))
mock.module('../../../helpers/chainClient', () => ({
  ...realChainClient,
  getPublishBlockNumber: async () => 100n,
  isContractDeployed: async () => true,
  waitForPublishReceipt: async () => ({ logs: [] }),
  getPublishPublicClient: () => ({ readContract: async () => 0n }),
}))
mock.module('./recordMultiPublishReceipt', () => ({ recordMultiPublishReceipt }))
mock.module('../helpers/receiptAttestationMs', () => ({
  attestationMsFromReceipt: async () => 1_700_000_000_000,
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
  resolvePublishWallet: () => ({ txSender: { address: PUBLISHER, sendTransaction, ...(pinsNonceOn && { pinsNonceOn }) } }),
}))
mock.module('../../../helpers/multiPublishRoute', () => ({ assertMultiPublishRouted: async () => {} }))
// No RPC: an estimate that can't be made keeps the local cut, which these tests size.
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
const { createActor, fromPromise, toPromise, waitFor } = await import('xstate')
const { publishMachine } = await import('../index')
const { publishNonceKey } = await import('../../../helpers/pinnedNonce')

const attestation = (schema: `0x${string}`, data: `0x${string}`, easType?: string) => ({
  schema,
  ...(easType && { _easType: easType }),
  data: [{ recipient: ZERO.slice(0, 42), expirationTime: 0, revocable: true, refUID: ZERO, data, value: 0 }],
})

/** The payload getPublishPayload would build from the rows as they are now. */
function payload() {
  const drafts = AUTHORS.filter((id) => !recorded.has(id))
  const requests: unknown[] = drafts.map((localId) => ({
    localId,
    seedUid: ZERO,
    seedSchemaUid: SCHEMA_AUTHOR_SEED,
    versionUid: ZERO,
    versionSchemaUid: SCHEMA_VERSION,
    seedIsRevocable: true,
    listOfAttestations: [attestation(SCHEMA_NAME, stringToHex(`name of ${localId}`, { size: 32 }))],
    propertiesToUpdate: [
      { publishLocalId: POST, propertySchemaUid: SCHEMA_AUTHORS, listElement: true, elementIndex: AUTHORS.indexOf(localId) },
    ],
  }))
  if (author2Edited && recorded.has('author2')) {
    requests.push({
      localId: 'author2',
      seedUid: uidOf('author2'),
      seedSchemaUid: SCHEMA_AUTHOR_SEED,
      versionUid: h('9'),
      versionSchemaUid: SCHEMA_VERSION,
      seedIsRevocable: true,
      listOfAttestations: [attestation(SCHEMA_NAME, stringToHex('a new name', { size: 32 }))],
      propertiesToUpdate: [],
    })
  }
  const authors = AUTHORS.map((id) => (recorded.has(id) ? uidOf(id) : stringToHex(id, { size: 32 })))
  requests.push({
    localId: POST,
    seedUid: ZERO,
    seedSchemaUid: SCHEMA_POST_SEED,
    versionUid: ZERO,
    versionSchemaUid: SCHEMA_VERSION,
    seedIsRevocable: true,
    listOfAttestations: [attestation(SCHEMA_AUTHORS, encodeAbiParameters([{ type: 'bytes32[]' }], [authors]), 'bytes32[]')],
    propertiesToUpdate: [],
  })
  return requests
}

const makeItem = () => ({
  seedLocalId: POST,
  seedUid: undefined as string | undefined,
  getPublishUploads: async () => [],
  getPublishPayload: async () => payload(),
  persistSeedUid: mock(async (_publisher?: string, _ms?: number) => {}),
})

const contextFor = (item: ReturnType<typeof makeItem>, extra: Record<string, unknown> = {}) =>
  ({ address: PUBLISHER, account: {}, item, arweaveTransactions: [], publishUploads: [], publishMode: 'patch', ...extra }) as any

const run = async (extra: Record<string, unknown> = {}) => {
  const item = makeItem()
  const actor = createActor(createAttestations, { input: { context: contextFor(item, extra), event: {} } })
  actor.start()
  return { item, result: await toPromise(actor) }
}

/** The local ids of each send, from the attempts it claimed. */
const sends = () =>
  claimPublishAttempt.mock.calls.map(([a]) => (JSON.parse(a.requests) as Array<{ localId: string }>).map((r) => r.localId))
const sentRequests = (n: number) =>
  JSON.parse(claimPublishAttempt.mock.calls[n]![0].requests) as Array<{
    localId: string
    propertiesToUpdate: Array<{ publishLocalId: string }>
    listOfAttestations: Array<{ data: Array<{ data: string }> }>
  }>

/** The part each author goes in when the limit holds four authors but not the Post as well. */
const PART_1_AUTHORS = AUTHORS

beforeEach(() => {
  recorded = new Set()
  author2Edited = false
  editAuthor2AfterFirstRecord = false
  txCount = 0
  // Forces a split at small sizes: four new author seeds fit (1.94M with headroom), the Post doesn't.
  publishConfig = { maxPublishGas: 2_000_000n }
  sendTransaction.mockClear()
  sendTransaction.mockImplementation(async () => ({ transactionHash: `0x${(++txCount).toString(16).padStart(64, '0')}` }))
  claimPublishAttempt.mockClear()
  recordMultiPublishReceipt.mockClear()
})

describe('createAttestations: a publish over one transaction', () => {
  test('a graph over the limit goes out as two multiPublish sends, root in the last', async () => {
    const { item, result } = await run()
    expect(sends()).toEqual([PART_1_AUTHORS, [POST]])
    expect(sentRequests(0).flatMap((r) => r.propertiesToUpdate.map((pu) => pu.publishLocalId))).not.toContain(POST)
    const [postRequest] = sentRequests(1)
    const authors = postRequest!.listOfAttestations[0]!.data[0]!.data
    for (const id of AUTHORS) expect(authors).toContain(uidOf(id).slice(2))
    const attemptIds = claimPublishAttempt.mock.calls.map(([a]) => a.id)
    expect(new Set(attemptIds).size).toBe(2)
    expect(item.seedUid).toBe(uidOf(POST))
    expect(result.attestationPartsRecorded).toBe(2)
    expect((result.easPayload as unknown[]).length).toBe(5)
  })

  test('a graph that fits is one send', async () => {
    publishConfig = {}
    const { result } = await run()
    expect(sends()).toEqual([[...AUTHORS, POST]])
    expect(result.attestationPartsRecorded).toBe(1)
  })

  test('a landed part found by reconcile is recorded, then the rest is sent', async () => {
    const part1 = payload().slice(0, 4)
    const { result } = await run({
      unrecordedAttestation: { attemptId: 'part-1', transactionHash: h('7'), requests: part1, attester: PUBLISHER },
    })
    expect(recordMultiPublishReceipt.mock.calls[0]![0].requests.map((r) => r.localId)).toEqual(AUTHORS)
    expect(sends()).toEqual([[POST]])
    expect(result.attestationPartsRecorded).toBe(2)
  })

  test('a landed part that held the root ends the run without sending', async () => {
    recorded = new Set(AUTHORS)
    const part2 = payload()
    const { item, result } = await run({
      attestationPartsRecorded: 1,
      unrecordedAttestation: { attemptId: 'part-2', transactionHash: h('7'), requests: part2, attester: PUBLISHER },
    })
    expect(sends()).toEqual([])
    expect(item.seedUid).toBe(uidOf(POST))
    expect(result.attestationPartsRecorded).toBe(2)
  })

  test('an edit saved between parts goes into a later part', async () => {
    editAuthor2AfterFirstRecord = true
    const { result } = await run()
    expect(sends()).toEqual([PART_1_AUTHORS, ['author2', POST]])
    expect(sendTransaction).toHaveBeenCalledTimes(2)
    expect(result.attestationPartsRecorded).toBe(2)
  })

  test('a restore between parts sends only what is left', async () => {
    recorded = new Set(AUTHORS)
    const { result } = await run({ attestationPartsRecorded: 1 })
    expect(sends()).toEqual([[POST]])
    expect(result.attestationPartsRecorded).toBe(2)
  })

  test('a host nonceKey sends each part under its own part key', async () => {
    pinsNonceOn = `0x${'7'.repeat(40)}`
    try {
      await run({ nonceKey: 'run-7' })
    } finally {
      pinsNonceOn = undefined
    }
    const keys = sendTransaction.mock.calls.map(([tx]) => (tx as { nonceKey?: bigint }).nonceKey)
    expect(keys).toEqual([publishNonceKey('run-7', 1), publishNonceKey('run-7', 2)])
  })

  test('a revert in part 2 leaves part 1 recorded and the run failing', async () => {
    sendTransaction.mockImplementation(async () => {
      if (txCount++ === 1) throw new Error('execution reverted')
      return { transactionHash: `0x${txCount.toString(16).padStart(64, '0')}` }
    })
    const machine = publishMachine.provide({
      actors: { reconcileAttestations: fromPromise(async () => ({ outcome: 'send' as const })) },
    })
    const item = makeItem()
    const snapshot = machine.resolveState({ value: 'attestationFailureRecoverable', context: contextFor(item) })
    const actor = createActor(machine, { snapshot })
    const errorLog = console.error
    console.error = () => {}
    try {
      actor.start()
      actor.send({ type: 'retry' })
      await waitFor(actor, (s) => s.matches('attestationFailureRecoverable') && s.context.error !== undefined)
    } finally {
      console.error = errorLog
    }
    const { context } = actor.getSnapshot()
    expect([...recorded].sort()).toEqual(AUTHORS)
    expect(context.attestationPartsRecorded).toBe(1)
    expect((context.error as Error).message).toBe('execution reverted')
    actor.stop()
  })
})
