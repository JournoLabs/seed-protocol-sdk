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
let publishConfig: Record<string, unknown> = {}
let txCount = 0
/** Set to the EntryPoint when the publish wallet's sender pins its nonce. */
let pinsNonceOn: string | undefined

/** eth_estimateGas: no estimate unless a test says otherwise, so the local cut stands. */
const estimateGas = mock(async (_args: { data: string }): Promise<bigint> => {
  throw new Error('fetch failed')
})
const sendTransaction = mock(async (_tx: unknown) => ({ transactionHash: `0x${(++txCount).toString(16).padStart(64, '0')}` }))
/** publish_attempts as far as these tests need it: the run of each attempt and whether it recorded. */
let attemptRows: Array<{ id: string; publishRunId: string | null; status: string }> = []
/** What findOpenPublishAttempts returns: attempts claimed and not settled. */
let openAttempts: unknown[] = []
const claimPublishAttempt = mock(async (attempt: { id: string; requests: string; publishRunId: string | null }) => {
  attemptRows.push({ id: attempt.id, publishRunId: attempt.publishRunId, status: 'sending' })
  return undefined
})
const recordMultiPublishReceipt = mock(
  async ({ requests, attemptId }: { requests: Array<{ localId: string; seedUid?: string }>; attemptId?: string }) => {
    for (const r of requests) recorded.add(r.localId)
    const row = attemptRows.find((a) => a.id === attemptId)
    if (row) row.status = 'recorded'
    return { requests: requests.map((r) => ({ ...r, seedUid: uidOf(r.localId), versionUid: h('9') })), attributed: [] }
  },
)
const clearHtmlEmbeddedImageCoPublishRows = mock(async (_seedLocalId: string) => {})
/** EntryPoint nonce keys a UserOp already landed under. */
let spentKeys = new Set<bigint>()

