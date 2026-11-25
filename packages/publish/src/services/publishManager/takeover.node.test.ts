import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from 'bun:test'

/**
 * A publish left running by a closed tab (#48): this tab queues for the seed's publish lock and,
 * once the tab holding it lets go, resumes the publish from its saved row, as a reload would.
 */
const realSdk = await import('@seedprotocol/sdk')
const realSavePublish = await import('./actors/savePublish')
const interrupted: string[] = []
/** Holds `markInProgressPublishInterrupted` and every row read until opened. */
let markGate: Promise<void> = Promise.resolve()
let readGate: Promise<void> = Promise.resolve()
const gate = () => {
  let open = () => {}
  const closed = new Promise<void>((resolve) => (open = resolve))
  return { closed, open }
}
/** What this tab told other tabs, and its listener for what they tell it (the tab channel). */
const announced: string[] = []
let lockTakenElsewhere: (seedLocalId: string) => void = () => {}
mock.module('@seedprotocol/sdk', () => ({
  ...realSdk,
  findOpenPublishAttempts: async () => [],
  announcePublishLockTaken: (seedLocalId: string) => void announced.push(seedLocalId),
  onPublishLockTaken: (listener: (seedLocalId: string) => void) => {
    lockTakenElsewhere = listener
    return () => {}
  },
}))
mock.module('./actors/savePublish', () => ({
  ...realSavePublish,
  markInProgressPublishInterrupted: async (seedLocalId: string) => {
    await markGate
    interrupted.push(seedLocalId)
  },
}))

const { BaseDb } = realSdk
const { setConfigRef } = await import('../../config')
const { PublishManager } = await import('./index')
const { watchForTakeover } = await import('./takeover')
const { ethers } = await import('ethers')
const { fromEthersWallet } = await import('../../helpers/seedSigner')
const { onPublishLockHolderChange, publishLockHolder, publishLockName, setPublishLockManagerForTests } = await import(
  './publishLocks'
)
const { TEST_TIMEOUT_MS, waitUntilOrThrow } = await import('../../../test-utils/waitUntil')
const { fakeLockManager } = await import('../../../test-utils/fakeLockManager')
const { clearPublishWallet, setPublishWallet } = await import('../../helpers/publishWalletRegistry')

const origReady = BaseDb.isAppDbReady.bind(BaseDb)
const origGet = BaseDb.getAppDb.bind(BaseDb)

type Row = { seedLocalId: string; status: string; updatedAt: number; persistedSnapshot: string }

/** The `publish_processes` rows; each test holds only its own seed's, so every select answers with them. */
let rows: Row[] = []
const db = () => {
  const chain: Record<string, unknown> = {}
  for (const method of ['select', 'from', 'where', 'orderBy', 'limit']) chain[method] = () => chain
  chain.then = (onFulfilled?: (r: unknown[]) => unknown, onRejected?: (e: unknown) => unknown) =>
    readGate.then(() => rows).then(onFulfilled, onRejected)
  return chain
}

/** The address the saved publishes run as, and this tab's publish wallet unless a test changes it. */
const PUBLISHER = '0x00000000000000000000000000000000000000aB'
const OTHER_ACCOUNT = '0x00000000000000000000000000000000000000cD'
const THIRD_ACCOUNT = '0x00000000000000000000000000000000000000eF'
/** Only the publish restore at load leaves: no other test's wallet re-checks it. */
const LOAD_ACCOUNT = '0x0000000000000000000000000000000000000012'

const savedRow = (seedLocalId: string, value: string, status = 'in_progress', address = PUBLISHER): Row => ({
  seedLocalId,
  status,
  updatedAt: 1,
  persistedSnapshot: JSON.stringify({
    status: 'active',
    value,
    children: {},
    context: { item: { seedLocalId, modelName: 'Post' }, address },
  }),
})

/** A publish wallet that publishes as `address`. Not awaited: registering waits for an SDK client. */
const useWallet = (address: string) =>
  void setPublishWallet({
    signer: { address },
    txSender: { address },
    publisherAddress: address,
  } as unknown as import('../../helpers/publishWalletRegistry').PublishWalletSession)

