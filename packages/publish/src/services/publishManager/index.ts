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
import { setPublishManagerRef } from './publishManagerRef'
import debug from 'debug'

const logger = debug('seedProtocol:PublishManager:index')

export interface PublishManagerMachineContext {
  publishProcesses: Map<string, import('xstate').ActorRef<any, any>>
  subscriptions: Map<string, import('xstate').ActorRef<any, import('xstate').EventObject>>
}

type PublishManagerEvent =
  | { type: 'RESTORE_FROM_DB_DONE'; publishProcesses: PublishManagerMachineContext['publishProcesses']; subscriptions: PublishManagerMachineContext['subscriptions'] }
  | { type: 'CREATE_PUBLISH'; item: import('@seedprotocol/sdk').Item<any>; address: string; account?: unknown }
  | { type: 'ADD_SUBSCRIPTION'; seedLocalId: string; newSubscription?: import('xstate').ActorRef<any, any> }
  | { type: 'REQUEST_SAVE_PUBLISH'; seedLocalId: string; publishProcess?: unknown }
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
  },
  states: {
    restoreFromDb: {
      on: {
        RESTORE_FROM_DB_DONE: {
          target: 'active',
          actions: ['assignRestoreFromDb'],
        },
      },
      invoke: {
        src: 'restoreFromDb',
        input: ({ context }) => ({ context }),
      },
    },
    active: {
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

const publishManager = createActor(publishManagerMachine, {
  input: {
    publishProcesses: new Map(),
    subscriptions: new Map(),
  },
})

// Set ref for subscribe actor to call savePublish, onPublishDone, removeSubscription
setPublishManagerRef({
  savePublish: (seedLocalId, publishProcess) => {
    publishManager.send({ type: 'REQUEST_SAVE_PUBLISH', seedLocalId, publishProcess })
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
  publishManager.start()

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
  createPublish: (
    item: InstanceType<typeof Item>,
    address: string,
    account?: import('thirdweb/wallets').Account
  ) => publishManager.send({ type: 'CREATE_PUBLISH', item, address, account }),
  retryAttestations: (seedLocalId: string, account?: import('thirdweb/wallets').Account) =>
    publishManager.send({ type: 'RETRY_ATTESTATIONS', seedLocalId, account }),
  stopPublish: (seedLocalId: string) => publishManager.send({ type: 'STOP_PUBLISH', seedLocalId }),
  query: (seedLocalId: string) => publishManager.send({ type: 'QUERY', seedLocalId }),
  stopAll: () => publishManager.send({ type: 'STOP_ALL' }),
  getPublish: (seedLocalId: string) => publishManager.getSnapshot().context.publishProcesses.get(seedLocalId),
  savePublish: (seedLocalId: string, publishProcess: ActorRefFrom<typeof publishMachine>) =>
    publishManager.send({ type: 'REQUEST_SAVE_PUBLISH', seedLocalId, publishProcess }),
  addSubscription: (seedLocalId: string, subscriptionActor: import('xstate').ActorRef<any, any>) =>
    publishManager.send({ type: 'ADD_SUBSCRIPTION', seedLocalId, newSubscription: subscriptionActor }),
  removeSubscription: (seedLocalId: string) => publishManager.send({ type: 'REMOVE_SUBSCRIPTION', seedLocalId }),
}
