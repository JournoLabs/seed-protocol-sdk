import { ActorRefFrom, createActor, setup, } from 'xstate'
import { createPublish } from './actions/createPublish'
import { stopPublish } from './actions/stopPublish'
import { query } from './actions/query'
import { restoreFromDb } from './actors/restoreFromDb'
import { Item } from '@seedprotocol/sdk'
import { publishMachine } from '../publish'
import { PublishManagerMachineContext } from '~/types/machines'
import { addSubscription } from './actions/addSubscription'
import { requestSavePublish } from './actions/requestSavePublish'
import { publishDone } from './actions/publishDone'
import { removeSubscription } from './actions/removeSubscription'
import debug from 'debug'

const logger = debug('seedProtocol:PublishManager:index')


export const publishManagerMachine = setup({
  types: {
    context: {} as PublishManagerMachineContext,
    input: {} as PublishManagerMachineContext,
  },
  actors: {
    restoreFromDb,
  },
  actions: {
    createPublish,
    addSubscription,
    requestSavePublish,
    publishDone,
    removeSubscription,
    stopPublish,
    query,
    stopAll: ({context}) => {
      logger('Stopping all actors...');
      context.publishProcesses.forEach((publishProcess) => publishProcess.stop?.());
      return { publishProcesses: new Map(), subscriptions: new Map() };
    },
  },
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
        },
      },
      invoke: {
        src: 'restoreFromDb',
        input: ({context, event}) => ({context, event}),
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
    onDone: {
      actions: ['stopAll'],
    },
  },
})

const publishManager = createActor(publishManagerMachine, {
  input: {
    publishProcesses: new Map(),
    subscriptions: new Map(),
  },
})

const subscription = publishManager.subscribe((snapshot) => {
  logger('PublishManager snapshot:', snapshot);
})


if (typeof document !== 'undefined') {

  publishManager.start()

  window.addEventListener('load', () => {
    logger('PublishManager started');
  });

  // Ensure cleanup when the page unloads
  window.addEventListener('beforeunload', () => {
    subscription.unsubscribe()
    publishManager.stop();
  });

}

export const PublishManager = {
  getService: () => publishManager,
  createPublish: (item: InstanceType<typeof Item>, address: string, account?: import('thirdweb/wallets').Account) => publishManager.send({ type: 'CREATE_PUBLISH', item, address, account }),
  stopPublish: (seedLocalId: string) => publishManager.send({ type: 'STOP_PUBLISH', seedLocalId }),
  query: (seedLocalId: string) => publishManager.send({ type: 'QUERY', seedLocalId }),
  stopAll: () => publishManager.send({ type: 'STOP_ALL' }),
  getPublish: (seedLocalId: string) => publishManager.getSnapshot().context.publishProcesses.get(seedLocalId),
  savePublish: (seedLocalId: string, publishProcess: ActorRefFrom<typeof publishMachine>) => publishManager.send({ type: 'REQUEST_SAVE_PUBLISH', seedLocalId, publishProcess }),
  addSubscription: (seedLocalId: string, publishProcess: ActorRefFrom<typeof publishMachine>) => publishManager.send({ type: 'ADD_SUBSCRIPTION', seedLocalId, publishProcess }),
  removeSubscription: (seedLocalId: string) => publishManager.send({ type: 'REMOVE_SUBSCRIPTION', seedLocalId }),
}