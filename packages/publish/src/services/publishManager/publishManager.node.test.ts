import { afterAll, describe, expect, test } from 'bun:test'
import { BaseDb } from '@seedprotocol/sdk'
import { createActor, setup } from 'xstate'
import { setConfigRef } from '../../config'
import { restoreFromDb } from './actors/restoreFromDb'

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
  })
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
    } as import('@seedprotocol/sdk').Item<any>
    const address = '0x00000000000000000000000000000000000000aa'

    const spawned = PublishManager.createPublish(item, address)
    await ready
    expect(PublishManager.getService().getSnapshot().value).toBe('active')
    const actor = await spawned
    expect(actor).toBeDefined()
    expect(PublishManager.getPublish(item.seedLocalId)).toBe(actor)

    const duplicate = await PublishManager.createPublish(item, address)
    expect(duplicate).toBeUndefined()

    if (actor!.getSnapshot().value === 'checking') {
      actor!.send({ type: 'notOwner' })
    }

    await waitFor(() => {
      const ctx = PublishManager.getService().getSnapshot().context
      return !ctx.publishProcesses.has(item.seedLocalId) && ctx.settledPublishes.has(item.seedLocalId)
    })

    const settled = PublishManager.getPublish(item.seedLocalId)
    expect(settled).toBe(actor)
    expect(settled!.getSnapshot().value).toBe('failure')
    expect(settled!.getSnapshot().context.error).toBeTruthy()

    const again = await PublishManager.createPublish(item, address)
    expect(again).toBeDefined()
    expect(again).not.toBe(actor)
    expect(PublishManager.getService().getSnapshot().context.publishProcesses.has(item.seedLocalId)).toBe(true)
  })

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
  return waitFor(() => actor.getSnapshot().value === value)
}

async function waitFor(predicate: () => boolean) {
  const deadline = Date.now() + 4000
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((r) => setTimeout(r, 15))
  }
  throw new Error('timed out waiting for publish manager condition')
}
