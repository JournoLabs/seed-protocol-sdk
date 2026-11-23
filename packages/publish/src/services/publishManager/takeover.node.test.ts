import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from 'bun:test'

/**
 * A publish left running by a closed tab (#48): this tab queues for the seed's publish lock and,
 * once the tab holding it lets go, resumes the publish from its saved row, as a reload would.
 */
const realSdk = await import('@seedprotocol/sdk')
const realSavePublish = await import('./actors/savePublish')
const interrupted: string[] = []
mock.module('@seedprotocol/sdk', () => ({
  ...realSdk,
  findOpenPublishAttempts: async () => [],
}))
mock.module('./actors/savePublish', () => ({
  ...realSavePublish,
  markInProgressPublishInterrupted: async (seedLocalId: string) => void interrupted.push(seedLocalId),
}))

const { BaseDb } = realSdk
const { setConfigRef } = await import('../../config')
const { PublishManager } = await import('./index')
const { watchForTakeover } = await import('./takeover')
const { publishLockHolder, publishLockName, setPublishLockManagerForTests } = await import('./publishLocks')
const { TEST_TIMEOUT_MS, waitUntilOrThrow } = await import('../../../test-utils/waitUntil')
const { fakeLockManager } = await import('../../../test-utils/fakeLockManager')

const origReady = BaseDb.isAppDbReady.bind(BaseDb)
const origGet = BaseDb.getAppDb.bind(BaseDb)

type Row = { seedLocalId: string; status: string; updatedAt: number; persistedSnapshot: string }

/** The `publish_processes` rows; each test holds only its own seed's, so every select answers with them. */
let rows: Row[] = []
const db = () => {
  const chain: Record<string, unknown> = {}
  for (const method of ['select', 'from', 'where', 'orderBy', 'limit']) chain[method] = () => chain
  chain.then = (onFulfilled?: (r: unknown[]) => unknown, onRejected?: (e: unknown) => unknown) =>
    Promise.resolve(rows).then(onFulfilled, onRejected)
  return chain
}

const savedRow = (seedLocalId: string, value: string, status = 'in_progress'): Row => ({
  seedLocalId,
  status,
  updatedAt: 1,
  persistedSnapshot: JSON.stringify({
    status: 'active',
    value,
    children: {},
    context: { item: { seedLocalId, modelName: 'Post' }, address: '0x0000000000000000000000000000000000000001' },
  }),
})

const fake = fakeLockManager()
const runHere = (seedLocalId: string) => PublishManager.getService().getSnapshot().context.publishProcesses.get(seedLocalId)
const valueOf = (seedLocalId: string) => String((runHere(seedLocalId)?.getSnapshot() as { value?: unknown }).value)

beforeAll(async () => {
  process.env.SEED_PUBLISH_RESTORE_WAIT_MS = '0'
  setConfigRef({ uploadApiBaseUrl: 'http://127.0.0.1:9', rpcUrl: 'https://example.invalid/rpc' })
  setPublishLockManagerForTests(fake.locks)
  BaseDb.isAppDbReady = () => true
  BaseDb.getAppDb = db as unknown as typeof BaseDb.getAppDb
  // At load, another open tab runs this publish.
  rows = [savedRow('seed-held-at-load', 'attestationFailureRecoverable')]
  fake.otherTab.hold(publishLockName('seed-held-at-load'))
  await PublishManager.ready()
})

afterEach(() => {
  rows = []
})

afterAll(() => {
  PublishManager.stopAll()
  setPublishLockManagerForTests(undefined)
  BaseDb.isAppDbReady = origReady
  BaseDb.getAppDb = origGet
  delete process.env.SEED_PUBLISH_RESTORE_WAIT_MS
})

describe('taking over a publish left by a closed tab', () => {
  test('a publish another tab ran at load resumes here once that tab closes', async () => {
    rows = [savedRow('seed-held-at-load', 'attestationFailureRecoverable')]
    expect(runHere('seed-held-at-load')).toBeUndefined()

    fake.otherTab.release(publishLockName('seed-held-at-load'))
    await waitUntilOrThrow(() => runHere('seed-held-at-load') !== undefined, 'the publish to resume here')
    expect(valueOf('seed-held-at-load')).toBe('attestationFailureRecoverable')
    expect(await publishLockHolder('seed-held-at-load')).toBe('here')
  }, TEST_TIMEOUT_MS)

  test('a publish that finished before the lock came free is not resumed, and the lock is let go', async () => {
    rows = [savedRow('seed-finished', 'attestationFailureRecoverable')]
    fake.otherTab.hold(publishLockName('seed-finished'))
    watchForTakeover('seed-finished')

    rows = [savedRow('seed-finished', 'success', 'completed')]
    fake.otherTab.release(publishLockName('seed-finished'))
    await waitUntilOrThrow(async () => (await publishLockHolder('seed-finished')) === 'none', 'the lock to be let go')
    expect(runHere('seed-finished')).toBeUndefined()
  }, TEST_TIMEOUT_MS)

  test("a publish that can't resume here is marked interrupted, as at load", async () => {
    rows = [savedRow('seed-mid-upload', 'uploadingViaBundler')]
    fake.otherTab.hold(publishLockName('seed-mid-upload'))
    watchForTakeover('seed-mid-upload')

    fake.otherTab.release(publishLockName('seed-mid-upload'))
    await waitUntilOrThrow(() => interrupted.includes('seed-mid-upload'), 'the publish to be marked interrupted')
    await waitUntilOrThrow(async () => (await publishLockHolder('seed-mid-upload')) === 'none', 'the lock to be let go')
    expect(runHere('seed-mid-upload')).toBeUndefined()
  }, TEST_TIMEOUT_MS)

  test('stopAll stops waiting: a later release resumes nothing', async () => {
    rows = [savedRow('seed-stopped', 'attestationFailureRecoverable')]
    fake.otherTab.hold(publishLockName('seed-stopped'))
    watchForTakeover('seed-stopped')
    expect((await fake.locks.query()).pending).toHaveLength(1)

    PublishManager.stopAll()
    await waitUntilOrThrow(async () => (await fake.locks.query()).pending?.length === 0, 'the wait to be dropped')
    fake.otherTab.release(publishLockName('seed-stopped'))
    expect(await publishLockHolder('seed-stopped')).toBe('none')
    expect(runHere('seed-stopped')).toBeUndefined()
  }, TEST_TIMEOUT_MS)
})
