import { assign, setup } from 'xstate'
import { MachineIds } from '@/browser/services/internal/constants'
import { AllItemsMachineContext } from '@/types'
import { eventEmitter } from '@/eventBus'
import { initialize } from '@/browser/item/all/actors/initialize'
import { fetchDbData } from '@/browser/item/all/actors/fetchDbData'
import { fetchSeeds } from '@/browser/item/all/actors/fetchSeeds'
import { fetchVersions } from '@/browser/item/all/actors/fetchVersions'
import { fetchRelatedItems } from '@/browser/item/all/actors/fetchRelatedItems'
import { processItems } from '@/browser/item/all/actors/processItems'

const excludedVersionUidValues = ['', 'undefined', 'null', '0', 0]

export const itemMachineAll = setup({
  types: {
    context: {} as Partial<AllItemsMachineContext>,
    input: {} as Partial<AllItemsMachineContext> | undefined,
  },
  actors: {
    initialize,
    fetchDbData,
    fetchSeeds,
    fetchVersions,
    fetchRelatedItems,
    processItems,
  },
}).createMachine({
  id: MachineIds.ALL_ITEMS,
  initial: 'uninitialized',
  context: ({ input }) => input as AllItemsMachineContext,
  on: {
    updateTimes: {
      actions: assign({
        times: ({ event }) => event.times,
      }),
    },
  },
  states: {
    idle: {
      entry: ({ self, context }) => {
        eventEmitter.emit('service.saveState.request', {
          state: self.getPersistedSnapshot(),
          serviceId: `${MachineIds.ALL_ITEMS}_${context.modelName}`,
        })
      },
    },
    uninitialized: {
      on: {
        modelsFound: {
          target: 'initializing',
          actions: assign({
            modelAddedToDb: true,
          }),
        },
      },
    },
    initializing: {
      on: {
        initializeSuccess: {
          target: 'fetchingSeeds',
          actions: assign({
            modelName: ({ event }) => event.modelName,
            modelNameLowercase: ({ event }) => event.modelNameLowercase,
            modelNamePlural: ({ event }) => event.modelNamePlural,
            queryVariables: ({ event }) => event.queryVariables,
          }),
        },
        modelsNotFound: 'idle',
      },
      invoke: {
        src: 'initialize',
        input: ({ context }) => ({ context }),
      },
    },
    fetchingSeeds: {
      on: {
        fetchSeedsSuccess: {
          target: 'fetchingVersions',
          actions: assign({
            itemSeeds: ({ event }) => event.itemSeeds,
          }),
        },
      },
      invoke: {
        src: 'fetchSeeds',
        input: ({ context }) => ({ context }),
      },
    },
    fetchingVersions: {
      on: {
        fetchVersionsSuccess: {
          target: 'fetchingRelatedItems',
          actions: assign({
            itemVersions: ({ event }) => event.itemVersions,
          }),
        },
      },
      invoke: {
        src: 'fetchVersions',
        input: ({ context }) => ({ context }),
      },
    },
    fetchingRelatedItems: {
      on: {
        fetchRelatedItemsSuccess: {
          target: 'processingItems',
          actions: assign({
            relatedProperties: ({ event }) => event.relatedProperties,
            relatedVersionsBySeedUid: ({ event }) =>
              event.relatedVersionsBySeedUid,
            relatedVersionsBySchemaUid: ({ event }) =>
              event.relatedVersionsBySchemaUid,
            schemaUidsByModelName: ({ event }) => event.schemaUidsByModelName,
            mostRecentPropertiesBySeedUid: ({ event }) =>
              event.mostRecentPropertiesBySeedUid,
          }),
        },
      },
      invoke: {
        src: 'fetchRelatedItems',
        input: ({ context }) => ({ context }),
      },
    },
    processingItems: {
      on: {
        processItemsSuccess: 'idle',
        itemCreated: {
          actions: assign({
            items: ({ context, event }) => {
              if (context && context.items) {
                const foundItem = context.items.find((item) => {
                  if (!item.versionLocalId) {
                    return false
                  }
                  return (
                    item.versionLocalId === event.item.versionLocalId ||
                    item.versionUid === event.item.versionUid
                  )
                })
                if (foundItem) {
                  return context.items
                }
                return [...context.items, event.item]
              }
              if (context && !context.items) {
                return [event.item]
              }
            },
          }),
        },
      },
      invoke: {
        src: 'processItems',
        input: ({ context, self }) => ({ context, self }),
      },
    },
  },
})
