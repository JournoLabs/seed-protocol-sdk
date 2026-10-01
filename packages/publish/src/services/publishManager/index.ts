import { ActorRefFrom, createActor, setup } from 'xstate'
import { Item } from '@seedprotocol/sdk'
import { publishMachine } from '../publish'
import { assignRestoreFromDb } from './actions/assignRestoreFromDb'
import { createPublish } from './actions/createPublish'
import { retryAttestations } from './actions/retryAttestations'
import { stopPublish } from './actions/stopPublish'
import { stopAll } from './actions/stopAll'
import { query } from './actions/query'
import { addSubscription } from './actions/addSubscription'
import { requestSavePublish } from './actions/requestSavePublish'
import { publishDone } from './actions/publishDone'
import { removeSubscription } from './actions/removeSubscription'
import { restoreFromDb } from './actors/restoreFromDb'
import { queueCreatePublish } from './actions/queueCreatePublish'
import { drainPendingCreates } from './actions/drainPendingCreates'
import { registerCreatePublishResolver } from './createPublishResult'
import { setPublishManagerRef } from './publishManagerRef'
import debug from 'debug'

const logger = debug('seedProtocol:PublishManager:index')

export interface PublishManagerMachineContext {
  publishProcesses: Map<string, import('xstate').ActorRef<any, any>>
  subscriptions: Map<string, import('xstate').ActorRef<any, import('xstate').EventObject>>
  /** CREATE_PUBLISH events received before restore finishes. */
  pendingCreates: PublishManagerEvent[]
  /** Last finished actor per seed. Not used by the in-flight duplicate guard. */
  settledPublishes: Map<string, import('xstate').ActorRef<any, any>>
}

type PublishManagerEvent =
  | { type: 'RESTORE_FROM_DB_DONE'; publishProcesses: PublishManagerMachineContext['publishProcesses']; subscriptions: PublishManagerMachineContext['subscriptions'] }
  | { type: 'CREATE_PUBLISH'; item: import('@seedprotocol/sdk').Item<any>; address: string; account?: unknown; options?: import('../../config').CreatePublishOptions; createToken?: number }
  | { type: 'ADD_SUBSCRIPTION'; seedLocalId: string; newSubscription?: import('xstate').ActorRef<any, any> }
  | { type: 'REQUEST_SAVE_PUBLISH'; seedLocalId: string; publishProcess?: unknown; triggerPublishDone?: boolean }
  | { type: 'SAVE_PUBLISH_DONE'; seedLocalId: string; triggerPublishDone?: boolean }
  | { type: 'PUBLISH_DONE'; seedLocalId: string }
  | { type: 'REMOVE_SUBSCRIPTION'; seedLocalId: string }
  | { type: 'RETRY_ATTESTATIONS'; seedLocalId: string; account?: unknown }
  | { type: 'STOP_PUBLISH'; seedLocalId: string }
  | { type: 'QUERY'; seedLocalId: string }
  | { type: 'STOP_ALL' }

export const publishManagerMachine = setup({
  types: {
    context: {} as PublishManagerMachineContext,
    input: {} as PublishManagerMachineContext,
    events: {} as PublishManagerEvent,
  },
  actors: {
    restoreFromDb,
  },
  actions: {
    assignRestoreFromDb,
    createPublish,
    queueCreatePublish,
    drainPendingCreates,
    addSubscription,
    requestSavePublish,
    publishDone,
    removeSubscription,
    retryAttestations,
    stopPublish,
    stopAll,
    query,
  } as unknown as Record<string, (args: unknown) => void>,
}).createMachine({
  id: 'publishManager',
  initial: 'restoreFromDb',
  context: {
    publishProcesses: new Map(),
    subscriptions: new Map(),
    pendingCreates: [],
    settledPublishes: new Map(),
  },
  states: {
    restoreFromDb: {
      on: {
        RESTORE_FROM_DB_DONE: {
          target: 'active',
          actions: ['assignRestoreFromDb'],
        },
        CREATE_PUBLISH: {
          actions: ['queueCreatePublish'],
        },
      },
      invoke: {
        src: 'restoreFromDb',
        input: ({ context }) => ({ context }),
      },
    },
    active: {
      entry: 'drainPendingCreates',
      on: {
        CREATE_PUBLISH: {
          actions: ['createPublish'],
        },
        ADD_SUBSCRIPTION: {
          actions: ['addSubscription'],
        },
        REQUEST_SAVE_PUBLISH: {
          actions: ['requestSavePublish'],
        },
        SAVE_PUBLISH_DONE: [
          {
            guard: ({ event }) => (event as { triggerPublishDone?: boolean }).triggerPublishDone === true,
            actions: ['publishDone'],
          },
        ],
        PUBLISH_DONE: {
          actions: ['publishDone'],
        },
        REMOVE_SUBSCRIPTION: {
          actions: ['removeSubscription'],
        },
        RETRY_ATTESTATIONS: {
          actions: ['retryAttestations'],
        },
        STOP_PUBLISH: {
          actions: ['stopPublish'],
        },
        QUERY: {
          actions: ['query'],
        },
        STOP_ALL: {
          actions: ['stopAll'],
        },
      },
    },
  },
})

