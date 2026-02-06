import { assign, setup } from 'xstate'
import { MachineIds } from '@/client/constants'
import { ItemMachineContext, HydrateExistingItemEvent } from '@/types'
import { waitForDb } from './actors/waitForDb'
import { initialize } from './actors/initialize'
import { hydrateExistingItem } from './actors/hydrateExistingItem'
import { hydrateNewItem } from './actors/hydrateNewItem'
import { fetchDataFromEas } from './actors/fetchDataFromEas'
import { reload } from './actors/reload'
import { loadOrCreateItem } from './actors/loadOrCreateItem'
import { runPublish } from './actors/runPublish'
import { IItemProperty } from '@/interfaces'

// @ts-ignore - Complex type inference from setup().createMachine()
export const itemMachineSingle = setup({
  types: {
    context: {} as ItemMachineContext<any>,
    input: {},
  },
  actors: {
    waitForDb,
    loadOrCreateItem,
    initialize,
    hydrateExistingItem,
    hydrateNewItem,
    fetchDataFromEas,
    reload,
    runPublish,
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
          propertyInstances = new Map<string, IItemProperty<any>>()
        }
        const { propertyName, propertyValue } = event

        if (!propertyInstances.has(propertyName)) {
          return {
            [propertyName]: propertyValue,
          }
        }
        const propertyInstance = propertyInstances.get(
          propertyName,
        ) as IItemProperty<any>

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
          context.propertyInstances || new Map<string, IItemProperty<any>>()
        propertyInstances.set(event.propertyName, event.propertyInstance)
        return {
          propertyInstances,
        }
      }),
    },
    removePropertyInstance: {
      actions: assign(({ context, event }) => {
        const propertyInstances =
          context.propertyInstances || new Map<string, IItemProperty<any>>()
        propertyInstances.delete((event as { type: 'removePropertyInstance'; propertyName: string }).propertyName)
        return {
          propertyInstances,
        }
      }),
    },
    updateContext: {
      actions: assign(({ context, event }) => {
        const updates: any = {}
        for (const key in event) {
          if (key !== 'type' && key in context) {
            updates[key] = (event as any)[key]
          }
        }
        return {
          ...context,
          ...updates,
        }
      }),
    },
    reload: '.reloading',
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
  },
  states: {
    idle: {
      on: {
        startPublish: 'publishing',
      },
    },
    publishing: {
      on: {
        publishSuccess: {
          target: 'idle',
          actions: assign({ _publishError: () => null }),
        },
        publishError: {
          target: 'idle',
          actions: assign({
            _publishError: ({ event }) => {
              const err = 'error' in event ? (event as unknown as { error: Error }).error : null
              return err ? { message: err.message } : null
            },
          }),
        },
      },
      invoke: {
        src: 'runPublish',
        input: ({ context }) => ({ context }),
      },
    },
    waitingForDb: {
      on: {
        waitForDbSuccess: 'loading',
      },
      invoke: {
        src: 'waitForDb',
        input: ({ context }) => ({ context }),
      },
    },
    loading: {
      on: {
        loadOrCreateItemSuccess: {
          target: 'idle',
          actions: assign(({ context, event }) => {
            const item = (event as any).item
            const existingPropertyInstances = context.propertyInstances || new Map<string, IItemProperty<any>>()
            
            console.log(`[itemMachine] loadOrCreateItemSuccess for modelName: ${context.modelName}, propertyInstances from event:`, item.propertyInstances ? Array.from(item.propertyInstances.keys()) : 'none')
            
            // Merge property instances from loadOrCreateItem
            if (item.propertyInstances) {
              for (const [propertyName, propertyInstance] of item.propertyInstances) {
                existingPropertyInstances.set(propertyName, propertyInstance)
              }
            }
            
            console.log(`[itemMachine] After merge, total propertyInstances:`, Array.from(existingPropertyInstances.keys()))
            
            return {
              ...context,
              seedLocalId: item.seedLocalId || context.seedLocalId,
              seedUid: item.seedUid || context.seedUid,
              schemaUid: item.schemaUid || context.schemaUid,
              latestVersionLocalId: item.latestVersionLocalId || context.latestVersionLocalId,
              latestVersionUid: item.latestVersionUid || context.latestVersionUid,
              versionsCount: item.versionsCount || context.versionsCount,
              lastVersionPublishedAt: item.lastVersionPublishedAt || context.lastVersionPublishedAt,
              attestationCreatedAt: item.attestationCreatedAt || context.attestationCreatedAt,
              createdAt: item.createdAt || context.createdAt,
              propertyInstances: existingPropertyInstances,
            }
          }),
        },
        loadOrCreateItemError: {
          target: 'error',
        },
      },
      invoke: {
        src: 'loadOrCreateItem',
        input: ({ context }) => ({ context }),
      },
    },
    error: {},
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
        input: ({ context }) => ({ context }),
      },
    },
    hydratingExistingItem: {
      on: {
        hydrateExistingItemSuccess: 'idle',
        hydrateExistingItemFailure: 'destroying',
      },
      invoke: {
        src: 'hydrateExistingItem',
        input: ({ event, context }) => ({ 
          event: event as HydrateExistingItemEvent, 
          context 
        }),
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
        fetchDataFromEasSuccess: 'idle',
      },
      invoke: {
        src: 'fetchDataFromEas',
        input: ({ context }: { context: ItemMachineContext<any> }) => ({ context }),
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
