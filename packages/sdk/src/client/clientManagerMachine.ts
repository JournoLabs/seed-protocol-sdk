import { ClientManagerContext } from "@/types"
import { assign, fromPromise, setup } from "xstate"
import debug from "debug"
import { normalizeAddressConfig } from "@/helpers/addresses"
import { requestEasSyncFromAddressChange } from "@/events/item/easSyncManager"
import { platformClassesInit, type InitEvent } from "./actors/platformClassesInit"
import { saveAppState } from "./actors/saveAppState"
import { fileSystemInit } from "./actors/fileSystemInit"
import { dbInit } from "./actors/dbInit"
import { ClientManagerEvents, ClientManagerState, MachineIds } from "@/client/constants"
import { addModelsToDb } from "./actors/addModelsToDb"
import { saveConfig } from "./actors/saveConfig"
import { processSchemaFiles } from "./actors/processSchemaFiles"
import { announceAddressesPersisted } from "@/client/addressesPersisted"
import { startCanonicalizeModelTypes } from "@/db/canonicalizeModelTypes"
import { startItemOutbox } from "@/outbox"
import {
  parseAddressesPersistedPayload,
} from "@/client/events"

const {
  UNINITIALIZED,
  PLATFORM_CLASSES_INIT,
  FILE_SYSTEM_INIT,
  DB_INIT,
  SAVE_CONFIG,
  PROCESS_SCHEMA_FILES,
  ADD_MODELS_TO_DB,
  IDLE,
  INIT_FAILED,
} = ClientManagerState

const {
  UPDATE_CONTEXT,
  SAVE_APP_STATE_SUCCESS,
  SAVE_APP_STATE_ERROR,
  SET_ADDRESSES,
} = ClientManagerEvents

// processSchemaFiles can be slow (syncSchemaFromSource, loadAllSchemasFromDb, OPFS file I/O)
const PROCESS_SCHEMA_FILES_TIMEOUT_MS = 120000

type StepInput = { context: ClientManagerContext }

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
  announceAddressesPersisted(payload)
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
  // Each init step is one awaited function; a rejection moves the client to INIT_FAILED.
  actors: {
    platformClassesInit: fromPromise<Partial<ClientManagerContext>, { event: InitEvent }>(({ input }) =>
      platformClassesInit(input),
    ),
    fileSystemInit: fromPromise<void, StepInput>(({ input }) => fileSystemInit(input.context)),
    dbInit: fromPromise<void, StepInput>(({ input }) => dbInit(input.context)),
    saveConfig: fromPromise<void, StepInput>(({ input }) => saveConfig(input.context)),
    processSchemaFiles: fromPromise<ClientManagerContext['models'], StepInput>(({ input }) =>
      processSchemaFiles(input.context),
    ),
    addModelsToDb: fromPromise<void, StepInput>(({ input }) => addModelsToDb(input.context)),
    saveAppState,
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
    [UNINITIALIZED]: {},
    [PLATFORM_CLASSES_INIT]: {
      invoke: {
        src: 'platformClassesInit',
        input: ({ event }) => ({ event: event as InitEvent }),
        onDone: {
          target: FILE_SYSTEM_INIT,
          actions: assign(({ event }) => event.output),
        },
        onError: failInit('Platform classes initialization failed'),
      },
    },
    [FILE_SYSTEM_INIT]: {
      invoke: {
        src: 'fileSystemInit',
        input: ({ context }) => ({ context }),
        onDone: DB_INIT,
        onError: failInit('File system initialization failed'),
      },
    },
    [DB_INIT]: {
      invoke: {
        src: 'dbInit',
        input: ({ context }) => ({ context }),
        onDone: SAVE_CONFIG,
        onError: failInit('Database initialization failed'),
      },
    },
    [SAVE_CONFIG]: {
      invoke: {
        src: 'saveConfig',
        input: ({ context }) => ({ context }),
        onDone: PROCESS_SCHEMA_FILES,
        onError: failInit('Saving config failed'),
      },
    },
    [PROCESS_SCHEMA_FILES]: {
      invoke: {
        src: 'processSchemaFiles',
        input: ({ context }) => ({ context }),
        onDone: {
          target: ADD_MODELS_TO_DB,
          actions: assign({ models: ({ event }) => event.output }),
        },
        onError: failInit('Schema processing failed'),
      },
      after: {
        [PROCESS_SCHEMA_FILES_TIMEOUT_MS]: failInit(
          `processSchemaFiles timed out after ${PROCESS_SCHEMA_FILES_TIMEOUT_MS}ms`,
        ),
      },
    },
    [ADD_MODELS_TO_DB]: {
      invoke: {
        src: 'addModelsToDb',
        input: ({ context }) => ({ context }),
        onDone: IDLE,
        onError: failInit('Adding models to database failed'),
      },
    },
    [INIT_FAILED]: {
      entry: assign({
        isInitialized: false,
      }),
    },
    [IDLE]: {
      entry: [
        assign({
          isInitialized: true,
        }),
        // Stored model types to the ADR 0008 form (html_page), so exact type filters find old rows.
        () => startCanonicalizeModelTypes(),
        // Registers the item appliers and resumes outbox ops left pending (a reload, a closed
        // leader tab) once this tab leads
        () => startItemOutbox(),
      ],
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
      },
    },
  },
})
