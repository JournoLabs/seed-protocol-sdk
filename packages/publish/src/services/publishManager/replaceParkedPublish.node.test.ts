import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from 'bun:test'
import { ethers } from 'ethers'

/**
 * Publish on a seed whose run in this tab is parked after a failed attestation (ADR 0036): with no
 * open attempt it replaces the run, which is stopped and recorded `interrupted`, and the new run
 * takes its uploads and its nonceKey, with the parts sent under that key. With an open attempt
 * nothing starts.
 */
const realSdk = await import('@seedprotocol/sdk')
const realSavePublish = await import('./actors/savePublish')

type Attempt = { id: string; seedLocalId: string; status: string }
let attempts: Attempt[] = []
/** publish_attempts rows by the decimal nonce key they sent under. */
let rowsByKey = new Map<string, Array<{ id: string; status: string; txHash: string | null }>>()
/** Runs once as the replacement is about to start, after createPublish has seen the run parked. */
let beforeReplacing: (() => void) | undefined
mock.module('@seedprotocol/sdk', () => ({
  ...realSdk,
  findOpenPublishAttempts: async (ids: string[]) =>
    attempts.filter((a) => ids.includes(a.seedLocalId) && ['sending', 'sent', 'landed'].includes(a.status)),
  findPublishAttemptsByNonceKey: async (key: string) => rowsByKey.get(key) ?? [],
}))
const markInProgressPublishInterrupted = mock(async (_seedLocalId: string) => {})
mock.module('./actors/savePublish', () => ({ ...realSavePublish, markInProgressPublishInterrupted }))

const { BaseDb } = realSdk
const { createActor } = await import('xstate')
const { setConfigRef } = await import('../../config')
const { fromEthersWallet } = await import('../../helpers/seedSigner')
const { publishMachine } = await import('../publish')
const { PublishManager } = await import('./index')
const { startPublish } = await import('../../helpers/ensureWalletThenPublish')
const { TEST_TIMEOUT_MS } = await import('../../../test-utils/waitUntil')
const { partsSentUnderNonceKey } = await import('../../helpers/nonceKeyParts')
const { publishNonceKey } = await import('../../helpers/pinnedNonce')

const BASE_CONFIG = { uploadApiBaseUrl: 'http://127.0.0.1:9', rpcUrl: 'https://example.invalid/rpc' }
const ADDRESS = ethers.Wallet.createRandom().address
const origReady = BaseDb.isAppDbReady.bind(BaseDb)

let n = 0
const makeItem = () =>
  ({
    seedLocalId: `seed-parked-${++n}`,
    modelName: 'Post',
    schemaUid: '0xschema',
    // An item no cache holds: createPublish takes no hold on it.
    getService: () => ({ getSnapshot: () => ({ status: 'stopped' }) }),
  }) as unknown as import('@seedprotocol/sdk').Item<Record<string, unknown>>

/** A run of `item` waiting in `state`, as restore brings one back: a standalone actor. */
function runIn(item: ReturnType<typeof makeItem>, state: string, context: Record<string, unknown> = {}) {
  const snapshot = publishMachine.resolveState({
    value: state,
    context: { item, address: ADDRESS, ...context } as never,
  })
  const actor = createActor(publishMachine, { snapshot }).start()
  PublishManager.getService().getSnapshot().context.publishProcesses.set(item.seedLocalId, actor)
  return actor
}

const parkedContext = {
  arweaveTransactions: [{ transaction: { id: 'tx-image' } }],
  publishUploads: [
    {
      itemPropertyName: 'storageTransactionId',
      itemPropertyLocalId: 'prop-image',
      seedLocalId: 'image-1',
      versionLocalId: 'version-1',
      transactionToSign: null,
      contentHash: 'hash-image',
    },
  ],
  publishRunId: 'run-parked',
  nonceKey: 'job-1',
}

beforeAll(async () => {
  process.env.SEED_PUBLISH_RESTORE_WAIT_MS = '0'
  setConfigRef(BASE_CONFIG)
  await PublishManager.ready()
  // Attempts are read only from a ready database; findOpenPublishAttempts is mocked above.
  BaseDb.isAppDbReady = () => true
  // A retry can move the parked run on between createPublish seeing it parked and the replacement
  // starting; the hook plays it, just before the manager gets the event.
  const service = PublishManager.getService()
  const send = service.send.bind(service)
  service.send = ((event: { type: string }) => {
    if (event.type === 'CREATE_PUBLISH') {
      beforeReplacing?.()
      beforeReplacing = undefined
    }
    return send(event as never)
  }) as typeof service.send
})

afterEach(() => {
  attempts = []
  rowsByKey = new Map()
  beforeReplacing = undefined
  markInProgressPublishInterrupted.mockClear()
  PublishManager.stopAll()
})

afterAll(() => {
  BaseDb.isAppDbReady = origReady
  delete process.env.SEED_PUBLISH_RESTORE_WAIT_MS
})

