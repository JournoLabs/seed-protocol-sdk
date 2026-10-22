import { describe, expect, it } from 'vitest'
import { createActor, fromCallback, fromPromise, waitFor } from 'xstate'
import { clientManagerMachine } from '@/client/clientManagerMachine'
import { ClientManagerEvents, ClientManagerState } from '@/client/constants'
import type { ClientManagerContext } from '@/types/machines'

const baseContext: ClientManagerContext = {
  isInitialized: false,
  addressesSet: false,
  isSaving: false,
  syncFromEasOnAddressChange: false,
}

const initOptions = {
  config: {
    endpoints: {
      filePaths: '/api/seed/migrations',
      files: '.seed',
    },
  },
  addresses: [],
}

function sendAndForget(
  type: string,
  extra?: Record<string, unknown>,
) {
  return fromCallback(({ sendBack }) => {
    sendBack({ type, ...extra })
  })
}

const succeed = () => fromPromise(async () => ({}))
const fail = (message: string) =>
  fromPromise(async () => {
    throw new Error(message)
  })

function succeedingActors() {
  return {
    platformClassesInit: succeed(),
    fileSystemInit: succeed(),
    dbInit: succeed(),
    saveConfig: succeed(),
    processSchemaFiles: succeed(),
    addModelsToDb: succeed(),
    saveAppState: sendAndForget(ClientManagerEvents.SAVE_APP_STATE_SUCCESS, {
      key: 'addresses',
      value: { owned: [], watched: [] },
    }),
  }
}

function actorWith(overrides: Record<string, ReturnType<typeof fromCallback> | ReturnType<typeof fromPromise>>) {
  return createActor(
    clientManagerMachine.provide({
      actors: {
        ...succeedingActors(),
        ...overrides,
      },
    }),
    { input: { ...baseContext } },
  )
}

describe('clientManagerMachine init failure', () => {
  it('moves FILE_SYSTEM_INIT errors to initFailed, not idle', async () => {
    const actor = actorWith({
      fileSystemInit: fail('fs failed'),
    })
    actor.start()
    actor.send({ type: 'init', options: initOptions })

    await waitFor(actor, (snapshot) => snapshot.value === ClientManagerState.INIT_FAILED)
    expect(actor.getSnapshot().context.isInitialized).toBe(false)
    expect(String(actor.getSnapshot().context.initError)).toContain('fs failed')
    actor.stop()
  })

  it('moves PROCESS_SCHEMA_FILES errors to initFailed, not idle', async () => {
    const actor = actorWith({
      processSchemaFiles: fail('schema failed'),
    })
    actor.start()
    actor.send({ type: 'init', options: initOptions })

    await waitFor(actor, (snapshot) => snapshot.value === ClientManagerState.INIT_FAILED)
    expect(actor.getSnapshot().context.isInitialized).toBe(false)
    expect(String(actor.getSnapshot().context.initError)).toContain('schema failed')
    actor.stop()
  })

  it('moves DB_INIT errors to initFailed', async () => {
    const actor = actorWith({
      dbInit: fail('db failed'),
    })
    actor.start()
    actor.send({ type: 'init', options: initOptions })

    await waitFor(actor, (snapshot) => snapshot.value === ClientManagerState.INIT_FAILED)
    expect(actor.getSnapshot().context.isInitialized).toBe(false)
    expect(String(actor.getSnapshot().context.initError)).toContain('db failed')
    actor.stop()
  })

  it('reaches idle with isInitialized only after a full successful init', async () => {
    const actor = actorWith({})
    actor.start()
    actor.send({ type: 'init', options: initOptions })

    await waitFor(actor, (snapshot) => snapshot.value === ClientManagerState.IDLE)
    expect(actor.getSnapshot().context.isInitialized).toBe(true)
    expect(actor.getSnapshot().context.initError).toBeUndefined()
    actor.stop()
  })

  it('retries from initFailed when init is sent again', async () => {
    let fsAttempts = 0
    const actor = actorWith({
      fileSystemInit: fromPromise(async () => {
        fsAttempts += 1
        if (fsAttempts === 1) throw new Error('first fs fail')
      }),
    })
    actor.start()
    actor.send({ type: 'init', options: initOptions })
    await waitFor(actor, (snapshot) => snapshot.value === ClientManagerState.INIT_FAILED)

    actor.send({ type: 'init', options: initOptions })
    await waitFor(actor, (snapshot) => snapshot.value === ClientManagerState.IDLE)
    expect(actor.getSnapshot().context.isInitialized).toBe(true)
    expect(fsAttempts).toBe(2)
    actor.stop()
  })
})