const initialManagerContext = {
  publishProcesses: new Map(),
  subscriptions: new Map(),
  pendingCreates: [] as PublishManagerEvent[],
  settledPublishes: new Map(),
}

const publishManager = createActor(publishManagerMachine, {
  input: initialManagerContext,
})

/**
 * `snapshot.status === 'active'` is true before `start()` and while restore is running.
 * This flag is the only signal that `start()` has been called. Calling it twice throws.
 */
let publishManagerStarted = false

function ensurePublishManagerStarted() {
  if (publishManagerStarted) return
  try {
    publishManager.start()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (!/already started/i.test(message)) throw err
  }
  publishManagerStarted = true
}

// Set ref for subscribe actor to call savePublish, onPublishDone, removeSubscription
setPublishManagerRef({
  savePublish: (seedLocalId, publishProcess, options) => {
    publishManager.send({
      type: 'REQUEST_SAVE_PUBLISH',
      seedLocalId,
      publishProcess,
      triggerPublishDone: options?.triggerPublishDone,
    })
  },
  onPublishDone: (seedLocalId) => {
    publishManager.send({ type: 'PUBLISH_DONE', seedLocalId })
  },
  removeSubscription: (seedLocalId) => {
    publishManager.send({ type: 'REMOVE_SUBSCRIPTION', seedLocalId })
  },
})

const subscription = publishManager.subscribe((snapshot) => {
  logger('PublishManager snapshot:', snapshot)
})

if (typeof document !== 'undefined') {
  ensurePublishManagerStarted()

  window.addEventListener('load', () => {
    logger('PublishManager started')
  })

  window.addEventListener('beforeunload', () => {
    subscription.unsubscribe()
    publishManager.stop()
  })
}

export const PublishManager = {
  getService: () => publishManager,
  /**
   * Start the manager if this process has not, then resolve when the machine value is `active`.
   * Node does not auto-start. `getSnapshot().status` is not readiness.
   */
  ready: (): Promise<void> => {
    ensurePublishManagerStarted()
    if (publishManager.getSnapshot().value === 'active') return Promise.resolve()
    return new Promise((resolve) => {
      const sub = publishManager.subscribe((snapshot) => {
        if (snapshot.value === 'active') {
          sub.unsubscribe()
          resolve()
        }
      })
      if (publishManager.getSnapshot().value === 'active') {
        sub.unsubscribe()
        resolve()
      }
    })
  },
  /**
   * Spawn a publish. Resolves with the child actor once it exists.
   * Resolves `undefined` when the address is missing or that seed is already in flight.
   * This promise means the process started, not that the chain publish finished.
   */
  createPublish: (
    item: InstanceType<typeof Item>,
    address: string,
    account?: import('../../helpers/seedSigner').PublishWallet,
    options?: import('../../config').CreatePublishOptions
  ) =>
    new Promise<import('xstate').ActorRef<any, any> | undefined>((resolve) => {
      const createToken = registerCreatePublishResolver(resolve)
      publishManager.send({ type: 'CREATE_PUBLISH', item, address, account, options, createToken })
    }),
  retryAttestations: (seedLocalId: string, account?: import('../../helpers/seedSigner').PublishWallet) =>
    publishManager.send({ type: 'RETRY_ATTESTATIONS', seedLocalId, account }),
  stopPublish: (seedLocalId: string) => publishManager.send({ type: 'STOP_PUBLISH', seedLocalId }),
  query: (seedLocalId: string) => publishManager.send({ type: 'QUERY', seedLocalId }),
  stopAll: () => publishManager.send({ type: 'STOP_ALL' }),
  getPublish: (seedLocalId: string) => {
    const ctx = publishManager.getSnapshot().context
    return ctx.publishProcesses.get(seedLocalId) ?? ctx.settledPublishes.get(seedLocalId)
  },
  savePublish: (seedLocalId: string, publishProcess: ActorRefFrom<typeof publishMachine>) =>
    publishManager.send({ type: 'REQUEST_SAVE_PUBLISH', seedLocalId, publishProcess }),
  addSubscription: (seedLocalId: string, subscriptionActor: import('xstate').ActorRef<any, any>) =>
    publishManager.send({ type: 'ADD_SUBSCRIPTION', seedLocalId, newSubscription: subscriptionActor }),
  removeSubscription: (seedLocalId: string) => publishManager.send({ type: 'REMOVE_SUBSCRIPTION', seedLocalId }),
}