describe('Publish on a parked seed', () => {
  test('Publish on a parked seed starts a new run', async () => {
    const item = makeItem()
    const parked = runIn(item, 'attestationFailureRecoverable', parkedContext)
    const result = await startPublish(item, ADDRESS, fromEthersWallet(ethers.Wallet.createRandom()))
    expect(result.outcome).toBe('started')
    if (result.outcome !== 'started') return
    expect(result.publish).not.toBe(parked)
    expect(parked.getSnapshot().status).toBe('stopped')
    expect(markInProgressPublishInterrupted).toHaveBeenCalledWith(item.seedLocalId)
    expect(PublishManager.getPublish(item.seedLocalId)).toBe(result.publish)
  }, TEST_TIMEOUT_MS)

  test('the new run takes the parked run nonce key with the parts it recorded under it', async () => {
    const item = makeItem()
    // The parked run's saved state counts no parts: they're read from the attempts under the key.
    rowsByKey = new Map([[publishNonceKey('job-1', 1).toString(), [{ id: 'part-1', status: 'recorded', txHash: '0x1' }]]])
    runIn(item, 'attestationFailureRecoverable', parkedContext)
    const actor = await PublishManager.createPublish(item, ADDRESS, fromEthersWallet(ethers.Wallet.createRandom()))
    const context = actor!.getSnapshot().context
    // Its first part goes out under job-1's second key.
    expect(await partsSentUnderNonceKey(context)).toBe(1)
    expect(context.nonceKey).toBe('job-1')
    expect(context.reusableUploads).toEqual([{ ...parkedContext.publishUploads[0], txId: 'tx-image' }])
  }, TEST_TIMEOUT_MS)

  test("a host's own nonceKey wins over the parked run's and starts at part 1", async () => {
    const item = makeItem()
    rowsByKey = new Map([[publishNonceKey('job-1', 1).toString(), [{ id: 'part-1', status: 'recorded', txHash: '0x1' }]]])
    runIn(item, 'attestationFailureRecoverable', parkedContext)
    const actor = await PublishManager.createPublish(item, ADDRESS, fromEthersWallet(ethers.Wallet.createRandom()), {
      nonceKey: 'job-2',
    })
    const context = actor!.getSnapshot().context
    expect(context.nonceKey).toBe('job-2')
    expect(await partsSentUnderNonceKey(context)).toBe(0)
  }, TEST_TIMEOUT_MS)

  test('a nonceKey replacing a parked run that had none starts at part 1', async () => {
    const item = makeItem()
    rowsByKey = new Map([[publishNonceKey('job-1', 1).toString(), [{ id: 'part-1', status: 'recorded', txHash: '0x1' }]]])
    runIn(item, 'attestationFailureRecoverable', { ...parkedContext, nonceKey: undefined })
    const actor = await PublishManager.createPublish(item, ADDRESS, fromEthersWallet(ethers.Wallet.createRandom()), {
      nonceKey: 'job-2',
    })
    expect(await partsSentUnderNonceKey(actor!.getSnapshot().context)).toBe(0)
  }, TEST_TIMEOUT_MS)

  test('a parked run that starts sending before the replacement is left alone', async () => {
    const item = makeItem()
    const parked = runIn(item, 'attestationFailureRecoverable', parkedContext)
    let sending: ReturnType<typeof runIn> | undefined
    // A retry moves the run on after Publish found it parked and before the replacement runs.
    beforeReplacing = () => {
      sending = runIn(item, 'attestationOutcomeUnknown')
      parked.stop()
    }
    const result = await startPublish(item, ADDRESS, fromEthersWallet(ethers.Wallet.createRandom()))
    expect(result.outcome).toBe('already_publishing')
    expect(sending!.getSnapshot().status).toBe('active')
    expect(PublishManager.getPublish(item.seedLocalId)).toBe(sending)
    expect(markInProgressPublishInterrupted).not.toHaveBeenCalled()
  }, TEST_TIMEOUT_MS)

  test('Publish on a seed with an open attempt is refused as attempt_open', async () => {
    const item = makeItem()
    const parked = runIn(item, 'attestationFailureRecoverable', parkedContext)
    attempts = [{ id: 'attempt-1', seedLocalId: item.seedLocalId, status: 'sent' }]
    expect(await PublishManager.publishBlocker(item.seedLocalId)).toBe('attempt_open')
    const result = await startPublish(item, ADDRESS, fromEthersWallet(ethers.Wallet.createRandom()))
    expect(result.outcome).toBe('attempt_open')
    expect(parked.getSnapshot().status).toBe('active')
    expect(PublishManager.getPublish(item.seedLocalId)).toBe(parked)
    expect(markInProgressPublishInterrupted).not.toHaveBeenCalled()
  }, TEST_TIMEOUT_MS)

  test('Publish on a running seed is still already_publishing', async () => {
    const item = makeItem()
    // A waiting state with no actor to invoke; any state but the parked ones counts as running.
    const running = runIn(item, 'attestationOutcomeUnknown')
    expect(await PublishManager.publishBlocker(item.seedLocalId)).toBe('running')
    const result = await startPublish(item, ADDRESS, fromEthersWallet(ethers.Wallet.createRandom()))
    expect(result.outcome).toBe('already_publishing')
    expect(running.getSnapshot().status).toBe('active')
  }, TEST_TIMEOUT_MS)

  test('a seed with no run and no attempt is none', async () => {
    expect(await PublishManager.publishBlocker(makeItem().seedLocalId)).toBe('none')
  }, TEST_TIMEOUT_MS)
})
