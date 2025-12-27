import { EventObject, fromCallback } from 'xstate'
import { FromCallbackInput } from '@/types'
import { ModelMachineContext } from '../modelMachine'
// Dynamic imports to break circular dependencies:
// - schema/index -> ... -> validateModel -> SchemaValidationService -> schema/index
// - Model.ts -> ... -> validateModel -> Schema.ts -> Model.ts
// import { SchemaValidationService } from '@/schema/service/validation/SchemaValidationService'
// import { Schema } from '@/schema/Schema'
import debug from 'debug'

const logger = debug('seedSdk:model:actors:validateModel')

export const validateModel = fromCallback<
  EventObject,
  FromCallbackInput<ModelMachineContext>
>(({ sendBack, input: { context } }) => {
  const _validateModel = async (): Promise<void> => {
    // Use dynamic imports to break circular dependencies
    const { SchemaValidationService } = await import('@/schema/service/validation/SchemaValidationService')
    const validationService = new SchemaValidationService()
    const { Schema } = await import('@/schema/Schema')
    
    // Validate model structure
    const structureResult = validationService.validateModelStructure(context)
    
    if (!structureResult.isValid) {
      sendBack({ type: 'validationError', errors: structureResult.errors })
      return
    }

    // If we have schema name, validate against schema
    if (context.schemaName) {
      try {
        const schema = Schema.create(context.schemaName)
        const schemaSnapshot = schema.getService().getSnapshot()
        const schemaStatus = schemaSnapshot.value
        
        // Only validate against schema if it's loaded (in idle state)
        if (schemaStatus === 'idle') {
          const schemaContext = schemaSnapshot.context
          
          // Check if models are actually loaded
          if (schemaContext.models && Object.keys(schemaContext.models).length > 0) {
            const schemaResult = validationService.validateModel(
              schemaContext,
              context.modelName,
              context
            )
            
            if (!schemaResult.isValid) {
              sendBack({ type: 'validationError', errors: schemaResult.errors })
              return
            }
          } else {
            logger('Schema models not loaded yet, skipping schema validation')
            // Continue with structure validation only
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
    sendBack({ type: 'validationSuccess', errors: [] })
  }

  _validateModel().catch((error) => {
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
  })

  return () => {
    // Cleanup function (optional)
  }
})