/** An item no cache holds: createPublish takes no hold on it. */
const stubItem = (seedLocalId: string) =>
  ({
    seedLocalId,
    modelName: 'Post',
    schemaUid: '0xschema',
    getService: () => ({ getSnapshot: () => ({ status: 'stopped' }) }),
  }) as unknown as import('@seedprotocol/sdk').Item<Record<string, unknown>>

const fake = fakeLockManager()
const runHere = (seedLocalId: string) => PublishManager.getService().getSnapshot().context.publishProcesses.get(seedLocalId)
const valueOf = (seedLocalId: string) => String((runHere(seedLocalId)?.getSnapshot() as { value?: unknown }).value)

beforeAll(async () => {
  process.env.SEED_PUBLISH_RESTORE_WAIT_MS = '0'
  setConfigRef({ uploadApiBaseUrl: 'http://127.0.0.1:9', rpcUrl: 'https://example.invalid/rpc' })
  setPublishLockManagerForTests(fake.locks)
  BaseDb.isAppDbReady = () => true
  BaseDb.getAppDb = db as unknown as typeof BaseDb.getAppDb
  useWallet(PUBLISHER)
  // At load, another open tab runs this publish, and one started by another account runs nowhere.
  rows = [
    savedRow('seed-held-at-load', 'attestationFailureRecoverable'),
    savedRow('seed-other-account-at-load', 'attestationFailureRecoverable', 'in_progress', LOAD_ACCOUNT),
  ]
  fake.otherTab.hold(publishLockName('seed-held-at-load'))
  await PublishManager.ready()
})

afterEach(() => {
  rows = []
})

