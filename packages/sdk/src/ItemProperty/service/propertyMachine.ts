import { assign, setup, stateIn } from 'xstate'
import { PropertyMachineContext, SaveValueToDbEvent } from '@/types'

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
} from '@/ItemProperty/service/actors/saveValueToDb'
import { analyzeInput } from '@/ItemProperty/service/actors/saveValueToDb/analyzeInput'
import { listRelationEasPropertyName } from '@/helpers/metadataPropertyNames'
import { normalizePropertyRecordSchema } from '@/helpers/property'

/**
 * A List-of-relation schema can arrive after construction (item loaded before its model).
 * Move the context to the storage name (staff → staffIdentityIds) so saves and publish use one name;
 * ItemProperty keeps exposing the schema key.
 */
const withListRelationStorageName = <T extends { propertyName?: string; propertyRecordSchema?: any; isRelation?: boolean }>(
  context: T,
): T => {
  if (!context.propertyName || !context.propertyRecordSchema) return context
  const storageName = listRelationEasPropertyName(
    context.propertyName,
    normalizePropertyRecordSchema(context.propertyRecordSchema),
  )
  if (!storageName || storageName === context.propertyName) return context
  return { ...context, propertyName: storageName, isRelation: true }
}

/**
 * List values are stored as JSON array strings. Whichever actor or event delivers one, a List
 * property holds the array, so `value` reads the same on a new item and after a reload.
 */
const withListValueParsed = <T extends { propertyValue?: unknown; renderValue?: unknown; propertyRecordSchema?: any }>(
  context: T,
): T => {
  if (normalizePropertyRecordSchema(context.propertyRecordSchema ?? {})?.dataType !== 'List') return context
  const parse = (value: unknown) => {
    if (typeof value !== 'string' || !value.trimStart().startsWith('[')) return value
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : value
    } catch {
      return value
    }
  }
  const propertyValue = parse(context.propertyValue)
  const renderValue = parse(context.renderValue)
  if (propertyValue === context.propertyValue && renderValue === context.renderValue) return context
  return { ...context, propertyValue, renderValue }
}

/** Keeps the thrown Error itself, so `save()` rethrows it with its class, `code` and `cause`. */
const toError = (error: unknown): Error => (error instanceof Error ? error : new Error(String(error)))

export const propertyMachine = setup({
  types: {
    context: {} as PropertyMachineContext,
    input: {} as PropertyMachineContext,
  },
  guards: {
    // stateIn return type does not satisfy setup() inference; runtime guard is correct for root state `idle`.
    propertyMachineIsIdle: stateIn('idle') as any,
  },
  actions: {
    /**
     * A storage save (Image, File, Html, ItemStorage) failed. Each throws before or during its
     * write, so nothing was stored: restore the shown value, as saveFailed does.
     */
    restoreValueAfterSaveError: assign(({ context, event }) => ({
      _saveError: toError((event as { error?: unknown }).error),
      ...((context._valueBeforeSave ?? {}) as Partial<PropertyMachineContext>),
      _valueBeforeSave: undefined,
    })),
  },
  actors: {
    waitForDb,
    loadOrCreateProperty,
    hydrateFromDb,
    initialize,
    resolveRelatedValue,
    analyzeInput,
    saveImage,
    saveFile,
    saveHtml,
    saveItemStorage,
  },
}).createMachine({
  id: 'itemProperty',
  initial: 'waitingForDb',
  context: ({ input }) => input as PropertyMachineContext,
  on: {
    /** Re-run DB hydration (e.g. after EAS sync wrote new metadata for this version). */
    rehydrateFromDb: {
      guard: 'propertyMachineIsIdle',
      target: '.hydratingFromDb',
    },
    save: {
      actions: assign({
        isSaving: true,
        _saveError: undefined,
        _saveValidationErrors: undefined,
        _valueBeforeSave: ({ event }) => (event as { before?: PropertyMachineContext['_valueBeforeSave'] }).before,
      }),
      target: '.saving',
    },
    /** analyzeInput refused (item not owned) or failed before writing: restore the shown value. */
    saveFailed: {
      target: '.idle',
      actions: assign(({ context, event }) => {
        const error = (event as { type: 'saveFailed'; error: unknown }).error
        return {
          isSaving: false,
          _saveError: toError(error),
          ...((context._valueBeforeSave ?? {}) as Partial<PropertyMachineContext>),
          _valueBeforeSave: undefined,
        }
      }),
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
        return withListValueParsed(
          'propertyRecordSchema' in (event as any) ? withListRelationStorageName(newContext) : newContext,
        )
      }),
    },
    destroyStarted: {
      actions: assign({ _destroyError: null }),
    },
    destroyError: {
      actions: assign(({ event }) => ({
        _destroyError:
          (event as { type: 'destroyError'; error: unknown }).error instanceof Error
            ? {
                message: (event as { type: 'destroyError'; error: Error }).error.message,
                name: (event as { type: 'destroyError'; error: Error }).error.name,
              }
            : { message: String((event as { type: 'destroyError'; error: unknown }).error) },
      })),
    },
    /** The value broke its property's rules: nothing was written, so restore the shown value. */
    saveValueValidationError: {
      target: '.idle',
      actions: assign(({ context, event }) => ({
        isSaving: false,
        _saveValidationErrors: (event as { type: 'saveValueValidationError'; errors: any[] }).errors,
        ...((context._valueBeforeSave ?? {}) as Partial<PropertyMachineContext>),
        _valueBeforeSave: undefined,
      })),
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
            return withListValueParsed(withListRelationStorageName({
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
            }))
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
              actions: 'restoreValueAfterSaveError',
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
              actions: 'restoreValueAfterSaveError',
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
              actions: 'restoreValueAfterSaveError',
            },
          },
          invoke: {
            src: 'saveHtml',
            input: ({ context, event }) => {
              return { context, event: event as SaveValueToDbEvent }
            },
          },
        },
        savingItemStorage: {
          on: {
            saveItemStorageSuccess: 'doneSaving',
            saveItemStorageError: {
              target: 'doneSaving',
              actions: 'restoreValueAfterSaveError',
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
          // Only a refused or failed save restores it; kept after success, it pinned the old value.
          _valueBeforeSave: undefined,
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
