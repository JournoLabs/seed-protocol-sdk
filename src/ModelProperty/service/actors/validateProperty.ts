import { EventObject, fromCallback } from 'xstate'
import { FromCallbackInput } from '@/types'
import { ModelPropertyMachineContext } from '../modelPropertyMachine'
// Dynamic imports to break circular dependencies:
// - schema/index -> ... -> validateProperty -> SchemaValidationService -> schema/index
// - schema/Schema -> ... -> validateProperty -> Schema -> schema/Schema
// import { SchemaValidationService } from '@/Schema/service/validation/SchemaValidationService'
// import { Schema } from '@/Schema/Schema'
import debug from 'debug'

const logger = debug('seedSdk:modelProperty:actors:validateProperty')

export const validateProperty = fromCallback<
  EventObject,
  FromCallbackInput<ModelPropertyMachineContext>
>(({ sendBack, input: { context } }) => {
  const _validateProperty = async (): Promise<void> => {
    // Use dynamic imports to break circular dependencies
    const { SchemaValidationService } = await import('@/Schema/service/validation/SchemaValidationService')
    const validationService = new SchemaValidationService()
    const { Schema } = await import('@/Schema/Schema')
    
    // Validate property structure
    const structureResult = validationService.validatePropertyStructure(context)
    
    if (!structureResult.isValid) {
      sendBack({ type: 'validationError', errors: structureResult.errors })
      return
    }

    // If we have schema name and model name, validate against schema
    if (context._schemaName && context.modelName) {
      try {
        const schema = Schema.create(context._schemaName)
        const schemaSnapshot = schema.getService().getSnapshot()
        const schemaStatus = schemaSnapshot.value
        
        // Only validate against schema if it's loaded (in idle state)
        // If still loading, skip schema validation and only do structure validation
        if (schemaStatus === 'idle') {
          const schemaContext = schemaSnapshot.context
          
          // Check if models are actually loaded
          if (schemaContext.models && Object.keys(schemaContext.models).length > 0) {
            const schemaResult = validationService.validateProperty(
              schemaContext,
              context.modelName,
              context.name || '',
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
        logger('Error validating property against schema:', error)
        // Continue with structure validation only
      }
    }

    // All validations passed
    sendBack({ type: 'validationSuccess', errors: [] })
  }

  _validateProperty().catch((error) => {
    logger('Error in validateProperty:', error)
    sendBack({
      type: 'validationError',
      errors: [{
        field: 'property',
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

