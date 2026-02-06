import { EventObject, fromCallback } from 'xstate'
import { FromCallbackInput } from '@/types'
import { ModelMachineContext } from '../modelMachine'
// Dynamic imports to break circular dependencies:
// - schema/index -> ... -> validateModel -> SchemaValidationService -> schema/index
// - Model.ts -> ... -> validateModel -> Schema.ts -> Model.ts
// import { SchemaValidationService } from '@/Schema/service/validation/SchemaValidationService'
// import { Schema } from '@/Schema/Schema'
import debug from 'debug'

const logger = debug('seedSdk:model:actors:validateModel')

// Validation timeout in milliseconds (10 seconds)
const VALIDATION_TIMEOUT_MS = 10000

export const validateModel = fromCallback<
  EventObject,
  FromCallbackInput<ModelMachineContext>
>(({ sendBack, input: { context } }) => {
  let hasResponded = false
  
  // Timeout handler to ensure we always respond
  const timeoutId = setTimeout(() => {
    if (!hasResponded) {
      hasResponded = true
      sendBack({
        type: 'validationError',
        errors: [{
          field: 'model',
          message: `Model validation timed out after ${VALIDATION_TIMEOUT_MS}ms`,
          code: 'validation_timeout',
          severity: 'error' as const,
        }],
      })
    }
  }, VALIDATION_TIMEOUT_MS)

  const _validateModel = async (): Promise<void> => {
    try {
      // Use dynamic imports to break circular dependencies
      const { SchemaValidationService } = await import('@/Schema/service/validation/SchemaValidationService')
      const validationService = new SchemaValidationService()
      const { Schema } = await import('@/Schema/Schema')
      
      // Validate model structure
      const structureResult = validationService.validateModelStructure(context)
      
      if (!structureResult.isValid) {
        if (!hasResponded) {
          hasResponded = true
          clearTimeout(timeoutId)
          sendBack({ type: 'validationError', errors: structureResult.errors })
        }
        return
      }

      // If we have schema name, validate against schema
      // CRITICAL: Use validateModelAgainstSchema which doesn't require the model to be in schema context
      // This allows validation BEFORE registration, preventing update loops
      if (context.schemaName) {
        try {
          const schema = Schema.create(context.schemaName, {
            waitForReady: false,
          }) as import('@/Schema/Schema').Schema
          const schemaSnapshot = schema.getService().getSnapshot()
          const schemaStatus = schemaSnapshot.value
          
          // Only validate against schema if it's loaded (in idle state)
          if (schemaStatus === 'idle') {
            const schemaContext = schemaSnapshot.context
            
            // Use validateModelAgainstSchema which validates the model data directly
            // without requiring it to be in schema.models. This prevents loops because:
            // 1. Model validates against schema (model NOT in schema context yet)
            // 2. If valid, model gets registered with schema
            // 3. No need for manual updates because model is already correct (liveQuery handles updates)
            const schemaResult = validationService.validateModelAgainstSchema(
              schemaContext,
              context.modelName,
              context
            )
            
            if (!schemaResult.isValid) {
              if (!hasResponded) {
                hasResponded = true
                clearTimeout(timeoutId)
                sendBack({ type: 'validationError', errors: schemaResult.errors })
              }
              return
            }
          } else {
            logger(`Schema is in ${schemaStatus} state, skipping schema validation`)
            // Continue with structure validation only
          }
        } catch (error) {
          logger('Error validating model against schema:', error)
          // Continue with structure validation only
        }
      }

      // All validations passed
      if (!hasResponded) {
        hasResponded = true
        clearTimeout(timeoutId)
        sendBack({ type: 'validationSuccess', errors: [] })
      }
    } catch (error) {
      if (!hasResponded) {
        hasResponded = true
        clearTimeout(timeoutId)
        logger('Error in validateModel:', error)
        sendBack({
          type: 'validationError',
          errors: [{
            field: 'model',
            message: error instanceof Error ? error.message : 'Unknown validation error',
            code: 'validation_exception',
            severity: 'error' as const,
          }],
        })
      }
    }
  }

  _validateModel().catch((error) => {
    if (!hasResponded) {
      hasResponded = true
      clearTimeout(timeoutId)
      logger('Error in validateModel:', error)
      sendBack({
        type: 'validationError',
        errors: [{
          field: 'model',
          message: error instanceof Error ? error.message : 'Unknown validation error',
          code: 'validation_exception',
          severity: 'error' as const,
        }],
      })
    }
  })

  return () => {
    // Cleanup function - clear timeout if actor is stopped
    clearTimeout(timeoutId)
  }
})

