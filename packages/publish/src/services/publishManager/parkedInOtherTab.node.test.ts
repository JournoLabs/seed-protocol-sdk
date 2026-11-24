import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from 'bun:test'
import { ethers } from 'ethers'

/**
 * A publish parked in another tab (#49): that tab holds the seed's publish lock, and the shared
 * `publish_processes` row has its saved state. This tab tells it apart from one running there.
 */
const realSdk = await import('@seedprotocol/sdk')
mock.module('@seedprotocol/sdk', () => ({
  ...realSdk,
  findOpenPublishAttempts: async () => [],
}))

const { BaseDb } = realSdk
const { createActor } = await import('xstate')
const { setConfigRef } = await import('../../config')
const { publishMachine } = await import('../publish')
const { PublishManager } = await import('./index')
const { startPublish } = await import('../../helpers/ensureWalletThenPublish')
const { publishLockName, setPublishLockManagerForTests } = await import('./publishLocks')
const { TEST_TIMEOUT_MS } = await import('../../../test-utils/waitUntil')
const { fakeLockManager } = await import('../../../test-utils/fakeLockManager')

const ADDRESS = ethers.Wallet.createRandom().address
const origReady = BaseDb.isAppDbReady.bind(BaseDb)
const origGet = BaseDb.getAppDb.bind(BaseDb)

type Row = { status: string; persistedSnapshot: string; completedAt?: number | null }

/** An app DB whose every select resolves to `rows`. */
function dbWith(rows: Row[]) {
  const chain: Record<string, unknown> = {}
  for (const method of ['select', 'from', 'where', 'orderBy', 'limit']) chain[method] = () => chain
  chain.then = (onFulfilled?: (r: unknown[]) => unknown, onRejected?: (e: unknown) => unknown) =>
    Promise.resolve(rows).then(onFulfilled, onRejected)
  return chain
}

const rowIn = (value: string, status = 'in_progress'): Row => ({
  status,
  persistedSnapshot: JSON.stringify({ status: 'active', value }),
})

let n = 0
let otherTab: ReturnType<typeof fakeLockManager>['otherTab']

/** A seed another tab publishes, whose latest row is `rows[0]`. */
function seedInOtherTab(rows: Row[]) {
  const seedLocalId = `seed-other-tab-${++n}`
  otherTab.hold(publishLockName(seedLocalId))
  BaseDb.getAppDb = (() => dbWith(rows)) as unknown as typeof BaseDb.getAppDb
  return seedLocalId
}

beforeAll(async () => {
  process.env.SEED_PUBLISH_RESTORE_WAIT_MS = '0'
  setConfigRef({ uploadApiBaseUrl: 'http://127.0.0.1:9', rpcUrl: 'https://example.invalid/rpc' })
  await PublishManager.ready()
})

afterEach(() => {
  setPublishLockManagerForTests(undefined)
  BaseDb.isAppDbReady = origReady
  BaseDb.getAppDb = origGet
  PublishManager.stopAll()
})

afterAll(() => {
  delete process.env.SEED_PUBLISH_RESTORE_WAIT_MS
})

function useFakeLocks() {
  const fake = fakeLockManager()
  setPublishLockManagerForTests(fake.locks)
  otherTab = fake.otherTab
  BaseDb.isAppDbReady = () => true
}

