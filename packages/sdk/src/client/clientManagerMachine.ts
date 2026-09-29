import { ClientManagerContext, SeedConstructorOptions } from "@/types"
import { assign, setup } from "xstate"
import debug from "debug"
import { normalizeAddressConfig } from "@/helpers/addresses"
import { requestEasSyncFromAddressChange } from "@/events/item/easSyncManager"
import { platformClassesInit } from "./actors/platformClassesInit"
import { saveAppState } from "./actors/saveAppState"
import { fileSystemInit } from "./actors/fileSystemInit"
import { dbInit } from "./actors/dbInit"
import { ClientManagerEvents, ClientManagerState, MachineIds } from "@/client/constants"
import { addModelsToStore } from "./actors/addModelsToStore"
import { addModelsToDb } from "./actors/addModelsToDb"
import { saveConfig } from "./actors/saveConfig"
import { processSchemaFiles } from "./actors/processSchemaFiles"
import { eventEmitter } from "@/eventBus"
import {
  ADDRESSES_PERSISTED_EVENT,
  parseAddressesPersistedPayload,
} from "@/client/events"

const {
  UNINITIALIZED,
  PLATFORM_CLASSES_INIT,
  FILE_SYSTEM_INIT,
  DB_INIT,
  SAVE_CONFIG,
  PROCESS_SCHEMA_FILES,
  ADD_MODELS_TO_STORE,
  ADD_MODELS_TO_DB,
  IDLE,
  INIT_FAILED,
} = ClientManagerState

const {
  UPDATE_CONTEXT,
  PLATFORM_CLASSES_READY,
  FILE_SYSTEM_READY,
  DB_READY,
  SAVE_CONFIG_SUCCESS,
  SAVE_APP_STATE_SUCCESS,
  SAVE_APP_STATE_ERROR,
  SET_ADDRESSES,
  ADD_MODELS_TO_STORE_SUCCESS,
  ADD_MODELS_TO_DB_SUCCESS,
  PROCESS_SCHEMA_FILES_SUCCESS,
} = ClientManagerEvents

type InitEvent = {
  type: 'init'
  options: SeedConstructorOptions
}

const logSyncAfterAddressSave = debug(
  "seedSdk:client:clientManagerMachine:syncAfterAddressSave",
)

function addressesFromPersistedAddressValue(value: unknown): string[] {
  if (!value || typeof value !== "object") return []
  const v = value as { owned?: unknown; watched?: unknown }
  const owned = Array.isArray(v.owned)
    ? v.owned.filter((a): a is string => typeof a === "string")
    : []
  const watched = Array.isArray(v.watched)
    ? v.watched.filter((a): a is string => typeof a === "string")
    : []
  const seen = new Set<string>()
  const out: string[] = []
  for (const a of [...owned, ...watched]) {
    const k = a.toLowerCase()
    if (!seen.has(k)) {
      seen.add(k)
      out.push(a)
    }
  }
  return out
}

function maybeRunSyncFromEasAfterAddressSave({
  context,
  event,
}: {
  context: ClientManagerContext
  event: { key?: string; value?: unknown }
}) {
  const merged = addressesFromPersistedAddressValue(event.value)
  if (!context.syncFromEasOnAddressChange) return
  if (event.key !== "addresses") return
  if (merged.length === 0) return
  try {
    requestEasSyncFromAddressChange(merged)
  } catch (err: unknown) {
    logSyncAfterAddressSave("requestEasSyncFromAddressChange after address save failed", err)
  }
}

function emitAddressesPersistedIfAddressesKey(event: {
  key?: string
  value?: unknown
}) {
  if (event.key !== "addresses") return
  const payload = parseAddressesPersistedPayload(event.value)
  eventEmitter.emit(ADDRESSES_PERSISTED_EVENT, payload)
}

function errorFromEvent(event: unknown, fallbackMessage: string): Error {
  const error = (event as { error?: unknown })?.error
  if (error instanceof Error) {
    return error
  }
  return new Error(String(error ?? fallbackMessage))
}

