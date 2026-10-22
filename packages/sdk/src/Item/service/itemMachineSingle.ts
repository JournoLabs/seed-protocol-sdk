import { applyContextUpdate } from '@/helpers/entity/contextUpdate'
import { assign, setup } from 'xstate'
import { MachineIds } from '@/client/constants'
import { ItemMachineContext } from '@/types'
import { runPublish } from './actors/runPublish'
import type { ItemPublishOptions } from '@/helpers/publishConfig'
import type { IItem } from '@/interfaces/IItem'
import { IItemProperty } from '@/interfaces'

export const itemMachineSingle = setup({
  types: {
    context: {} as ItemMachineContext<any>,
    input: {},
  },
  actors: {
    runPublish,
  },
}).createMachine({
  id: MachineIds.ITEM,
  // Loading runs outside the machine (Item.load); its result arrives as `loaded`
  initial: 'idle',
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
        propertiesUpdatedAt: () => Date.now(),
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
    loaded: {
      actions: assign(({ context, event }) => {
        const item = (event as any).item
        const existingPropertyInstances = context.propertyInstances || new Map<string, IItemProperty<any>>()
        
        
        // Merge property instances from loadOrCreateItem (Fix 2: preserve existing when it has propertyRecordSchema and incoming doesn't)
        if (item.propertyInstances) {
          for (const [propertyName, propertyInstance] of item.propertyInstances) {
            const existing = existingPropertyInstances.get(propertyName) as IItemProperty<any> | undefined
            const existingHasSchema = existing?.propertyDef
            const incomingHasSchema = (propertyInstance as IItemProperty<any>)?.propertyDef

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
    updateContext: {
      actions: assign(({ context, event }) => applyContextUpdate(context, event)),
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
              if (!('error' in event)) return null
              const err = (event as unknown as { error: unknown }).error
              return err instanceof Error ? err : new Error(String(err))
            },
          }),
        },
      },
      invoke: {
        src: 'runPublish',
        input: ({ context, event }) => ({
          context,
          item: (event as { item?: IItem<any> }).item,
          options: (event as { options?: ItemPublishOptions }).options,
        }),
      },
    },
  },
})
