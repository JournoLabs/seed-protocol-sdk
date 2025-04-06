import { ActorRefFrom, assign, createActor, raise, setup } from 'xstate'
import { createBrowserInspector } from '@statelyai/inspect'
import {
  GLOBAL_ADDING_MODELS_TO_DB_SUCCESS,
  GLOBAL_INITIALIZING_CREATE_ALL_ITEMS_SERVICES,
  GLOBAL_INITIALIZING_INTERNAL_SERVICE_READY,
  GLOBAL_INITIALIZING_SEND_CONFIG,
  GlobalState,
  MachineIds,
} from '@/services/internal/constants'
import { GlobalMachineContext, ModelClassType } from '@/types'
import { eventEmitter } from '@/eventBus'
import { initialize } from '@/services/global/actors/initialize'
import { getSchemaForModel } from '@/services/global/actors/getSchemaForModel'
import { addModelsToDb } from '@/services/global/actors/addModelsToDb'
import { itemMachineAll } from '../allItems/itemMachineAll'
import { publishMachine } from '@/services/publish/publishMachine'
import { savePublishService } from '@/services/global/actors/savePublishService'
import { internalMachine } from '../internal/internalMachine'

const {
  UNINITIALIZED,
  INITIALIZING,
  INITIALIZED,
  PUBLISHING_ITEM,
  ADDING_MODELS_TO_DB,
} = GlobalState

const { inspect } = createBrowserInspector({
  autoStart: false,
})

const globalMachine = setup({
  types: {
    context: {} as GlobalMachineContext,
    input: {} as GlobalMachineContext | undefined,
  },
  actors: {
    initialize,
    addModelsToDb,
    getSchemaForModel,
    savePublishService,
  },
}).createMachine({
  id: MachineIds.GLOBAL,
  initial: UNINITIALIZED,
  context: ({ input }) => input as GlobalMachineContext,
  on: {
    publishItemRequest: `.${PUBLISHING_ITEM}`,
    savePublishService: `.savingPublishService`,
    restorePublishService: `.${PUBLISHING_ITEM}`,
  },
  states: {
    [UNINITIALIZED]: {
      on: {
        init: {
          target: INITIALIZING,
          actions: [
            assign({
              isInitialized: false,
              addedModelRecordsToDb: false,
              models: ({ event }) => event.models,
              endpoints: ({ event }) => event.endpoints,
              filesDir: ({ event }) => event.filesDir,
              internalService: ({ spawn, event }) => {
                return spawn(internalMachine, {
                  systemId: MachineIds.INTERNAL,
                  input: {
                    endpoints: event.endpoints,
                    filesDir: event.filesDir,
                    addresses: event.addresses,
                    arweaveDomain: event.arweaveDomain,
                  },
                })
              },
            }),
          ],
        },
      },
      meta: {
        displayText: 'Booting up',
        percentComplete: 5,
      },
      tags: ['loading', 'startup'],
    },
    [INITIALIZING]: {
      on: {
        [GLOBAL_INITIALIZING_SEND_CONFIG]: {
          actions: assign({
            endpoints: ({ event }) => event.endpoints,
            environment: ({ event }) => event.environment,
            addresses: ({ event }) => event.addresses,
            isInitialized: true,
          }),
        },
        [GLOBAL_INITIALIZING_INTERNAL_SERVICE_READY]: ADDING_MODELS_TO_DB,
        [GLOBAL_INITIALIZING_CREATE_ALL_ITEMS_SERVICES]: {
          actions: [
            assign(({ event, spawn }) => {
              const allItemsServices: Record<
                string,
                ActorRefFrom<typeof itemMachineAll>
              > = {}
              for (const [modelName, ModelClass] of Object.entries(
                event.create,
              )) {
                const service = spawn(itemMachineAll, {
                  systemId: modelName,
                  input: {
                    modelName,
                    ModelClass,
                    modelSchema: (ModelClass as ModelClassType)!.schema,
                    items: [],
                  },
                })
                allItemsServices[`${modelName}Service`] = service
              }

              for (const [modelName, snapshot] of Object.entries(
                event.restore,
              )) {
                const service = createActor(itemMachineAll, {
                  snapshot,
                })
                service.start()
                allItemsServices[`${modelName}Service`] = service
              }
              return allItemsServices
            }),
            raise({ type: 'allItemsServicesCreated' }),
          ],
        },
      },
      invoke: {
        src: 'initialize',
        input: ({ event, context }) => ({ event, context }),
        meta: {
          displayText: 'Initializing Seed SDK',
          percentComplete: 10,
        },
        tags: ['loading', 'startup'],
      },
    },
    [ADDING_MODELS_TO_DB]: {
      on: {
        [GLOBAL_ADDING_MODELS_TO_DB_SUCCESS]: {
          target: INITIALIZED,
          actions: assign({
            addedModelRecordsToDb: true,
          }),
        },
      },
      invoke: {
        src: 'addModelsToDb',
        input: ({ context }) => ({ context }),
        meta: {
          displayText: 'Adding models to database',
        },
        tags: ['loading', 'startup'],
      },
    },
    [INITIALIZED]: {
      // type: 'parallel',
      // on: {
      //   publishItemRequest: `.${PUBLISHING_ITEM}`,
      // },
      meta: {
        displayText: 'Global service ready',
        percentComplete: 40,
      },
      tags: ['loading', 'startup'],
      // initial: PUBLISHING_ITEM,
    },
    [PUBLISHING_ITEM]: {
      target: INITIALIZED,
      entry: [
        assign({
          publishItemService: ({ spawn, event }) =>
            spawn(publishMachine, {
              id: 'publishService',
              input: {
                localId: event.seedLocalId,
              },
            }),
        }),
      ],
      meta: {
        displayText: 'Publishing item',
      },
      tags: ['publishing'],
    },
    savingPublishService: {
      target: INITIALIZED,
      on: {
        savePublishServiceSuccess: INITIALIZED,
      },
      invoke: {
        src: 'savePublishService',
        input: ({ context }) => ({ context }),
      },
      meta: {
        displayText: 'Saving publish service',
      },
      tags: ['publishing'],
    },
  },
})

