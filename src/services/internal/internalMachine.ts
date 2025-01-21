import { assign, setup } from 'xstate'
import { createBrowserInspector } from '@statelyai/inspect'
import {
  DB_NAME_APP,
  INTERNAL_CONFIGURING_FS_SUCCESS,
  INTERNAL_LOADING_APP_DB_SUCCESS,
  INTERNAL_SAVING_CONFIG_SUCCESS,
  INTERNAL_VALIDATING_INPUT_SUCCESS,
  InternalState,
  MachineIds,
} from './constants'
import { dbMachine } from '@/services/db/dbMachine'
import debug from 'debug'
import { validateInput } from '@/services/internal/actors/validateInput'
import { prepareDb } from '@/services/internal/actors/prepareDb'
import { configureFs } from '@/services/internal/actors/configureFs'
import { saveConfig } from '@/services/internal/actors/saveConfig'
import { loadAppDb } from '@/services/internal/actors/loadAppDb'
import { InternalMachineContext } from '@/types'
import { waitForFiles } from './actors/waitForFiles'

const logger = debug('app:services:internal:machine')

const { inspect } = createBrowserInspector({
  autoStart: false,
})

const {
  IDLE,
  VALIDATING_INPUT,
  SAVING_CONFIG,
  CONFIGURING_FS,
  LOADING_APP_DB,
} = InternalState

// Create the state machine
export const internalMachine = setup({
  types: {
    context: {} as Partial<InternalMachineContext>,
    input: {} as Partial<InternalMachineContext> | undefined,
  },
  actors: {
    prepareDb,
    validateInput,
    waitForFiles,
    configureFs,
    loadAppDb,
    saveConfig,
  },
}).createMachine({
  id: MachineIds.INTERNAL,
  initial: IDLE,
  context: ({ input }) => {
    return {
      ...input,
      error: undefined,
      hasFiles: false,
    }
  },
  states: {
    [IDLE]: {
      on: {
        reValidate: VALIDATING_INPUT,
        init: {
          target: VALIDATING_INPUT,
          actions: [
            assign({
              appDbService: ({ spawn }) =>
                spawn(dbMachine, {
                  input: {
                    dbName: DB_NAME_APP,
                  },
                }),
            }),
          ],
        },
      },
      meta: {
        displayText: 'Waiting for something to happen ...',
        percentComplete: 0,
      },
    },
    [VALIDATING_INPUT]: {
      on: {
        [INTERNAL_VALIDATING_INPUT_SUCCESS]: {
          target: 'preparingDb',
          actions: assign({
            endpoints: ({ event }) => event.endpoints,
            addresses: ({ event }) => event.addresses,
            filesDir: ({ event }) => event.filesDir,
            arweaveDomain: ({ event }) => event.arweaveDomain,
          }),
        },
      },
      invoke: {
        src: 'validateInput',
        input: ({ context, event }) => ({ context, event }),
      },
      meta: {
        displayText: 'Validating input',
        percentComplete: 20,
      },
      tags: ['loading'],
    },
    preparingDb: {
      on: {
        prepareDbSuccess: {
          target: CONFIGURING_FS,
        },
      },
      invoke: {
        src: 'prepareDb',
        input: ({ context, event }) => ({ context, event }),
      },
    },
    waitingForFiles: {
      on: {
        filesReceived: {
          target: LOADING_APP_DB,
        },
      },
      invoke: {
        src: 'waitForFiles',
        input: ({ context, event }) => ({ context, event }),
      },
    },
    [CONFIGURING_FS]: {
      on: {
        [INTERNAL_CONFIGURING_FS_SUCCESS]: {
          target: LOADING_APP_DB,
          actions: assign({ hasFiles: true }),
        },
        shouldWaitForFiles: {
          target: 'waitingForFiles',
        },
      },
      invoke: {
        src: 'configureFs',
        input: ({ context, event }) => ({ context, event }),
      },
      meta: {
        displayText: 'Downloading app files',
        percentComplete: 30,
      },
      tags: ['loading'],
    },
    [LOADING_APP_DB]: {
      on: {
        [INTERNAL_LOADING_APP_DB_SUCCESS]: {
          target: SAVING_CONFIG,
          actions: () => {
            logger('[sdk] [internal/index] App DB loaded!')
          },
        },
      },
      invoke: {
        src: 'loadAppDb',
        input: ({ context, event }) => ({ context, event }),
      },
    },
    // Save developer's config to DB
    [SAVING_CONFIG]: {
      on: {
        [INTERNAL_SAVING_CONFIG_SUCCESS]: 'ready',
      },
      invoke: {
        src: 'saveConfig',
        input: ({ context, event }) => ({ context, event }),
      },
      meta: {
        displayText: 'Saving configuration',
        percentComplete: 80,
      },
      tags: ['loading'],
    },
    ready: {
      entry: () => {
        logger('[sdk] [internal/index] Ready!')
      },
      meta: {
        displayText: "Crossing the t's ...",
        percentComplete: 90,
      },
    },
    error: {
      on: {
        retry: {
          target: CONFIGURING_FS,
          actions: assign({ error: undefined }),
        },
      },
      entry: () => {
        logger('[sdk] [internal/index] Error!')
      },
      meta: {
        displayText: 'Whoops! Something went wrong.',
        percentComplete: null,
      },
      tags: ['error'],
    },
  },
})

// const internalService = createActor(internalMachine, {
//   input: {},
//   inspect: (inspEvent) => {
//     if (inspEvent.type === '@xstate.snapshot') {
//       if (
//         inspEvent.event &&
//         inspEvent.event.snapshot &&
//         inspEvent.event.snapshot.value
//       ) {
//         logger(
//           `[internalService] ${inspEvent.event.snapshot.value}`,
//           inspEvent,
//         )
//         return
//       }
//
//       if (inspEvent.snapshot && inspEvent.snapshot.value) {
//         logger(`[internalService] ${inspEvent.snapshot.value}`, inspEvent)
//         return
//       }
//
//       // logger(`[internalService] Uncaught event`, inspEvent)
//     }
//   },
// })

// internalService.subscribe((snapshot) => {
//   globalService.send({ type: INTERNAL_SERVICE_SNAPSHOT, snapshot })
// })
//
// internalService.on(CHILD_SNAPSHOT, (emitted) => {
//   globalService.send({ ...emitted })
// })

// internalService.start()
