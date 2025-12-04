import { ClientManagerContext, SeedConstructorOptions } from "@/types"
import { assign, setup } from "xstate"
import { platformClassesInit } from "./actors/platformClassesInit"
import { saveAppState } from "./actors/saveAppState"
import { fileSystemInit } from "./actors/fileSystemInit"
import { dbInit } from "./actors/dbInit"
import { ClientManagerEvents, ClientManagerState } from "@/services/internal/constants"
import { MachineIds } from "@/services/internal/constants"
import { globalServiceInit } from "./actors/globalServiceInit"

const {
  UNINITIALIZED,
  PLATFORM_CLASSES_INIT,
  FILE_SYSTEM_INIT,
  DB_INIT,
  GLOBAL_SERVICE_INIT,
  IDLE,
} = ClientManagerState

const {
  UPDATE_CONTEXT,
  GLOBAL_SERVICE_READY,
  PLATFORM_CLASSES_READY,
  FILE_SYSTEM_READY,
  DB_READY,
} = ClientManagerEvents

type InitEvent = {
  type: 'init'
  options: SeedConstructorOptions
}

export const clientManagerMachine = setup({
  types: {
    context: {} as ClientManagerContext,
    input: {} as ClientManagerContext | undefined,
  },
  actors: {
    platformClassesInit,
    fileSystemInit,
    dbInit,
    globalServiceInit,
    saveAppState,
  },
}).createMachine({
  id: MachineIds.CLIENT_MANAGER,
  initial: UNINITIALIZED,
  context: ({ input }) => input as ClientManagerContext,
  on: {
    [UPDATE_CONTEXT]: {
      actions: assign(({ event, context }) => {
        console.log('updateContext event:', event)
        return {
          ...context,
          ...event.context,
        }
      }),
    },
  },
  states: {
    [UNINITIALIZED]: {
      on: {
        init: {
          target: PLATFORM_CLASSES_INIT,
        },
      },
    },
    [PLATFORM_CLASSES_INIT]: {
      on: {
        platformClassesReady: {
          target: FILE_SYSTEM_INIT,
        },
      },
      invoke: {
        src: 'platformClassesInit',
        input: ({ event, context }) => ({ 
          event: event as InitEvent, 
          context 
        }),
      },
    },
    [FILE_SYSTEM_INIT]: {
      on: {
        [FILE_SYSTEM_READY]: {
          target: DB_INIT,
        },
      },
      invoke: {
        src: 'fileSystemInit',
        input: ({ context }) => ({ context }),
      },
    },
    [DB_INIT]: {
      on: {
        [DB_READY]: {
          target: GLOBAL_SERVICE_INIT,
        },
      },
      invoke: {
        src: 'dbInit',
        input: ({ context }) => ({ context }),
      },
    },
    globalServiceInit: {
      on: {
        [GLOBAL_SERVICE_READY]: {
          target: IDLE,
        },
      },
      invoke: {
        src: 'globalServiceInit',
        input: ({ context }) => ({ context }),
      },
    },
    [IDLE]: {
      entry: assign({
        isInitialized: true,
      }),
      on: {
        saveAppStateSuccess: {
          actions: assign(({ event }) => {
            const { key, value } = event
            return {
              isSaving: false
            }
          }),
        },
        setAddresses: {
          actions: [
            assign(({ event, spawn }) => {
              const { addresses } = event
              spawn('saveAppState', {
                input: {
                  key: 'addresses',
                  value: addresses,
                },
              })
              return {
                addresses,
                isSaving: true,
              }
            })
          ],
        },
      },
    },
  },
})