const globalService = createActor(globalMachine, {
  input: {},
  // inspect,
  inspect: (inspEvent) => {
    eventEmitter.emit('inspect.globalService', inspEvent)
    // console.log('[sdk] [service/index] inspEvent', inspEvent)
    // eventEmitter.emit('globalService', inspEvent)
    // let eventType: string = inspEvent.type
    // if (inspEvent.event && inspEvent.event.type) {
    //   eventType = inspEvent.event.type
    // }
    //
    // if (typeof eventType === 'object') {
    //   eventType = JSON.stringify(eventType)
    // }
    //
    // let srcId = inspEvent.actorRef.id
    //
    // if (!srcId.includes('seedSdk')) {
    //   srcId = inspEvent.actorRef.logic.config.id
    // }
    //
    // if (inspEvent.type === '@xstate.snapshot') {
    //   if (
    //     inspEvent.event.type === CHILD_SNAPSHOT &&
    //     inspEvent.snapshot &&
    //     inspEvent.snapshot.machine.id === MachineIds.GLOBAL
    //   ) {
    //     return
    //   }
    //   if (inspEvent.snapshot && inspEvent.snapshot.value) {
    //     if (typeof window !== 'undefined') {
    //       eventEmitter.emit('globalService', {
    //         type: eventType,
    //         src: srcId,
    //         snapshot: inspEvent.snapshot,
    //       })
    //     }
    //   }
    // } else {
    //   if (typeof window !== 'undefined') {
    //     let snapshot
    //
    //     try {
    //       snapshot = inspEvent.actorRef.getSnapshot()
    //     } catch (e) {
    //       // This fails if the actor hasn't initialized yet, but that's OK I think
    //       // console.log('[sdk] [service/index] ERROR', e)
    //     }
    //
    //     eventEmitter.emit('globalService', {
    //       type: eventType,
    //       src: srcId,
    //       snapshot,
    //     })
    //   }
    // }
  },
})

globalService.start()

const getGlobalService = (): ActorRefFrom<typeof globalMachine> => globalService

export { globalMachine, getGlobalService, globalService }
