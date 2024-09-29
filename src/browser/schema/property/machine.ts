import { assign, setup } from 'xstate'
import { initialize, resolveRelatedValue, waitForDb } from './actors'
import { PropertyType } from '@/types'

export type PropertyMachineContext = {
  propertyLocalId: string
  fetchedValue: any
  pendingSave: boolean
  pendingFetch: boolean
  savedData: any
  propertyName: string
  propertyValue: any
  propertyValueType: string
  propertyRelationValueType?: string
  propertyRelationValue?: any
  propertyRelationDisplayValue?: any
  propertyRecordSchema?: PropertyType
  isRelation: boolean
  itemModelName: string
  schemaUid?: string
  isDbReady: boolean
  seedLocalId: string
  seedUid: string
}

export const propertyMachine = setup({
  types: {
    context: {} as PropertyMachineContext,
  },
  actors: {
    initialize,
    resolveRelatedValue,
    waitForDb,
  },
}).createMachine({
  id: 'itemProperty',
  initial: 'initializing',
  context: ({ input }) => input as PropertyMachineContext,
  on: {
    // updatePropertyValue: {
    //   target: '.resolvingRelatedValue',
    //   guard: ({ context }) => !context.isDbReady,
    //   actions: assign(({ event }) => {
    //     return {
    //       propertyValue: event.propertyValue,
    //     }
    //   }),
    // },
    updateSchemaUid: {
      // target: '.resolvingRelatedValue',
      actions: assign(({ event }) => {
        return {
          schemaUid: event.schemaUid,
        }
      }),
    },
  },
  states: {
    idle: {},
    waitingForDb: {
      on: {
        waitForDbSuccess: {
          target: 'initializing',
          actions: assign({
            isDbReady: true,
          }),
        },
      },
      invoke: {
        src: 'waitForDb',
      },
    },
    initializing: {
      on: {
        initializeSuccess: 'idle',
        // isRelatedProperty: {
        //   target: 'resolvingRelatedValue',
        //   guard: ({ context }) => !context.isDbReady,
        // },
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
            propertyRelationDisplayValue: ({ event }) =>
              event.propertyRelationDisplayValue,
            propertyRelationValue: ({ event }) => event.propertyRelationValue,
          }),
        },
      },
      invoke: {
        src: 'resolveRelatedValue',
        input: ({ context }) => ({ context }),
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