const failInit = (fallbackMessage: string) => ({
  target: INIT_FAILED,
  actions: {
    type: "assignInitError" as const,
    params: { fallbackMessage },
  },
})

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
    saveAppState,
    addModelsToStore,
    addModelsToDb,
    processSchemaFiles,
  },
  actions: {
    assignInitError: assign(({ event }, params: { fallbackMessage: string }) => ({
      initError: errorFromEvent(event, params.fallbackMessage),
      isInitialized: false,
    })),
  },
}).createMachine({
  id: MachineIds.CLIENT_MANAGER,
  initial: UNINITIALIZED,
  context: ({ input }) => input as ClientManagerContext,
  on: {
    [UPDATE_CONTEXT]: {
      actions: assign(({ event, context }) => {
        return {
          ...context,
          ...event.context,
        }
      }),
    },
    init: {
      target: `.${PLATFORM_CLASSES_INIT}`,
      actions: assign({
        isInitialized: false,
        initError: undefined,
        saveError: undefined,
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
        error: failInit('Platform classes initialization failed'),
      },
      invoke: {
        src: 'platformClassesInit',
        input: ({ event, context }) => ({ 
          event: event as InitEvent, 
          context 
        }),
        onError: failInit('Platform classes initialization failed'),
      },
    },
    [FILE_SYSTEM_INIT]: {
      on: {
        [FILE_SYSTEM_READY]: {
          target: DB_INIT,
        },
        error: failInit('File system initialization failed'),
      },
      invoke: {
        src: 'fileSystemInit',
        input: ({ context }) => ({ context }),
        onError: failInit('File system initialization failed'),
      },
    },
    [DB_INIT]: {
      on: {
        [DB_READY]: {
          target: SAVE_CONFIG,
        },
        error: failInit('Database initialization failed'),
      },
      invoke: {
        src: 'dbInit',
        input: ({ context }) => ({ context }),
        onError: failInit('Database initialization failed'),
      },
    },
    [SAVE_CONFIG]: {
      on: {
        [SAVE_CONFIG_SUCCESS]: {
          target: PROCESS_SCHEMA_FILES,
        },
        error: failInit('Saving config failed'),
      },
      invoke: {
        src: 'saveConfig',
        input: ({ context }) => ({ context }),
        onError: failInit('Saving config failed'),
      },
    },
    [PROCESS_SCHEMA_FILES]: {
      on: {
        [PROCESS_SCHEMA_FILES_SUCCESS]: {
          target: ADD_MODELS_TO_STORE,
        },
        error: failInit('Schema processing failed'),
      },
      invoke: {
        src: 'processSchemaFiles',
        input: ({ context }) => ({ context }),
        onError: failInit('Schema processing failed'),
      },
    },
    [ADD_MODELS_TO_STORE]: {
      on: {
        [ADD_MODELS_TO_STORE_SUCCESS]: {
          target: ADD_MODELS_TO_DB,
        },
        error: failInit('Adding models to store failed'),
      },
      invoke: {
        src: 'addModelsToStore',
        input: ({ context }) => ({ context }),
        onError: failInit('Adding models to store failed'),
      },
    },
    [ADD_MODELS_TO_DB]: {
      on: {
        [ADD_MODELS_TO_DB_SUCCESS]: {
          target: IDLE,
        },
        error: failInit('Adding models to database failed'),
      },
      invoke: {
        src: 'addModelsToDb',
        input: ({ context }) => ({ context }),
        onError: failInit('Adding models to database failed'),
      },
    },
    [INIT_FAILED]: {
      entry: assign({
        isInitialized: false,
      }),
      on: {
        init: {
          target: PLATFORM_CLASSES_INIT,
          actions: assign({
            isInitialized: false,
            initError: undefined,
            saveError: undefined,
          }),
        },
      },
    },
    [IDLE]: {
      entry: assign({
        isInitialized: true,
      }),
      on: {
        [SAVE_APP_STATE_SUCCESS]: {
          actions: [
            assign(() => {
              return {
                isSaving: false,
                saveError: undefined,
              }
            }),
            ({ context, event }) =>
              maybeRunSyncFromEasAfterAddressSave({
                context,
                event: event as { key?: string; value?: unknown },
              }),
            ({ event }) =>
              emitAddressesPersistedIfAddressesKey(
                event as { key?: string; value?: unknown },
              ),
          ],
        },
        [SAVE_APP_STATE_ERROR]: {
          actions: assign(({ event }) => ({
            isSaving: false,
            saveError: errorFromEvent(event, 'Failed to save app state'),
          })),
        },
        [SET_ADDRESSES]: {
          actions: [
            assign(({ event, spawn }) => {
              const { addresses } = event as { type: string; addresses: string[] | { owned: string[]; watched?: string[] } }
              const normalized = normalizeAddressConfig(addresses)
              spawn('saveAppState', {
                input: {
                  key: 'addresses',
                  value: { owned: normalized.owned, watched: normalized.watched },
                },
              })
              return {
                addresses: normalized.owned,
                ownedAddresses: normalized.owned,
                watchedAddresses: normalized.watched,
                isSaving: true,
                saveError: undefined,
              }
            })
          ],
        },
        init: {
          target: PLATFORM_CLASSES_INIT,
          actions: assign({
            isInitialized: false,
            initError: undefined,
            saveError: undefined,
          }),
        },
      },
    },
  },
})
