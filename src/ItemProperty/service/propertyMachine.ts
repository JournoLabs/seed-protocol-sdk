import { assign, setup } from 'xstate'
import { PropertyMachineContext } from '@/types'

import { resolveRemoteStorage } from '@/ItemProperty/service/actors/resolveRemoteStorage'
import { waitForDb } from '@/ItemProperty/service/actors/waitForDb'
import { initialize } from '@/ItemProperty/service/actors/initialize'
import { resolveRelatedValue } from '@/ItemProperty/service/actors/resolveRelatedValue'
import { hydrateFromDb } from '@/ItemProperty/service/actors/hydrateFromDb'
import {
  saveImageSrc,
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
    hydrateFromDb,
    initialize,
    resolveRelatedValue,
    resolveRemoteStorage,
    analyzeInput,
    saveImageSrc,
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
      }),
      target: '.saving',
    },
    updateContext: {
      actions: assign(({ context, event }) => {
        const newContext = Object.assign({}, context)

        for (let i = 0; i < Object.keys(event).length; i++) {
          const key = Object.keys(event)[i]
          if (key === 'type') {
            continue
          }
          newContext[key] = event[key]
        }
        return newContext
      }),
    },
  },
  states: {
    idle: {},
    waitingForDb: {
      on: {
        waitForDbSuccess: {
          target: 'hydratingFromDb',
          actions: assign({
            isDbReady: true,
          }),
        },
      },
      invoke: {
        src: 'waitForDb',
        input: ({ context }) => ({ context }),
      },
    },
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
            resolvedValue: ({ event }) => event.refResolvedValue,
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
            saveImageSrc: 'savingImageSrc',
            saveRelation: 'savingRelation',
            saveItemStorage: 'savingItemStorage',
          },
          invoke: {
            src: 'analyzeInput',
            input: ({ context, event }) => ({ context, event }),
          },
        },
        savingImageSrc: {
          on: {
            saveImageSrcSuccess: 'doneSaving',
          },
          invoke: {
            src: 'saveImageSrc',
            input: ({ context, event }) => ({ context, event }),
          },
        },
        savingRelation: {
          on: {
            saveRelationSuccess: 'doneSaving',
          },
          invoke: {
            src: 'saveRelation',
            input: ({ context, event }) => ({ context, event }),
          },
        },
        savingItemStorage: {
          on: {
            saveItemStorageSuccess: 'doneSaving',
          },
          invoke: {
            src: 'saveItemStorage',
            input: ({ context, event }) => ({ context, event }),
          },
        },
        doneSaving: {
          type: 'final',
        },
      },
      onDone: {
        target: 'idle',
        actions: assign(({ context }) => {
          return {
            isSaving: false,
          }
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
