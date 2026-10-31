import { afterAll, describe, expect, test } from 'bun:test'
import { BaseDb } from '@seedprotocol/sdk'
import { createActor, setup } from 'xstate'
import { setConfigRef } from '../../config'
import { restoreFromDb } from './actors/restoreFromDb'
import { PublishManager, publishManagerMachine } from './index'
import { TEST_TIMEOUT_MS, waitUntilOrThrow } from '../../../test-utils/waitUntil'

const origReady = BaseDb.isAppDbReady.bind(BaseDb)
const origGet = BaseDb.getAppDb.bind(BaseDb)

function restoreDb() {
  BaseDb.isAppDbReady = origReady
  BaseDb.getAppDb = origGet
}

afterAll(() => {
  restoreDb()
  delete process.env.SEED_PUBLISH_RESTORE_WAIT_MS
  delete process.env.SEED_PUBLISH_RESTORE_POLL_MS
})

describe('restoreFromDb', () => {
  test('sends RESTORE_FROM_DB_DONE once when the db is not ready, and once when restore throws', async () => {
    process.env.SEED_PUBLISH_RESTORE_WAIT_MS = '0'
    process.env.SEED_PUBLISH_RESTORE_POLL_MS = '1'

    const machine = setup({
      actors: { restoreFromDb },
    }).createMachine({
      initial: 'restoreFromDb',
      states: {
        restoreFromDb: {
          invoke: {
            src: 'restoreFromDb',
            input: () => ({
              context: { publishProcesses: new Map(), subscriptions: new Map() },
            }),
          },
          on: { RESTORE_FROM_DB_DONE: 'active' },
        },
        active: {},
      },
    })

    let restores = 0
    const quiet = createActor(machine, {
      inspect: (ev) => {
        if (ev.type === '@xstate.event' && ev.event.type === 'RESTORE_FROM_DB_DONE') restores += 1
      },
    })
    quiet.start()
    await waitForValue(quiet, 'active')
    expect(restores).toBe(1)
    quiet.stop()

    restores = 0
    let calls = 0
    BaseDb.isAppDbReady = () => true
    BaseDb.getAppDb = () => {
      calls += 1
      if (calls === 1) return { ready: true }
      throw new Error('restore select failed')
    }
    const failing = createActor(machine, {
      inspect: (ev) => {
        if (ev.type === '@xstate.event' && ev.event.type === 'RESTORE_FROM_DB_DONE') restores += 1
      },
    })
    failing.start()
    await waitForValue(failing, 'active')
    expect(restores).toBe(1)
    failing.stop()
    restoreDb()
  }, TEST_TIMEOUT_MS)
})