describe('publishBlocker with another tab', () => {
  test('another tab parked: publishBlocker is parked_in_other_tab', async () => {
    useFakeLocks()
    for (const state of ['attestationFailureRecoverable', 'attestationFailureRecoverableDirectToEas']) {
      const seedLocalId = seedInOtherTab([rowIn(state)])
      expect(await PublishManager.publishBlocker(seedLocalId)).toBe('parked_in_other_tab')
    }
  }, TEST_TIMEOUT_MS)

  test('another tab running: publishBlocker is running_in_other_tab', async () => {
    useFakeLocks()
    const seedLocalId = seedInOtherTab([rowIn('creatingAttestations')])
    expect(await PublishManager.publishBlocker(seedLocalId)).toBe('running_in_other_tab')
  }, TEST_TIMEOUT_MS)

  test('another tab holds the lock before its first save: running_in_other_tab', async () => {
    useFakeLocks()
    expect(await PublishManager.publishBlocker(seedInOtherTab([]))).toBe('running_in_other_tab')
    expect(await PublishManager.publishBlocker(seedInOtherTab([rowIn('attestationFailureRecoverable', 'completed')]))).toBe(
      'running_in_other_tab',
    )
  }, TEST_TIMEOUT_MS)

  test('another tab holds the lock and the database is not ready: running_in_other_tab', async () => {
    useFakeLocks()
    const seedLocalId = seedInOtherTab([rowIn('attestationFailureRecoverable')])
    BaseDb.isAppDbReady = () => false
    expect(await PublishManager.publishBlocker(seedLocalId)).toBe('running_in_other_tab')
  }, TEST_TIMEOUT_MS)

  test("a saved state that doesn't parse: running_in_other_tab", async () => {
    useFakeLocks()
    const seedLocalId = seedInOtherTab([{ status: 'in_progress', persistedSnapshot: '{' }])
    expect(await PublishManager.publishBlocker(seedLocalId)).toBe('running_in_other_tab')
  }, TEST_TIMEOUT_MS)

  test('no tab holds the lock: none, whatever the row says', async () => {
    useFakeLocks()
    BaseDb.getAppDb = (() => dbWith([rowIn('attestationFailureRecoverable')])) as unknown as typeof BaseDb.getAppDb
    expect(await PublishManager.publishBlocker('seed-orphaned')).toBe('none')
  }, TEST_TIMEOUT_MS)

  test("this tab's parked run is parked, not parked_in_other_tab", async () => {
    useFakeLocks()
    const seedLocalId = `seed-here-${++n}`
    const item = { seedLocalId, modelName: 'Post', schemaUid: '0xschema' }
    const snapshot = publishMachine.resolveState({
      value: 'attestationFailureRecoverable',
      context: { item, address: ADDRESS } as never,
    })
    const run = createActor(publishMachine, { snapshot }).start()
    PublishManager.getService().getSnapshot().context.publishProcesses.set(seedLocalId, run)
    BaseDb.getAppDb = (() => dbWith([rowIn('attestationFailureRecoverable')])) as unknown as typeof BaseDb.getAppDb
    expect(await PublishManager.publishBlocker(seedLocalId)).toBe('parked')
  }, TEST_TIMEOUT_MS)
})

describe('startPublish with another tab', () => {
  const itemFor = (seedLocalId: string) =>
    ({
      seedLocalId,
      modelName: 'Post',
      schemaUid: '0xschema',
      // An item no cache holds: createPublish takes no hold on it.
      getService: () => ({ getSnapshot: () => ({ status: 'stopped' }) }),
    }) as unknown as import('@seedprotocol/sdk').Item<Record<string, unknown>>

  test('startPublish with another tab parked returns parked_in_other_tab', async () => {
    useFakeLocks()
    const seedLocalId = seedInOtherTab([rowIn('attestationFailureRecoverable')])
    const result = await startPublish(itemFor(seedLocalId), ADDRESS)
    expect(result).toEqual({ outcome: 'parked_in_other_tab' })
    expect(PublishManager.getService().getSnapshot().context.publishProcesses.has(seedLocalId)).toBe(false)
  }, TEST_TIMEOUT_MS)

  test('startPublish with another tab running returns already_publishing', async () => {
    useFakeLocks()
    const seedLocalId = seedInOtherTab([rowIn('creatingAttestations')])
    expect(await startPublish(itemFor(seedLocalId), ADDRESS)).toEqual({ outcome: 'already_publishing' })
  }, TEST_TIMEOUT_MS)
})
