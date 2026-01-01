import { assign, setup } from 'xstate'
import { EventObject } from 'xstate'
import { ValidationError } from '@/Schema/validation'
import { validateEntity, type ValidateEntityInput } from './actors/validateEntity'
import { writeToDatabase } from './actors/writeToDatabase'
import debug from 'debug'

const logger = debug('seedSdk:write:writeProcessMachine')

export type WriteProcessContext = {
  entityType: 'model' | 'modelProperty' | 'schema'
  entityId: string
  entityData: any
  validationErrors: ValidationError[]
  writeStatus: 'idle' | 'validating' | 'writing' | 'success' | 'error'
  error: Error | null
  retryCount: number
  pendingWrite: {
    data: any
    timestamp: number
  } | null
}

export type WriteProcessEvent = 
  | { type: 'startWrite'; data: any }
  | { type: 'validate' }
  | { type: 'write' }
  | { type: 'writeSuccess'; output?: any }
  | { type: 'writeError'; error: Error }
  | { type: 'retry' }
  | { type: 'revert' }
  | { type: 'reset' }

export const writeProcessMachine = setup({
  types: {
    context: {} as WriteProcessContext,
    input: {} as Partial<WriteProcessContext>,
    events: {} as WriteProcessEvent,
  },
  actors: {
    validateEntity,
    writeToDatabase,
  },
}).createMachine({
  id: 'writeProcess',
  initial: 'idle',
  context: ({ input }) => ({
    entityType: input.entityType!,
    entityId: input.entityId!,
    entityData: input.entityData || {},
    validationErrors: [],
    writeStatus: 'idle',
    error: null,
    retryCount: 0,
    pendingWrite: null,
  }),
  states: {
    idle: {
      on: {
        startWrite: {
          target: 'validating',
          actions: [
            assign({
              pendingWrite: ({ event }) => ({
                data: event.data,
                timestamp: Date.now(),
              }),
              writeStatus: 'validating',
            }),
            ({ event, context }) => {
              logger(`[startWrite] Received startWrite for ${context.entityType} "${context.entityId}"`)
              logger(`[startWrite] Data:`, event.data)
            },
          ],
        },
      },
    },
    validating: {
      entry: ({ context }) => {
        const msg = `[validating] Entering validating state for ${context.entityType} "${context.entityId}"`
        logger(msg)
        console.log(msg) // Always log to console
        logger(`[validating] Entity data:`, context.pendingWrite?.data || context.entityData)
      },
      // @ts-expect-error - XState v5 type inference bug: incorrectly expects ValidateEntityOutput for input
      // The actor correctly expects ValidateEntityInput, but TypeScript infers the wrong type
      invoke: {
        src: 'validateEntity',
        input: ({ context }): ValidateEntityInput => {
          const entityData = context.pendingWrite?.data || context.entityData
          logger(`[validating] Invoking validateEntity with:`, { entityType: context.entityType, entityData })
          return {
            entityType: context.entityType,
            entityData,
          }
        },
        onDone: [
          {
            target: 'writing',
            guard: ({ event }) => {
              console.log(`[validating] onDone handler called, event:`, event)
              console.log(`[validating] event.output:`, event.output)
              // The output might be the result directly, or it might be wrapped in an event
              let result: { isValid: boolean; errors: ValidationError[] }
              if (event.output && typeof event.output === 'object' && 'isValid' in event.output) {
                result = event.output as unknown as { isValid: boolean; errors: ValidationError[] }
              } else if (event.output && typeof event.output === 'object' && 'type' in event.output) {
                // If it's wrapped in an event, extract the result
                result = event.output as any
              } else {
                console.error(`[validating] Unexpected event.output format! Event:`, event)
                return false
              }
              if (!result || typeof result.isValid !== 'boolean') {
                console.error(`[validating] Invalid result format! Result:`, result)
                return false
              }
              const resultMsg = `[validating] Validation result: isValid=${result.isValid}, errors=${result.errors?.length || 0}`
              logger(resultMsg)
              console.log(resultMsg) // Always log to console
              logger(`[validating] Validation result:`, result)
              return result.isValid
            },
            actions: [
              assign({
                validationErrors: [],
                writeStatus: 'writing',
              }),
              ({ context }) => {
                const msg = `[validating] Validation passed, transitioning to writing for ${context.entityType} "${context.entityId}"`
                logger(msg)
                console.log(msg) // Always log to console
              },
            ],
          },
          {
            target: 'error',
            actions: [
              assign({
                validationErrors: ({ event }) => {
                  const result = event.output as unknown as { isValid: boolean; errors: ValidationError[] }
                  return result.errors || []
                },
                writeStatus: 'error',
                error: ({ event }) => {
                  const result = event.output as unknown as { isValid: boolean; errors: ValidationError[] }
                  return new Error(`Validation failed: ${result.errors.map(e => e.message).join(', ')}`)
                },
              }),
              ({ context, event }) => {
                const result = event.output as unknown as { isValid: boolean; errors: ValidationError[] }
                logger(`[validating] Validation failed for ${context.entityType} "${context.entityId}":`, result.errors)
              },
            ],
          },
        ],
        onError: {
          target: 'error',
          actions: [
            assign({
              error: ({ event }) => event.error instanceof Error ? event.error : new Error(String(event.error)),
              writeStatus: 'error',
            }),
            ({ context, event }) => {
              const errorMsg = `[validating] Validation error for ${context.entityType} "${context.entityId}": ${event.error}`
              logger(errorMsg)
              console.error(errorMsg, event.error) // Always log to console
            },
          ],
        },
      },
      on: {
        reset: 'idle',
      },
    },
    writing: {
      invoke: {
        src: 'writeToDatabase',
        input: ({ context }) => {
          const entityData = context.pendingWrite?.data || context.entityData
          logger(`[writing] Calling writeToDatabase for ${context.entityType} "${context.entityId}"`)
          logger(`[writing] Entity data:`, entityData)
          return {
            entityType: context.entityType,
            entityId: context.entityId,
            entityData,
          }
        },
      },
      on: {
        writeSuccess: {
          target: 'success',
          actions: [
            assign({
              writeStatus: 'success',
              pendingWrite: null,
              entityData: ({ context, event }) => {
                // Update entityData with any returned data from write
                return event.output || context.entityData
              },
            }),
            ({ context }) => {
              logger(`[writing] Write successful for ${context.entityType} "${context.entityId}"`)
            },
          ],
        },
        writeError: {
          target: 'error',
          actions: [
            assign({
              error: ({ event }) => event.error instanceof Error ? event.error : new Error(String(event.error)),
              writeStatus: 'error',
              retryCount: ({ context }) => context.retryCount + 1,
            }),
            ({ context, event }) => {
              logger(`[writing] Write error for ${context.entityType} "${context.entityId}":`, event.error)
            },
          ],
        },
        reset: 'idle',
      },
    },
    success: {
      after: {
        2000: { target: 'idle' }, // Auto-reset after 2s
      },
      on: {
        reset: 'idle',
      },
      entry: assign({
        writeStatus: 'success',
      }),
    },
    error: {
      on: {
        retry: {
          target: 'validating',
          guard: ({ context }) => context.retryCount < 3,
          actions: assign({
            error: null,
          }),
        },
        revert: {
          target: 'idle',
          actions: assign({
            pendingWrite: null,
            writeStatus: 'idle',
            error: null,
          }),
        },
        reset: 'idle',
      },
    },
  },
})