describe('restore status', () => {
  const managerActor = () =>
    createActor(publishManagerMachine, {
      input: {
        publishProcesses: new Map(),
        subscriptions: new Map(),
        pendingCreates: [],
        settledPublishes: new Map(),
        restoreStatus: { outcome: 'pending' },
      },
    })
  const statusOf = (actor: ReturnType<typeof managerActor>) => actor.getSnapshot().context.restoreStatus
  const dbWithRows = (rows: unknown[]) => ({
    select: () => ({ from: () => ({ where: async () => rows }) }),
  })
  const setDb = (db: unknown) => {
    BaseDb.isAppDbReady = () => true
    BaseDb.getAppDb = () => db as ReturnType<typeof origGet>
  }
  const row = (seedLocalId: string, persistedSnapshot: string) => ({
    seedLocalId,
    persistedSnapshot,
    updatedAt: 1,
    modelName: 'Post',
  })
  const parked = (seedLocalId: string) =>
    JSON.stringify({
      status: 'active',
      value: 'attestationOutcomeUnknown',
      historyValue: {},
      children: {},
      context: { item: { seedLocalId } },
    })

  const settled = async (actor: ReturnType<typeof managerActor>, outcome: string) => {
    await waitUntilOrThrow(() => statusOf(actor).outcome === outcome, `restore status ${outcome}`)
  }

  test('reports a database that is not ready, then restores when it arrives', async () => {
    process.env.SEED_PUBLISH_RESTORE_WAIT_MS = '0'
    process.env.SEED_PUBLISH_RESTORE_POLL_MS = '1'
    BaseDb.isAppDbReady = () => false
    const actor = managerActor()
    actor.start()
    await settled(actor, 'dbNotReady')

    setDb(dbWithRows([row('lateSeed', parked('lateSeed'))]))
    await settled(actor, 'restored')
    expect(actor.getSnapshot().context.publishProcesses.has('lateSeed')).toBe(true)
    actor.stop()
    restoreDb()
  }, TEST_TIMEOUT_MS)

  test('a late restore leaves a publish started in the meantime alone', async () => {
    process.env.SEED_PUBLISH_RESTORE_WAIT_MS = '0'
    process.env.SEED_PUBLISH_RESTORE_POLL_MS = '1'
    BaseDb.isAppDbReady = () => false
    const running = { id: 'running' }
    const actor = createActor(publishManagerMachine, {
      input: {} as never,
    })
    actor.start()
    await settled(actor, 'dbNotReady')
    actor.getSnapshot().context.publishProcesses.set('liveSeed', running as never)

    setDb(dbWithRows([row('liveSeed', parked('liveSeed'))]))
    await settled(actor, 'restored')
    expect(actor.getSnapshot().context.publishProcesses.get('liveSeed')).toBe(running as never)
    actor.stop()
    restoreDb()
  }, TEST_TIMEOUT_MS)

  test('reports a restore that threw, with its error', async () => {
    process.env.SEED_PUBLISH_RESTORE_WAIT_MS = '50'
    setDb({
      select: () => {
        throw new Error('restore select failed')
      },
    })
    const actor = managerActor()
    actor.start()
    await settled(actor, 'failed')
    expect((statusOf(actor).error as Error).message).toBe('restore select failed')
    actor.stop()
    restoreDb()
  }, TEST_TIMEOUT_MS)

  test('names saved publishes it can not read and restores the rest', async () => {
    process.env.SEED_PUBLISH_RESTORE_WAIT_MS = '50'
    setDb(dbWithRows([row('brokenSeed', '{not json'), row('fineSeed', parked('fineSeed'))]))
    const actor = managerActor()
    actor.start()
    await settled(actor, 'restored')
    expect(statusOf(actor).unreadableSeedLocalIds).toEqual(['brokenSeed'])
    expect(actor.getSnapshot().context.publishProcesses.has('fineSeed')).toBe(true)
    actor.stop()
    restoreDb()
  }, TEST_TIMEOUT_MS)

  test('stopping the manager stops the watch: nothing restores afterwards', async () => {
    process.env.SEED_PUBLISH_RESTORE_WAIT_MS = '0'
    process.env.SEED_PUBLISH_RESTORE_POLL_MS = '1'
    BaseDb.isAppDbReady = () => false
    const actor = managerActor()
    actor.start()
    await settled(actor, 'dbNotReady')
    actor.stop()
    let reads = 0
    setDb({
      select: () => {
        reads += 1
        return { from: () => ({ where: async () => [] }) }
      },
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(reads).toBe(0)
    restoreDb()
  }, TEST_TIMEOUT_MS)
})

describe('PublishManager on Node', () => {
  test('queues CREATE_PUBLISH during restore, keeps a fast failure visible, and allows another create', async () => {
    process.env.SEED_PUBLISH_RESTORE_WAIT_MS = '150'
    process.env.SEED_PUBLISH_RESTORE_POLL_MS = '40'
    setConfigRef({
      uploadApiBaseUrl: 'http://127.0.0.1:9',
      rpcUrl: 'https://example.invalid/rpc',
    })

    const { PublishManager } = await import('./index')
    const ready = PublishManager.ready()
    expect(PublishManager.getService().getSnapshot().value).toBe('restoreFromDb')

    const item = {
      seedLocalId: 'seed-fast-fail',
      modelName: 'Post',
      schemaUid: '0xschema',
      // An item no cache holds: createPublish takes no hold on it.
      getService: () => ({ getSnapshot: () => ({ status: 'stopped' }) }),
    } as unknown as import('@seedprotocol/sdk').Item<any>
    const address = '0x00000000000000000000000000000000000000aa'

    const spawned = PublishManager.createPublish(item, address)
    await ready
    expect(PublishManager.getService().getSnapshot().value).toBe('active')
    const actor = await spawned
    expect(actor).toBeDefined()
    expect(PublishManager.getPublish(item.seedLocalId)).toBe(actor)
    // query only reads: the publish keeps running.
    expect(PublishManager.query(item.seedLocalId)).toBe(actor!.getSnapshot())
    expect(PublishManager.getService().getSnapshot().context.publishProcesses.get(item.seedLocalId)).toBe(actor)
    expect(PublishManager.query('seed-never-published')).toBeUndefined()

    const duplicate = await PublishManager.createPublish(item, address)
    expect(duplicate).toBeUndefined()

    if (actor!.getSnapshot().value === 'checking') {
      actor!.send({ type: 'notOwner' })
    }

    await waitUntilOrThrow(() => {
      const ctx = PublishManager.getService().getSnapshot().context
      return !ctx.publishProcesses.has(item.seedLocalId) && ctx.settledPublishes.has(item.seedLocalId)
    }, `publish ${item.seedLocalId} to move from publishProcesses to settledPublishes`)

    const settled = PublishManager.getPublish(item.seedLocalId)
    expect(settled).toBe(actor)
    expect(settled!.getSnapshot().value).toBe('failure')
    expect(settled!.getSnapshot().context.error).toBeTruthy()

    const again = await PublishManager.createPublish(item, address)
    expect(again).toBeDefined()
    expect(again).not.toBe(actor)
    expect(PublishManager.getService().getSnapshot().context.publishProcesses.has(item.seedLocalId)).toBe(true)
  }, TEST_TIMEOUT_MS)

  test('createPublish resolves undefined when the address is missing', async () => {
    const { PublishManager } = await import('./index')
    await PublishManager.ready()
    const missing = await PublishManager.createPublish(
      { seedLocalId: 'seed-no-address' } as import('@seedprotocol/sdk').Item<any>,
      '   ',
    )
    expect(missing).toBeUndefined()
  })
})

function waitForValue(actor: { getSnapshot: () => { value: unknown } }, value: string) {
  return waitUntilOrThrow(
    () => actor.getSnapshot().value === value,
    `restoreFromDb test machine to reach '${value}' (still '${String(actor.getSnapshot().value)}')`,
  )
}

describe('PublishManager restore status', () => {
  test('hosts can read the status and hear when it changes', async () => {
    process.env.SEED_PUBLISH_RESTORE_WAIT_MS = '0'
    process.env.SEED_PUBLISH_RESTORE_POLL_MS = '1'
    BaseDb.isAppDbReady = () => false
    await PublishManager.ready()
    expect(PublishManager.getRestoreStatus().outcome).toBe('dbNotReady')

    const heard: string[] = []
    const unsubscribe = PublishManager.onRestoreStatus((status) => heard.push(status.outcome))
    BaseDb.isAppDbReady = () => true
    BaseDb.getAppDb = () =>
      ({ select: () => ({ from: () => ({ where: async () => [] }) }) }) as unknown as ReturnType<typeof origGet>
    await waitUntilOrThrow(() => heard.length > 0, 'the status change')
    expect(heard).toEqual(['restored'])
    expect(PublishManager.getRestoreStatus().outcome).toBe('restored')
    unsubscribe()
    restoreDb()
  }, TEST_TIMEOUT_MS)
})
