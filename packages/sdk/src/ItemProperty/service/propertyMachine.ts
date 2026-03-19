import { assign, setup } from 'xstate'
import { PropertyMachineContext, SaveValueToDbEvent } from '@/types'

import { resolveRemoteStorage } from '@/ItemProperty/service/actors/resolveRemoteStorage'
import { waitForDb } from '@/ItemProperty/service/actors/waitForDb'
import { initialize } from '@/ItemProperty/service/actors/initialize'
import { resolveRelatedValue } from '@/ItemProperty/service/actors/resolveRelatedValue'
import { hydrateFromDb } from '@/ItemProperty/service/actors/hydrateFromDb'
import { loadOrCreateProperty } from '@/ItemProperty/service/actors/loadOrCreateProperty'
import {
  saveImage,
  saveFile,
  saveHtml,
  saveItemStorage,
  saveRelation,
} from '@/ItemProperty/service/actors/saveValueToDb'
import { analyzeInput } from '@/ItemProperty/service/actors/saveValueToDb/analyzeInput' // import { updateMachineContext } from '@/helpers'
// import { updateMachineContext } from '@/helpers'

export const propertyMachine = setup({
  types: {
    context: {} as PropertyMachineContext,
    input: {} as PropertyMachineContext,
  },
  // actions: {
  //   updateContext: updateMachineContext,
  // },
  actors: {
    waitForDb,
    loadOrCreateProperty,
    hydrateFromDb,
    initialize,
    resolveRelatedValue,
    resolveRemoteStorage,
    analyzeInput,
    saveImage,
    saveFile,
    saveHtml,
    saveRelation,
    saveItemStorage,
  },
}).createMachine({
  id: 'itemProperty',
  initial: 'waitingForDb',
  context: ({ input }) => input as PropertyMachineContext,
  on: {
    // reload: '.hydratingFromDb',
    save: {
      actions: assign({
        isSaving: true,
        _saveError: undefined,
      }),
      target: '.saving',
    },
    updateContext: {
      actions: assign(({ context, event }) => {
        const newContext = Object.assign({}, context) as any

        for (let i = 0; i < Object.keys(event).length; i++) {
          const key = Object.keys(event)[i]
          if (key === 'type') {
            continue
          }
          newContext[key] = (event as any)[key]
        }
        return newContext
      }),
    },
    destroyStarted: {
      actions: assign({ _destroyInProgress: true, _destroyError: null }),
    },
    destroyDone: {
      actions: assign({ _destroyInProgress: false }),
    },
    destroyError: {
      actions: assign(({ event }) => ({
        _destroyInProgress: false,
        _destroyError:
          (event as { type: 'destroyError'; error: unknown }).error instanceof Error
            ? {
                message: (event as { type: 'destroyError'; error: Error }).error.message,
                name: (event as { type: 'destroyError'; error: Error }).error.name,
              }
            : { message: String((event as { type: 'destroyError'; error: unknown }).error) },
      })),
    },
    clearDestroyError: {
      actions: assign({ _destroyError: null }),
    },
    saveValueValidationError: {
      target: '.idle',
      actions: assign({
        isSaving: false,
        _saveValidationErrors: ({ event }) => (event as { type: 'saveValueValidationError'; errors: any[] }).errors,
      }),
    },
    clearSaveError: {
      actions: assign({ _saveError: null }),
    },
  },
  states: {
    idle: {},
    waitingForDb: {
      on: {
        waitForDbSuccess: {
          target: 'loading',
          actions: assign({
            isDbReady: true,
          }),
        },
        waitForDbError: {
          target: 'error',
        },
      },
      invoke: {
        src: 'waitForDb',
        input: ({ context }) => ({ context }),
      },
    },
    loading: {
      on: {
        loadOrCreatePropertySuccess: {
          target: 'idle',
          actions: assign(({ context, event }) => {
            const property = (event as any).property
            return {
              ...context,
              propertyName: property.propertyName || context.propertyName,
              propertyValue: property.propertyValue !== undefined ? property.propertyValue : context.propertyValue,
              renderValue: property.renderValue !== undefined ? property.renderValue : context.renderValue,
              seedLocalId: property.seedLocalId || context.seedLocalId,
              seedUid: property.seedUid || context.seedUid,
              versionLocalId: property.versionLocalId || context.versionLocalId,
              versionUid: property.versionUid || context.versionUid,
              schemaUid: property.schemaUid || context.schemaUid,
              localId: property.localId || context.localId,
              uid: property.uid || context.uid,
              modelName: property.modelName || context.modelName,
              propertyRecordSchema: property.propertyRecordSchema || context.propertyRecordSchema,
              refSeedType: property.refSeedType !== undefined ? property.refSeedType : context.refSeedType,
              refResolvedValue: property.refResolvedValue !== undefined ? property.refResolvedValue : context.refResolvedValue,
              refResolvedDisplayValue: property.refResolvedDisplayValue !== undefined ? property.refResolvedDisplayValue : context.refResolvedDisplayValue,
              localStorageDir: property.localStorageDir !== undefined ? property.localStorageDir : context.localStorageDir,
            }
          }),
        },
        loadOrCreatePropertyError: {
          target: 'error',
        },
      },
      invoke: {
        src: 'loadOrCreateProperty',
        input: ({ context }) => ({ context }),
      },
    },
    error: {},
    hydratingFromDb: {
      on: {
        hydrateFromDbSuccess: 'initializing',
      },
      invoke: {
        src: 'hydrateFromDb',
        input: ({ context }) => ({ context }),
      },
    },
    initializing: {
      on: {
        initializeSuccess: 'idle',
        isRelatedProperty: {
          target: 'resolvingRelatedValue',
        },
        hasRemoteBackup: {
          target: 'resolvingRemoteStorage',
        },
      },
      invoke: {
        src: 'initialize',
        input: ({ context, event }) => ({ context, event }),
      },
    },
    resolvingRelatedValue: {
      on: {
        resolvingRelatedValueSuccess: {
          target: 'idle',
          actions: assign({
            refResolvedDisplayValue: ({ event }) =>
              event.refResolvedDisplayValue,
            refResolvedValue: ({ event }) => event.refResolvedValue,
          }),
        },
        resolvingRelatedValueDone: {
          target: 'idle',
        },
      },
      invoke: {
        src: 'resolveRelatedValue',
        input: ({ context }) => ({ context }),
      },
    },
    resolvingRemoteStorage: {
      on: {
        resolveRemoteStorageSuccess: {
          target: 'idle',
        },
      },
      invoke: {
        src: 'resolveRemoteStorage',
        input: ({ context }) => ({ context }),
      },
    },
    saving: {
      initial: 'analyzingInput',
      states: {
        analyzingInput: {
          on: {
            saveValueToDbSuccess: {
              target: 'doneSaving',
            },
            saveImage: 'savingImage',
            saveFile: 'savingFile',
            saveHtml: 'savingHtml',
            saveRelation: 'savingRelation',
            saveItemStorage: 'savingItemStorage',
          },
          invoke: {
            src: 'analyzeInput',
            input: ({ context, event }) => {
              // Type assertion needed because event is AnyEventObject but actor expects SaveValueToDbEvent
              return { context, event: event as SaveValueToDbEvent }
            },
          },
        },
        savingImage: {
          on: {
            saveImageSuccess: 'doneSaving',
            saveImageError: {
              target: 'doneSaving',
              actions: assign({
                _saveError: ({ event }) =>
                  (event as { type: 'saveImageError'; error: unknown }).error instanceof Error
                    ? {
                        message: (event as { type: 'saveImageError'; error: Error }).error.message,
                        name: (event as { type: 'saveImageError'; error: Error }).error.name,
                      }
                    : { message: String((event as { type: 'saveImageError'; error: unknown }).error) },
              }),
            },
          },
          invoke: {
            src: 'saveImage',
            input: ({ context, event }) => {
              // Type assertion needed because event is AnyEventObject but actor expects SaveValueToDbEvent
              return { context, event: event as SaveValueToDbEvent }
            },
          },
        },
        savingFile: {
          on: {
            saveFileSuccess: 'doneSaving',
            saveFileError: {
              target: 'doneSaving',
              actions: assign({
                _saveError: ({ event }) =>
                  (event as { type: 'saveFileError'; error: unknown }).error instanceof Error
                    ? {
                        message: (event as { type: 'saveFileError'; error: Error }).error.message,
                        name: (event as { type: 'saveFileError'; error: Error }).error.name,
                      }
                    : { message: String((event as { type: 'saveFileError'; error: unknown }).error) },
              }),
            },
          },
          invoke: {
            src: 'saveFile',
            input: ({ context, event }) => {
              return { context, event: event as SaveValueToDbEvent }
            },
          },
        },
        savingHtml: {
          on: {
            saveHtmlSuccess: 'doneSaving',
            saveHtmlError: {
              target: 'doneSaving',
              actions: assign({
                _saveError: ({ event }) =>
                  (event as { type: 'saveHtmlError'; error: unknown }).error instanceof Error
                    ? {
                        message: (event as { type: 'saveHtmlError'; error: Error }).error.message,
                        name: (event as { type: 'saveHtmlError'; error: Error }).error.name,
                      }
                    : { message: String((event as { type: 'saveHtmlError'; error: unknown }).error) },
              }),
            },
          },
          invoke: {
            src: 'saveHtml',
            input: ({ context, event }) => {
              return { context, event: event as SaveValueToDbEvent }
            },
          },
        },
        savingRelation: {
          on: {
            saveRelationSuccess: 'doneSaving',
            saveRelationError: {
              target: 'doneSaving',
              actions: assign({
                _saveError: ({ event }) =>
                  (event as { type: 'saveRelationError'; error: unknown }).error instanceof Error
                    ? {
                        message: (event as { type: 'saveRelationError'; error: Error }).error.message,
                        name: (event as { type: 'saveRelationError'; error: Error }).error.name,
                      }
                    : { message: String((event as { type: 'saveRelationError'; error: unknown }).error) },
              }),
            },
          },
          invoke: {
            src: 'saveRelation',
            input: ({ context, event }) => {
              // Type assertion needed because event is AnyEventObject but actor expects SaveValueToDbEvent
              return { context, event: event as SaveValueToDbEvent }
            },
          },
        },
        savingItemStorage: {
          on: {
            saveItemStorageSuccess: 'doneSaving',
            saveItemStorageError: {
              target: 'doneSaving',
              actions: assign({
                _saveError: ({ event }) =>
                  (event as { type: 'saveItemStorageError'; error: unknown }).error instanceof Error
                    ? {
                        message: (event as { type: 'saveItemStorageError'; error: Error }).error.message,
                        name: (event as { type: 'saveItemStorageError'; error: Error }).error.name,
                      }
                    : { message: String((event as { type: 'saveItemStorageError'; error: unknown }).error) },
              }),
            },
          },
          invoke: {
            src: 'saveItemStorage',
            input: ({ context, event }) => {
              // Type assertion needed because event is AnyEventObject but actor expects SaveValueToDbEvent
              return { context, event: event as SaveValueToDbEvent }
            },
          },
        },
        doneSaving: {
          type: 'final',
        },
      },
      onDone: {
        target: 'idle',
        actions: assign({
          isSaving: false,
          _saveValidationErrors: undefined,
        }),
      },
    },
  },

  // conflict: {
  //   on: {
  //     resolveConflict: {
  //       target: 'saving',
  //       actions: assign({
  //         data: ({ context, event }) => event.output,
  //       }),
  //     },
  //   },
  // },
})
