import { afterAll, afterEach, describe, expect, test } from 'bun:test'
import { BaseDb } from '@seedprotocol/sdk'
import { createActor, setup } from 'xstate'
import { setConfigRef } from '../../config'
import { restoreFromDb } from './actors/restoreFromDb'
import {
  isHoldingPublishLock,
  publishLockName,
  releaseAllPublishLocks,
  setPublishLockManagerForTests,
  tryHoldPublishLock,
} from './publishLocks'

/**
 * Stand-in for the origin-wide Web Locks manager (Bun has none). `otherTab` holds names the way
 * another open tab would.
 */
function fakeLockManager() {
  const heldNames = new Set<string>()
  const otherTab = {
    hold: (name: string) => heldNames.add(name),
    release: (name: string) => heldNames.delete(name),
  }
  const locks = {
    async request(name: string, options: LockOptions, callback: (lock: Lock | null) => unknown) {
      if (heldNames.has(name)) {
        if (options.ifAvailable) return callback(null)
        throw new Error('fake lock manager only supports ifAvailable for held names')
      }
      heldNames.add(name)
      try {
        return await callback({ name, mode: 'exclusive' } as Lock)
      } finally {
        heldNames.delete(name)
      }
    },
  } as unknown as Pick<LockManager, 'request'>
  return { locks, otherTab, heldNames }
}

const origReady = BaseDb.isAppDbReady.bind(BaseDb)
const origGet = BaseDb.getAppDb.bind(BaseDb)

afterEach(() => {
  setPublishLockManagerForTests(undefined)
  BaseDb.isAppDbReady = origReady
  BaseDb.getAppDb = origGet
})

afterAll(() => {
  setPublishLockManagerForTests(undefined)
  delete process.env.SEED_PUBLISH_RESTORE_WAIT_MS
  delete process.env.SEED_PUBLISH_RESTORE_POLL_MS
})

describe('publish locks', () => {
  test('a tab holds a seed until it releases it; another tab is refused meanwhile', async () => {
    const { locks, otherTab, heldNames } = fakeLockManager()
    setPublishLockManagerForTests(locks)

    expect(await tryHoldPublishLock('seed-a')).toBe(true)
    expect(await tryHoldPublishLock('seed-a')).toBe(true) // already ours
    expect(heldNames.has(publishLockName('seed-a'))).toBe(true)

    otherTab.hold(publishLockName('seed-b'))
    expect(await tryHoldPublishLock('seed-b')).toBe(false)
    expect(isHoldingPublishLock('seed-b')).toBe(false)

    releaseAllPublishLocks()
    await new Promise((r) => setTimeout(r, 0))
    expect(heldNames.has(publishLockName('seed-a'))).toBe(false)
  })

  test("restoreFromDb skips a publish another tab is running and resumes the rest", async () => {
    const { locks, otherTab } = fakeLockManager()
    setPublishLockManagerForTests(locks)
    otherTab.hold(publishLockName('seed-elsewhere'))

    // A final-state snapshot restores without invoking any network actors.
    const row = (seedLocalId: string) => ({
      seedLocalId,
      status: 'in_progress',
      updatedAt: 1,
      persistedSnapshot: JSON.stringify({ status: 'active', value: 'failure', children: {}, context: { item: { seedLocalId } } }),
    })
    const rows = [row('seed-elsewhere'), row('seed-here')]
    BaseDb.isAppDbReady = () => true
    BaseDb.getAppDb = () => ({ select: () => ({ from: () => ({ where: async () => rows }) }) }) as never

    let restored: Map<string, { stop: () => void }> | undefined
    const machine = setup({ actors: { restoreFromDb } }).createMachine({
      initial: 'restoring',
      states: {
        restoring: {
          invoke: {
            src: 'restoreFromDb',
            input: () => ({ context: { publishProcesses: new Map(), subscriptions: new Map() } }),
          },
          on: {
            RESTORE_FROM_DB_DONE: {
              target: 'done',
              actions: ({ event }) => {
                restored = (event as unknown as { publishProcesses: typeof restored }).publishProcesses
              },
            },
          },
        },
        done: {},
      },
    })
    const actor = createActor(machine)
    actor.start()
    await waitFor(() => restored !== undefined)

    expect([...restored!.keys()]).toEqual(['seed-here'])
    expect(isHoldingPublishLock('seed-here')).toBe(true)
    expect(isHoldingPublishLock('seed-elsewhere')).toBe(false)
    restored!.forEach((process) => process.stop())
    actor.stop()
  })

  test('createPublish refuses a seed another tab is publishing and releases the lock when done', async () => {
    process.env.SEED_PUBLISH_RESTORE_WAIT_MS = '0'
    process.env.SEED_PUBLISH_RESTORE_POLL_MS = '1'
    setConfigRef({ uploadApiBaseUrl: 'http://127.0.0.1:9', rpcUrl: 'https://example.invalid/rpc' })
    const { locks, otherTab } = fakeLockManager()
    setPublishLockManagerForTests(locks)

    const { PublishManager } = await import('./index')
    await PublishManager.ready()
    const address = '0x00000000000000000000000000000000000000aa'
    const item = (seedLocalId: string) =>
      ({ seedLocalId, modelName: 'Post', schemaUid: '0xschema' }) as import('@seedprotocol/sdk').Item<any>

    otherTab.hold(publishLockName('seed-busy'))
    expect(await PublishManager.createPublish(item('seed-busy'), address)).toBeUndefined()
    expect(PublishManager.getService().getSnapshot().context.publishProcesses.has('seed-busy')).toBe(false)

    // Nothing spawned (no address): the lock this call took is given back.
    expect(await PublishManager.createPublish(item('seed-no-address'), ' ')).toBeUndefined()
    expect(isHoldingPublishLock('seed-no-address')).toBe(false)

    const actor = await PublishManager.createPublish(item('seed-mine'), address)
    expect(actor).toBeDefined()
    expect(isHoldingPublishLock('seed-mine')).toBe(true)
    if (actor!.getSnapshot().value === 'checking') actor!.send({ type: 'notOwner' })
    await waitFor(() => PublishManager.getService().getSnapshot().context.settledPublishes.has('seed-mine'))
    expect(isHoldingPublishLock('seed-mine')).toBe(false)
  })
})

async function waitFor(predicate: () => boolean) {
  const deadline = Date.now() + 4000
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((r) => setTimeout(r, 15))
  }
  throw new Error('timed out waiting for condition')
}
