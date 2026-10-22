import { and, assign, setup, stateIn } from 'xstate'
import { PropertyMachineContext } from '@/types'

import { initialize } from '@/ItemProperty/service/actors/initialize'
import { resolveRelatedValue } from '@/ItemProperty/service/actors/resolveRelatedValue'
import { hydrateFromDb } from '@/ItemProperty/service/actors/hydrateFromDb'
import { listRelationEasPropertyName } from '@/helpers/metadataPropertyNames'
import { normalizePropertyRecordSchema } from '@/helpers/property'
import { applyContextUpdate } from '@/helpers/entity/contextUpdate'

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

export const propertyMachine = setup({
  types: {
    context: {} as PropertyMachineContext,
    input: {} as PropertyMachineContext,
  },
  guards: {
    // Loaded (ItemProperty.load) and not hydrating already. stateIn's return type does not satisfy
    // setup() inference; the runtime guard is correct for root state `idle`.
    propertyMachineIsIdle: and([stateIn('idle') as any, ({ context }) => context._status === 'ready']),
  },
  actors: {
    hydrateFromDb,
    initialize,
    resolveRelatedValue,
  },
}).createMachine({
  id: 'itemProperty',
  // Loading runs outside the machine (ItemProperty.load); its result arrives as `loaded`
  initial: 'idle',
  context: ({ input }) => input as PropertyMachineContext,
  on: {
    /** Re-run DB hydration (e.g. after EAS sync wrote new metadata for this version). */
    rehydrateFromDb: {
      guard: 'propertyMachineIsIdle',
      target: '.hydratingFromDb',
    },
    loaded: {
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
    updateContext: {
      actions: assign(({ context, event }) => {
        const newContext = applyContextUpdate(context, event) as any
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
    clearSaveError: {
      actions: assign({ _saveError: null }),
    },
  },
  states: {
    idle: {},
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
  },

})
