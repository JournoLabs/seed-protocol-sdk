import { afterEach, describe, expect, it, vi } from 'vitest'
import { assign, createActor, fromCallback, setup, waitFor } from 'xstate'
import { saveAppState } from '@/client/actors/saveAppState'
import { clientManagerMachine } from '@/client/clientManagerMachine'
import { ClientManagerEvents, ClientManagerState } from '@/client/constants'
import { BaseDb } from '@/db/Db/BaseDb'
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

function sendAndForget(type: string, extra?: Record<string, unknown>) {
  return fromCallback(({ sendBack }) => {
    sendBack({ type, ...extra })
  })
}

describe('saveAppState failure', () => {
  const originalNodeEnv = process.env.NODE_ENV
  const originalSeedDev = process.env.IS_SEED_DEV

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv
    if (originalSeedDev === undefined) {
      delete process.env.IS_SEED_DEV
    } else {
      process.env.IS_SEED_DEV = originalSeedDev
    }
    vi.restoreAllMocks()
  })

  it('sends saveAppStateError when App DB is missing outside test env', async () => {
    process.env.NODE_ENV = 'production'
    delete process.env.IS_SEED_DEV
    vi.spyOn(BaseDb, 'getAppDb').mockReturnValue(undefined as never)

    const parent = setup({
      actors: { saveAppState },
    }).createMachine({
      initial: 'saving',
      context: {
        error: undefined as Error | undefined,
      },
      states: {
        saving: {
          invoke: {
            src: 'saveAppState',
            input: { key: 'addresses', value: { owned: [], watched: [] } },
          },
          on: {
            [ClientManagerEvents.SAVE_APP_STATE_ERROR]: {
              target: 'failed',
              actions: assign(({ event }) => ({
                error: (event as { error?: Error }).error,
              })),
            },
            [ClientManagerEvents.SAVE_APP_STATE_SUCCESS]: {
              target: 'ok',
            },
          },
        },
        failed: { type: 'final' },
        ok: { type: 'final' },
      },
    })

    const actor = createActor(parent)
    actor.start()
    await waitFor(actor, (snapshot) => snapshot.value === 'failed')
    expect(String(actor.getSnapshot().context.error)).toContain('App DB not found')
    actor.stop()
  })

  it('clears isSaving and records saveError so setAddresses can reject immediately', async () => {
    const machine = clientManagerMachine.provide({
      actors: {
        platformClassesInit: sendAndForget(ClientManagerEvents.PLATFORM_CLASSES_READY),
        fileSystemInit: sendAndForget(ClientManagerEvents.FILE_SYSTEM_READY),
        dbInit: sendAndForget(ClientManagerEvents.DB_READY),
        saveConfig: sendAndForget(ClientManagerEvents.SAVE_CONFIG_SUCCESS),
        processSchemaFiles: sendAndForget(ClientManagerEvents.PROCESS_SCHEMA_FILES_SUCCESS),
        addModelsToStore: sendAndForget(ClientManagerEvents.ADD_MODELS_TO_STORE_SUCCESS),
        addModelsToDb: sendAndForget(ClientManagerEvents.ADD_MODELS_TO_DB_SUCCESS),
        saveAppState: sendAndForget(ClientManagerEvents.SAVE_APP_STATE_ERROR, {
          error: new Error('App DB not found'),
        }),
      },
    })
    const actor = createActor(machine, { input: { ...baseContext } })
    actor.start()
    actor.send({ type: 'init', options: initOptions })
    await waitFor(actor, (snapshot) => snapshot.value === ClientManagerState.IDLE)

    actor.send({
      type: ClientManagerEvents.SET_ADDRESSES,
      addresses: ['0x1234567890123456789012345678901234567890'],
    })

    await waitFor(actor, (snapshot) => snapshot.context.saveError != null)
    expect(actor.getSnapshot().context.isSaving).toBe(false)
    expect(String(actor.getSnapshot().context.saveError)).toContain('App DB not found')
    actor.stop()
  })
})
