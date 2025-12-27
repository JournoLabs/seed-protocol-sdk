import { ClientManagerContext, SeedConstructorOptions } from "@/types"
import { assign, setup } from "xstate"
import { platformClassesInit } from "./actors/platformClassesInit"
import { saveAppState } from "./actors/saveAppState"
import { fileSystemInit } from "./actors/fileSystemInit"
import { dbInit } from "./actors/dbInit"
import { ClientManagerEvents, ClientManagerState } from "@/services/internal/constants"
import { MachineIds } from "@/services/internal/constants"
import { globalServiceInit } from "./actors/globalServiceInit"
import { addModelsToStore } from "./actors/addModelsToStore"
import { saveConfig } from "./actors/saveConfig"
import { processSchemaFiles } from "./actors/processSchemaFiles"

const {
  UNINITIALIZED,
  PLATFORM_CLASSES_INIT,
  FILE_SYSTEM_INIT,
  DB_INIT,
  SAVE_CONFIG,
  PROCESS_SCHEMA_FILES,
  GLOBAL_SERVICE_INIT,
  ADD_MODELS_TO_STORE,
  IDLE,
} = ClientManagerState

const {
  UPDATE_CONTEXT,
  GLOBAL_SERVICE_READY,
  PLATFORM_CLASSES_READY,
  FILE_SYSTEM_READY,
  DB_READY,
  SAVE_CONFIG_SUCCESS,
  SAVE_APP_STATE_SUCCESS,
  SET_ADDRESSES,
  ADD_MODELS_TO_STORE_SUCCESS,
  PROCESS_SCHEMA_FILES_SUCCESS,
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
    saveConfig,
    globalServiceInit,
    saveAppState,
    addModelsToStore,
    processSchemaFiles,
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
        [PLATFORM_CLASSES_READY]: {
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
          target: SAVE_CONFIG,
        },
      },
      invoke: {
        src: 'dbInit',
        input: ({ context }) => ({ context }),
      },
    },
    [SAVE_CONFIG]: {
      on: {
        [SAVE_CONFIG_SUCCESS]: {
          target: PROCESS_SCHEMA_FILES,
        },
      },
      invoke: {
        src: 'saveConfig',
        input: ({ context }) => ({ context }),
      },
    },
    [PROCESS_SCHEMA_FILES]: {
      on: {
        [PROCESS_SCHEMA_FILES_SUCCESS]: {
          target: ADD_MODELS_TO_STORE,
        },
      },
      invoke: {
        src: 'processSchemaFiles',
        input: ({ context }) => ({ context }),
      },
    },
    [ADD_MODELS_TO_STORE]: {
      on: {
        [ADD_MODELS_TO_STORE_SUCCESS]: {
          target: GLOBAL_SERVICE_INIT,
        },
      },
      invoke: {
        src: 'addModelsToStore',
        input: ({ context }) => ({ context }),
      },
    },
    [GLOBAL_SERVICE_INIT]: {
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
        [SAVE_APP_STATE_SUCCESS]: {
          actions: assign(({ event }) => {
            const { key, value } = event
            return {
              isSaving: false
            }
          }),
        },
        [SET_ADDRESSES]: {
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
