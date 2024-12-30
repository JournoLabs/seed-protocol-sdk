import { assign, setup } from 'xstate'
import { MachineIds } from '@/browser/services/internal/constants'
import { ItemMachineContext } from '@/types'
import { ItemProperty } from '../../property'
import { waitForDb } from './actors/waitForDb'
import { initialize } from './actors/initialize'
import { hydrateExistingItem } from './actors/hydrateExistingItem'
import { hydrateNewItem } from './actors/hydrateNewItem'
import { fetchDataFromEas } from './actors/fetchDataFromEas'
import { reload } from '@/browser/item/single/actors/reload'

export const itemMachineSingle = setup({
  types: {
    context: {} as ItemMachineContext<any>,
    input: {},
  },
  actors: {
    waitForDb,
    initialize,
    hydrateExistingItem,
    hydrateNewItem,
    fetchDataFromEas,
    reload,
  },
}).createMachine({
  id: MachineIds.ITEM,
  initial: 'waitingForDb',
  context: ({ input }) => input as ItemMachineContext<any>,
  on: {
    updatedPropertiesBySchemaUid: {
      actions: assign({
        propertiesBySchemaUid: ({ event }) => event.propertiesBySchemaUid,
      }),
    },
    updatePropertiesMetadata: {
      actions: assign({
        propertiesMetadata: ({ event }) => event.propertiesMetadata,
      }),
    },
    updateProperties: {
      actions: assign({
        propertiesUpdatedAt: Date.now(),
      }),
    },
    updateValue: {
      actions: assign(({ event, context }) => {
        let { propertyInstances } = context
        if (!propertyInstances) {
          propertyInstances = new Map<string, ItemProperty<any>>()
        }
        const { propertyName, propertyValue } = event

        if (!propertyInstances.has(propertyName)) {
          return {
            [propertyName]: propertyValue,
          }
        }
        const propertyInstance = propertyInstances.get(
          propertyName,
        ) as ItemProperty<any>

        propertyInstance.value = propertyValue
        propertyInstances.set(propertyName, propertyInstance)
        // TODO: use immer here
        return {
          propertyInstances,
        }
      }),
    },
    addPropertyInstance: {
      actions: assign(({ context, event }) => {
        const propertyInstances =
          context.propertyInstances || new Map<string, typeof ItemProperty>()
        propertyInstances.set(event.propertyName, event.propertyInstance)
        return {
          propertyInstances,
        }
      }),
    },
    reload: '.reloading',
  },
  states: {
    idle: {},
    waitingForDb: {
      on: {
        waitForDbSuccess: 'initializing',
      },
      invoke: {
        src: 'waitForDb',
      },
    },
    initializing: {
      on: {
        hasExistingItem: {
          target: 'idle',
          actions: assign({
            modelTableName: ({ event }) => event.modelTableName,
            modelNamePlural: ({ event }) => event.modelNamePlural,
            modelName: ({ event }) => event.modelName,
            existingItem: ({ event }) => event.existingItem,
          }),
        },
        isNewItem: {
          target: 'idle',
          actions: assign({
            modelTableName: ({ event }) => event.modelTableName,
            modelNamePlural: ({ event }) => event.modelNamePlural,
            modelName: ({ event }) => event.modelName,
          }),
        },
      },
      invoke: {
        src: 'initialize',
        input: ({ context, event }) => ({ context, event }),
      },
    },
    hydratingExistingItem: {
      on: {
        hydrateExistingItemSuccess: 'idle',
        hydrateExistingItemFailure: 'destroying',
      },
      invoke: {
        src: 'hydrateExistingItem',
        input: ({ event, context }) => ({ event, context }),
      },
    },
    hydratingNewItem: {
      on: {
        hydrateNewItemSuccess: 'idle',
      },
      invoke: {
        src: 'hydrateNewItem',
        input: ({ context }) => ({ context }),
      },
    },
    fetchingRemoteData: {
      on: {
        fetchRemoteDataSuccess: 'idle',
      },
      invoke: {
        src: 'fetchRemoteData',
        input: ({ context }) => ({ context }),
      },
    },
    reloading: {
      on: {
        reloadSuccess: 'idle',
      },
      invoke: {
        src: 'reload',
        input: ({ context }) => ({ context }),
      },
    },
    destroying: {
      type: 'final',
    },
  },
})