afterAll(async () => {
  PublishManager.stopAll()
  await clearPublishWallet()
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
    expect(announced).toContain('seed-held-at-load')
  }, TEST_TIMEOUT_MS)

  test('a publish another tab started after this one loaded resumes here once that tab closes', async () => {
    const changed: string[] = []
    const unsubscribe = onPublishLockHolderChange((seedLocalId) => changed.push(seedLocalId))
    rows = [savedRow('seed-started-later', 'attestationFailureRecoverable')]
    fake.otherTab.hold(publishLockName('seed-started-later'))
    lockTakenElsewhere('seed-started-later')
    expect(changed).toEqual(['seed-started-later'])

    fake.otherTab.release(publishLockName('seed-started-later'))
    await waitUntilOrThrow(() => runHere('seed-started-later') !== undefined, 'the publish to resume here')
    unsubscribe()
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

  test('a tab that starts a publish tells the other tabs, so they can take it over', async () => {
    const item = stubItem('seed-started-here')
    const signer = ethers.Wallet.createRandom()
    const run = await PublishManager.createPublish(item, signer.address, fromEthersWallet(signer))
    expect(run).toBeDefined()
    expect(announced).toContain('seed-started-here')
    PublishManager.stopPublish('seed-started-here')
  }, TEST_TIMEOUT_MS)

  test('stopping a publish lets its lock go only once its row says interrupted', async () => {
    const mark = gate()
    markGate = mark.closed
    try {
      const signer = ethers.Wallet.createRandom()
      const run = await PublishManager.createPublish(stubItem('seed-stopped-here'), signer.address, fromEthersWallet(signer))
      expect(run).toBeDefined()
      PublishManager.stopPublish('seed-stopped-here')
      // A tab queued for the lock must not read the row as still in progress.
      expect(await publishLockHolder('seed-stopped-here')).toBe('here')
      mark.open()
      await waitUntilOrThrow(async () => (await publishLockHolder('seed-stopped-here')) === 'none', 'the lock to be let go')
      expect(interrupted).toContain('seed-stopped-here')
    } finally {
      markGate = Promise.resolve()
    }
  }, TEST_TIMEOUT_MS)

  test('a Publish in this tab while a takeover decides waits for it, and keeps the lock for its run', async () => {
    const read = gate()
    rows = [savedRow('seed-raced', 'success', 'completed')]
    fake.otherTab.hold(publishLockName('seed-raced'))
    watchForTakeover('seed-raced')
    readGate = read.closed
    try {
      // The other tab's publish ends; this tab is granted the lock and reads the row.
      fake.otherTab.release(publishLockName('seed-raced'))
      const signer = ethers.Wallet.createRandom()
      const started = PublishManager.createPublish(stubItem('seed-raced'), signer.address, fromEthersWallet(signer))
      read.open()
      const run = await started
      expect(run).toBeDefined()
      expect(runHere('seed-raced')).toBe(run)
      expect(await publishLockHolder('seed-raced')).toBe('here')
      expect(announced).toContain('seed-raced')
      PublishManager.stopPublish('seed-raced')
    } finally {
      readGate = Promise.resolve()
    }
  }, TEST_TIMEOUT_MS)

  test('a granted lock reports a holder change only when the takeover keeps it', async () => {
    const changed: string[] = []
    const unsubscribe = onPublishLockHolderChange((seedLocalId) => changed.push(seedLocalId))
    rows = [savedRow('seed-ended', 'success', 'completed')]
    fake.otherTab.hold(publishLockName('seed-ended'))
    watchForTakeover('seed-ended')
    fake.otherTab.release(publishLockName('seed-ended'))
    await waitUntilOrThrow(() => changed.length > 0, 'the lock to be let go')
    expect(await publishLockHolder('seed-ended')).toBe('none')
    // Released, never kept: one change (the release), no flash of 'here' before it.
    expect(changed).toEqual(['seed-ended'])
    unsubscribe()
  }, TEST_TIMEOUT_MS)

  test('a granted lock reports a holder change when the takeover keeps it', async () => {
    const changed: string[] = []
    const unsubscribe = onPublishLockHolderChange((seedLocalId) => changed.push(seedLocalId))
    rows = [savedRow('seed-kept', 'attestationFailureRecoverable')]
    fake.otherTab.hold(publishLockName('seed-kept'))
    watchForTakeover('seed-kept')
    fake.otherTab.release(publishLockName('seed-kept'))
    await waitUntilOrThrow(() => runHere('seed-kept') !== undefined, 'the publish to resume here')
    // Reported once the run has started, so the listener reads 'here'.
    expect(changed).toEqual(['seed-kept'])
    expect(await publishLockHolder('seed-kept')).toBe('here')
    unsubscribe()
  }, TEST_TIMEOUT_MS)

  test('stopAll while a takeover reads the row: nothing resumes, and the lock stays let go', async () => {
    const read = gate()
    rows = [savedRow('seed-stopped-mid-takeover', 'attestationFailureRecoverable')]
    fake.otherTab.hold(publishLockName('seed-stopped-mid-takeover'))
    watchForTakeover('seed-stopped-mid-takeover')
    readGate = read.closed
    try {
      fake.otherTab.release(publishLockName('seed-stopped-mid-takeover'))
      await waitUntilOrThrow(
        async () => (await publishLockHolder('seed-stopped-mid-takeover')) === 'here',
        'the lock to be granted',
      )
      PublishManager.stopAll()
      read.open()
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(runHere('seed-stopped-mid-takeover')).toBeUndefined()
      expect(await publishLockHolder('seed-stopped-mid-takeover')).toBe('none')
    } finally {
      readGate = Promise.resolve()
    }
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

describe("the taking tab's wallet", () => {
  afterEach(() => useWallet(PUBLISHER))

  /** Queues for the seed as a takeover would, then has the other tab let go of it. */
  const grantAfterOtherTab = (seedLocalId: string) => {
    fake.otherTab.hold(publishLockName(seedLocalId))
    watchForTakeover(seedLocalId)
    fake.otherTab.release(publishLockName(seedLocalId))
  }
  const holderChanges = () => {
    const changed: string[] = []
    const unsubscribe = onPublishLockHolderChange((seedLocalId) => changed.push(seedLocalId))
    return { changed, unsubscribe }
  }

  test("a tab whose wallet publishes as another address doesn't take the publish, and the holder stays 'none'", async () => {
    useWallet(OTHER_ACCOUNT)
    const { changed, unsubscribe } = holderChanges()
    rows = [savedRow('seed-wrong-wallet', 'attestationFailureRecoverable')]
    grantAfterOtherTab('seed-wrong-wallet')

    await waitUntilOrThrow(() => changed.includes('seed-wrong-wallet'), 'the granted lock to be let go')
    expect(await publishLockHolder('seed-wrong-wallet')).toBe('none')
    expect(runHere('seed-wrong-wallet')).toBeUndefined()
    expect(announced).not.toContain('seed-wrong-wallet')
    expect(interrupted).not.toContain('seed-wrong-wallet')
    unsubscribe()
  }, TEST_TIMEOUT_MS)

  test('a tab with no publish wallet does not take the publish', async () => {
    await clearPublishWallet()
    const { changed, unsubscribe } = holderChanges()
    rows = [savedRow('seed-no-wallet', 'attestationFailureRecoverable')]
    grantAfterOtherTab('seed-no-wallet')

    await waitUntilOrThrow(() => changed.includes('seed-no-wallet'), 'the granted lock to be let go')
    expect(await publishLockHolder('seed-no-wallet')).toBe('none')
    expect(runHere('seed-no-wallet')).toBeUndefined()
    unsubscribe()
  }, TEST_TIMEOUT_MS)

  test('a lock the wrong wallet lets go goes to the next tab in the queue', async () => {
    useWallet(OTHER_ACCOUNT)
    const name = publishLockName('seed-next-in-queue')
    rows = [savedRow('seed-next-in-queue', 'attestationFailureRecoverable')]
    fake.otherTab.hold(name)
    watchForTakeover('seed-next-in-queue')
    // A third tab queues behind this one.
    let nextTabGranted = false
    void fake.locks.request(name, {}, async () => {
      nextTabGranted = true
    })

    fake.otherTab.release(name)
    await waitUntilOrThrow(() => nextTabGranted, 'the next tab in the queue to be granted the lock')
    expect(runHere('seed-next-in-queue')).toBeUndefined()
  }, TEST_TIMEOUT_MS)

  test('a wallet that publishes as the address the publish runs as takes it, whatever the letter case', async () => {
    useWallet(PUBLISHER.toLowerCase())
    rows = [savedRow('seed-right-wallet', 'attestationFailureRecoverable')]
    grantAfterOtherTab('seed-right-wallet')

    await waitUntilOrThrow(() => runHere('seed-right-wallet') !== undefined, 'the publish to resume here')
    expect(await publishLockHolder('seed-right-wallet')).toBe('here')
    expect(announced).toContain('seed-right-wallet')
  }, TEST_TIMEOUT_MS)

  test('a wallet that owns the address the publish runs as takes it', async () => {
    // A smart account publishing for its admin EOA lists both: the publish ran as one of them.
    void setPublishWallet({
      signer: { address: OTHER_ACCOUNT },
      txSender: { address: OTHER_ACCOUNT },
      publisherAddress: OTHER_ACCOUNT,
      ownedAddresses: [PUBLISHER],
    } as unknown as import('../../helpers/publishWalletRegistry').PublishWalletSession)
    rows = [savedRow('seed-owned-address', 'attestationFailureRecoverable')]
    grantAfterOtherTab('seed-owned-address')

    await waitUntilOrThrow(() => runHere('seed-owned-address') !== undefined, 'the publish to resume here')
  }, TEST_TIMEOUT_MS)

  test('switching this tab to the right wallet later takes the publish; another wallet does not', async () => {
    useWallet(OTHER_ACCOUNT)
    const { changed, unsubscribe } = holderChanges()
    rows = [savedRow('seed-switched-later', 'attestationFailureRecoverable')]
    grantAfterOtherTab('seed-switched-later')
    await waitUntilOrThrow(() => changed.includes('seed-switched-later'), 'the granted lock to be let go')

    useWallet(THIRD_ACCOUNT)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(runHere('seed-switched-later')).toBeUndefined()
    expect(await publishLockHolder('seed-switched-later')).toBe('none')

    useWallet(PUBLISHER)
    await waitUntilOrThrow(() => runHere('seed-switched-later') !== undefined, 'the publish to resume here')
    expect(await publishLockHolder('seed-switched-later')).toBe('here')
    expect(announced).toContain('seed-switched-later')
    unsubscribe()
  }, TEST_TIMEOUT_MS)

  test('the right wallet connecting while the wrong one lets the lock go still takes the publish', async () => {
    useWallet(OTHER_ACCOUNT)
    // Switches as the release is reported, before the takeover has finished.
    const unsubscribe = onPublishLockHolderChange((seedLocalId) => {
      if (seedLocalId === 'seed-switched-at-release') useWallet(PUBLISHER)
    })
    rows = [savedRow('seed-switched-at-release', 'attestationFailureRecoverable')]
    grantAfterOtherTab('seed-switched-at-release')

    await waitUntilOrThrow(() => runHere('seed-switched-at-release') !== undefined, 'the publish to resume here')
    unsubscribe()
  }, TEST_TIMEOUT_MS)

  test('a publish restore at load left for another account resumes when that account connects', async () => {
    rows = [savedRow('seed-other-account-at-load', 'attestationFailureRecoverable', 'in_progress', LOAD_ACCOUNT)]
    expect(runHere('seed-other-account-at-load')).toBeUndefined()
    expect(await publishLockHolder('seed-other-account-at-load')).toBe('none')

    useWallet(LOAD_ACCOUNT)
    await waitUntilOrThrow(() => runHere('seed-other-account-at-load') !== undefined, 'the publish to resume here')
    expect(await publishLockHolder('seed-other-account-at-load')).toBe('here')
  }, TEST_TIMEOUT_MS)

  test('after stopAll, connecting a wallet queues again for the publishes this tab was waiting on', async () => {
    rows = [savedRow('seed-waiting-at-stop', 'attestationFailureRecoverable')]
    fake.otherTab.hold(publishLockName('seed-waiting-at-stop'))
    watchForTakeover('seed-waiting-at-stop')
    // The host stops everything when the account changes, then registers the new one.
    PublishManager.stopAll()
    await waitUntilOrThrow(async () => (await fake.locks.query()).pending?.length === 0, 'the wait to be dropped')
    useWallet(OTHER_ACCOUNT)
    await waitUntilOrThrow(async () => (await fake.locks.query()).pending?.length === 1, 'this tab to queue again')

    fake.otherTab.release(publishLockName('seed-waiting-at-stop'))
    // The new account isn't the publish's: it isn't taken.
    await waitUntilOrThrow(async () => (await publishLockHolder('seed-waiting-at-stop')) === 'none', 'the lock to be let go')
    expect(runHere('seed-waiting-at-stop')).toBeUndefined()
  }, TEST_TIMEOUT_MS)

  test('a publish stopAll stopped here resumes when its account connects again', async () => {
    rows = [savedRow('seed-stopped-and-back', 'attestationFailureRecoverable')]
    grantAfterOtherTab('seed-stopped-and-back')
    await waitUntilOrThrow(() => runHere('seed-stopped-and-back') !== undefined, 'the publish to resume here')

    PublishManager.stopAll()
    await clearPublishWallet()
    await waitUntilOrThrow(async () => (await publishLockHolder('seed-stopped-and-back')) === 'none', 'the lock to be let go')
    expect(runHere('seed-stopped-and-back')).toBeUndefined()

    useWallet(PUBLISHER)
    await waitUntilOrThrow(() => runHere('seed-stopped-and-back') !== undefined, 'the publish to resume here again')
  }, TEST_TIMEOUT_MS)
})
