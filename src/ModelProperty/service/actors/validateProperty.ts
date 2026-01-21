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
    console.log('[validateProperty] Starting validation for property:', context.name)
    console.log('[validateProperty] Context:', { 
      name: context.name, 
      modelName: context.modelName, 
      _schemaName: context._schemaName,
      _originalValues: context._originalValues 
    })
    // Use dynamic imports to break circular dependencies
    const { SchemaValidationService } = await import('@/Schema/service/validation/SchemaValidationService')
    const validationService = new SchemaValidationService()
    const { Schema } = await import('@/Schema/Schema')
    
    // Validate property structure
    console.log('[validateProperty] Validating property structure...')
    const structureResult = validationService.validatePropertyStructure(context)
    console.log('[validateProperty] Structure validation result:', structureResult.isValid)
    
    if (!structureResult.isValid) {
      console.log('[validateProperty] Structure validation failed:', structureResult.errors)
      sendBack({ type: 'validationError', errors: structureResult.errors })
      return
    }
    console.log('[validateProperty] Structure validation passed')

    // If we have schema name and model name, validate against schema
    console.log('[validateProperty] Checking schema validation:', { hasSchemaName: !!context._schemaName, hasModelName: !!context.modelName })
    if (context._schemaName && context.modelName) {
      try {
        console.log('[validateProperty] Creating schema instance:', context._schemaName)
        const schema = Schema.create(context._schemaName)
        const schemaSnapshot = schema.getService().getSnapshot()
        const schemaStatus = schemaSnapshot.value
        console.log('[validateProperty] Schema status:', schemaStatus)
        
        // Only validate against schema if it's loaded (in idle state)
        // If still loading, skip schema validation and only do structure validation
        if (schemaStatus === 'idle') {
          const schemaContext = schemaSnapshot.context
          console.log('[validateProperty] Schema context models:', schemaContext.models ? Object.keys(schemaContext.models).length : 'null')
          
          // Check if models are actually loaded
          if (schemaContext.models && Object.keys(schemaContext.models).length > 0) {
            // If property name has changed, validate against the original name (from schema file)
            // This handles the case where a property is renamed - the schema file still has the old name
            const propertyNameToValidate = context._originalValues?.name && context._originalValues.name !== context.name
              ? context._originalValues.name
              : context.name || ''
            
            console.log('[validateProperty] Validating against schema:', { 
              modelName: context.modelName, 
              propertyNameToValidate,
              originalName: context._originalValues?.name,
              currentName: context.name 
            })
            const schemaResult = validationService.validateProperty(
              schemaContext,
              context.modelName,
              propertyNameToValidate,
              context
            )
            console.log('[validateProperty] Schema validation result:', { isValid: schemaResult.isValid, errors: schemaResult.errors.length, errorCodes: schemaResult.errors.map(e => e.code) })
            
            if (!schemaResult.isValid) {
              // If property was renamed, some validation errors are expected (like property_not_found, missing_type)
              // Only fail if it's a critical error that's not related to the rename
              const isRenamed = context._originalValues?.name && context._originalValues.name !== context.name
              const criticalErrors = schemaResult.errors.filter(err => {
                // Allow property_not_found and missing_type errors when property is renamed
                if (isRenamed && (err.code === 'property_not_found' || err.code === 'missing_type')) {
                  return false // Not critical
                }
                // For non-renamed properties, only allow property_not_found if we're validating with the same name
                if (err.code === 'property_not_found' && propertyNameToValidate === context.name) {
                  return false // Not critical
                }
                return true // Critical error
              })
              
              console.log('[validateProperty] Filtered critical errors:', { 
                totalErrors: schemaResult.errors.length, 
                criticalErrors: criticalErrors.length,
                errorCodes: schemaResult.errors.map(e => e.code),
                criticalErrorCodes: criticalErrors.map(e => e.code)
              })
              
              if (criticalErrors.length > 0) {
                console.log('[validateProperty] Sending validationError with critical errors')
                sendBack({ type: 'validationError', errors: criticalErrors })
                return
              }
              console.log('[validateProperty] No critical errors, continuing with validation')
              // Continue with validation - rename-related errors are acceptable
            }
          } else {
            console.log('[validateProperty] Schema models not loaded yet, skipping schema validation')
            logger('Schema models not loaded yet, skipping schema validation')
            // Continue with structure validation only
          }
        } else {
          logger(`Schema is in ${schemaStatus} state, skipping schema validation`)
          // Continue with structure validation only
        }
      } catch (error) {
        console.log('[validateProperty] Error validating property against schema:', error)
        logger('Error validating property against schema:', error)
        // Continue with structure validation only
      }
    } else {
      console.log('[validateProperty] Skipping schema validation (no _schemaName or modelName)')
    }

    // All validations passed
    console.log('[validateProperty] All validations passed, sending validationSuccess')
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

