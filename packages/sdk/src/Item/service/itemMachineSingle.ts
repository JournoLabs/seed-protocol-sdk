import { assign, setup } from 'xstate'
import { MachineIds } from '@/client/constants'
import { ItemMachineContext } from '@/types'
import { waitForDb } from './actors/waitForDb'
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
            
            
            // Merge property instances from loadOrCreateItem (Fix 2: preserve existing when it has propertyRecordSchema and incoming doesn't)
            if (item.propertyInstances) {
              for (const [propertyName, propertyInstance] of item.propertyInstances) {
                const existing = existingPropertyInstances.get(propertyName) as IItemProperty<any> | undefined
                const existingHasSchema = existing?.propertyDef
                const incomingHasSchema = (propertyInstance as IItemProperty<any>)?.propertyDef
                const action = existingHasSchema && !incomingHasSchema ? 'preserve' : 'overwrite'

                if (existingHasSchema && !incomingHasSchema) {
                  continue // Preserve existing instance with schema
                }
                existingPropertyInstances.set(propertyName, propertyInstance)
              }
            }

            return {
              ...context,
              seedLocalId: item.seedLocalId || context.seedLocalId,
              seedUid: item.seedUid || context.seedUid,
              schemaUid: item.schemaUid || context.schemaUid,
              modelFileId: item.modelFileId || context.modelFileId,
              latestVersionLocalId: item.latestVersionLocalId || context.latestVersionLocalId,
              latestVersionUid: item.latestVersionUid || context.latestVersionUid,
              versionsCount: item.versionsCount || context.versionsCount,
              lastVersionPublishedAt: item.lastVersionPublishedAt || context.lastVersionPublishedAt,
              attestationCreatedAt: item.attestationCreatedAt || context.attestationCreatedAt,
              createdAt: item.createdAt || context.createdAt,
              publisher: item.publisher ?? context.publisher,
              revokedAt: item.revokedAt ?? context.revokedAt,
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
  },
})