mock.module('@seedprotocol/sdk', () => ({
  ...realSdk,
  claimPublishAttempt,
  findOpenPublishAttempts: async () => openAttempts,
  updatePublishAttempt: async () => {},
  countRecordedPublishParts: async (runIds: string[]) =>
    attemptRows.filter((a) => a.publishRunId && runIds.includes(a.publishRunId) && a.status === 'recorded').length,
  clearHtmlEmbeddedImageCoPublishRows,
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
  // EntryPoint.getNonce(sender, key): sequence 1 for a spent key.
  getPublishPublicClient: () => ({
    estimateGas,
    readContract: async ({ args }: { args: [string, bigint] }) => (spentKeys.has(args[1]) ? 1n : 0n),
  }),
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
// The part estimate goes through the real estimatePublishGas over the estimateGas mock above.
mock.module('../../../helpers/publishGas', () => ({
  ...realPublishGas,
  publishGasLimit: async () => 1_234_567n,
  publishGasCeiling: async () => 16_000_000n,
}))
mock.module('../../arweaveL1Finalize/enqueue', () => ({
  enqueueArweaveL1FinalizeJobsFromPublishContext: async () => {},
}))

const { createAttestations } = await import('./createAttestations')
const { createActor, fromPromise, toPromise, waitFor } = await import('xstate')
const { publishMachine } = await import('../index')
const { publishNonceKey } = await import('../../../helpers/pinnedNonce')
const { normalizePublishRequest } = await import('./publishRequestNormalize')
const { partRequests, publishUnits } = await import('../../../helpers/publishParts')

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

const makeItem = (build: () => unknown[] = payload) => ({
  seedLocalId: POST,
  seedUid: undefined as string | undefined,
  getPublishUploads: async () => [],
  getPublishPayload: async () => build(),
  persistSeedUid: mock(async (_publisher?: string, _ms?: number) => {}),
})

const contextFor = (item: ReturnType<typeof makeItem>, extra: Record<string, unknown> = {}) =>
  ({ address: PUBLISHER, account: {}, item, arweaveTransactions: [], publishUploads: [], publishMode: 'patch', ...extra }) as any

const run = async (extra: Record<string, unknown> = {}, build?: () => unknown[]) => {
  const item = makeItem(build)
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
  attemptRows = []
  openAttempts = []
  spentKeys = new Set()
  txCount = 0
  // Forces a split at small sizes: four new author seeds fit (1.94M with headroom), the Post doesn't.
  publishConfig = { maxPublishGas: 2_000_000n }
  estimateGas.mockReset()
  estimateGas.mockImplementation(async () => {
    throw new Error('fetch failed')
  })
  sendTransaction.mockClear()
  sendTransaction.mockImplementation(async () => ({ transactionHash: `0x${(++txCount).toString(16).padStart(64, '0')}` }))
  claimPublishAttempt.mockClear()
  recordMultiPublishReceipt.mockClear()
  clearHtmlEmbeddedImageCoPublishRows.mockClear()
})

/** The nonce key each send went out under. */
const sentKeys = () => sendTransaction.mock.calls.map(([tx]) => (tx as { nonceKey?: bigint }).nonceKey)

/** Runs `body` with a publish wallet whose sender pins its nonce, as a host `nonceKey` needs. */
async function pinning<T>(body: () => Promise<T>): Promise<T> {
  pinsNonceOn = `0x${'7'.repeat(40)}`
  try {
    return await body()
  } finally {
    pinsNonceOn = undefined
  }
}

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
    expect((result.easPayload as unknown[]).length).toBe(5)
  })

  test('a graph that fits is one send', async () => {
    publishConfig = {}
    await run()
    expect(sends()).toEqual([[...AUTHORS, POST]])
  })

  // Split-publish review finding 8: the node's "exceeds allowance" error used to count as fitting.
  test('a part the node says is over its gas cap is cut shorter', async () => {
    publishConfig = {}
    let wholeLength: number | undefined
    estimateGas.mockImplementation(async ({ data }) => {
      wholeLength ??= data.length
      if (data.length >= wholeLength) throw new Error('gas required exceeds allowance (16777216)')
      return 1_000_000n
    })
    await run()
    expect(sends()).toEqual([PART_1_AUTHORS, [POST]])
  })

  test('a landed part found by reconcile is recorded, then the rest is sent', async () => {
    const part1 = payload().slice(0, 4)
    await run({
      unrecordedAttestation: { attemptId: 'part-1', transactionHash: h('7'), requests: part1, attester: PUBLISHER },
    })
    expect(recordMultiPublishReceipt.mock.calls[0]![0].requests.map((r) => r.localId)).toEqual(AUTHORS)
    expect(sends()).toEqual([[POST]])
  })

  test('a landed part that held the root ends the run without sending', async () => {
    recorded = new Set(AUTHORS)
    const part2 = payload()
    const { item } = await run({
      unrecordedAttestation: { attemptId: 'part-2', transactionHash: h('7'), requests: part2, attester: PUBLISHER },
    })
    expect(sends()).toEqual([])
    expect(item.seedUid).toBe(uidOf(POST))
  })

  test('a restore between parts sends only what is left', async () => {
    recorded = new Set(AUTHORS)
    await run()
    expect(sends()).toEqual([[POST]])
  })

  test('a host nonceKey sends each part under its own part key', async () => {
    await pinning(() => run({ nonceKey: 'run-7', publishRunId: 'run-a' }))
    expect(sentKeys()).toEqual([publishNonceKey('run-7', 1), publishNonceKey('run-7', 2)])
  })

  test('a restore after part 1 with a host nonceKey sends the rest under part 2\'s key', async () => {
    // Part 1 landed and recorded, then the tab reloaded: the saved run knows nothing of it.
    recorded = new Set(AUTHORS)
    attemptRows = [{ id: 'part-1', publishRunId: 'run-r', status: 'recorded' }]
    spentKeys = new Set([publishNonceKey('run-7', 1)])
    await pinning(() => run({ nonceKey: 'run-7', publishRunId: 'run-r' }))
    expect(sends()).toEqual([[POST]])
    expect(sentKeys()).toEqual([publishNonceKey('run-7', 2)])
  })

  test('a resume sends the open attempt\'s own part, though the payload now cuts differently', async () => {
    // Part 1 was claimed with three authors under its pinned key and never landed. The rebuilt
    // payload now fits four, so a re-cut part would not be the requests the attempt stores.
    const units = publishUnits(payload().map(normalizePublishRequest))
    const stored = JSON.stringify(partRequests(units, 3), (_key, v) => (typeof v === 'bigint' ? v.toString() : v))
    const key = publishNonceKey('run-7', 1)
    openAttempts = [
      {
        id: 'part-1',
        publishRunId: 'run-r',
        step: 'multiPublish',
        requests: stored,
        sender: PUBLISHER,
        entryPoint: `0x${'7'.repeat(40)}`,
        nonceKey: key.toString(),
      },
    ]
    const { item } = await pinning(() =>
      run({ nonceKey: 'run-7', publishRunId: 'run-r', resumeAttemptId: 'part-1' }),
    )
    expect(sentKeys()[0]).toBe(key)
    expect(recordMultiPublishReceipt.mock.calls[0]![0].requests.map((r) => r.localId)).toEqual(AUTHORS.slice(0, 3))
    expect(recordMultiPublishReceipt.mock.calls[0]![0].attemptId).toBe('part-1')
    expect(item.seedUid).toBe(uidOf(POST))
  })

  test('a run that replaced one under the same nonceKey goes on from its parts', async () => {
    recorded = new Set(AUTHORS)
    spentKeys = new Set([publishNonceKey('run-7', 1)])
    await pinning(() => run({ nonceKey: 'run-7', publishRunId: 'run-new', nonceKeyPartsInherited: 1 }))
    expect(sentKeys()).toEqual([publishNonceKey('run-7', 2)])
  })

  test('a part that records clears its seeds\' co-publish rows, though a later part fails', async () => {
    sendTransaction.mockImplementation(async () => {
      if (txCount++ === 1) throw new Error('execution reverted')
      return { transactionHash: `0x${txCount.toString(16).padStart(64, '0')}` }
    })
    await expect(run()).rejects.toThrow('execution reverted')
    expect(clearHtmlEmbeddedImageCoPublishRows.mock.calls.map(([id]) => id).sort()).toEqual(AUTHORS)
  })

  test('an empty payload sends nothing', async () => {
    await expect(run({}, () => [])).rejects.toThrow('The publish payload is empty')
    expect(sendTransaction).not.toHaveBeenCalled()
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
    expect((context.error as Error).message).toBe('execution reverted')
    actor.stop()
  })
})
