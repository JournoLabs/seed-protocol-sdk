import { fromPromise } from 'xstate'
import { ValidationError } from '@/Schema/validation'
import debug from 'debug'

const logger = debug('seedSdk:write:validateEntity')

export type ValidateEntityInput = {
  entityType: 'model' | 'modelProperty' | 'schema'
  entityData: any
}

type ValidateEntityOutput = {
  isValid: boolean
  errors: ValidationError[]
}

export const validateEntity = fromPromise<
  ValidateEntityInput,
  ValidateEntityOutput
>(async ({ input }) => {
  const _validate = async (): Promise<ValidateEntityOutput> => {
    try {
      const msg = `[validateEntity] Starting validation for ${input.entityType}`
      logger(msg)
      console.log(msg) // Always log to console
      logger(`[validateEntity] Entity data:`, input.entityData)
      let result: ValidateEntityOutput = { isValid: true, errors: [] }

      if (input.entityType === 'model') {
        const structureMsg = `[validateEntity] Validating model structure`
        logger(structureMsg)
        console.log(structureMsg) // Always log to console
        // Use existing Model validation
        const { SchemaValidationService } = await import('@/Schema/service/validation/SchemaValidationService')
        const validationService = new SchemaValidationService()
        
        // Validate model structure
        const structureResult = validationService.validateModelStructure(input.entityData)
        const structureResultMsg = `[validateEntity] Structure validation result: isValid=${structureResult.isValid}, errors=${structureResult.errors?.length || 0}`
        logger(structureResultMsg)
        console.log(structureResultMsg) // Always log to console
        
        if (!structureResult.isValid) {
          result = {
            isValid: false,
            errors: structureResult.errors,
          }
        } else {
          // If schema name provided, validate against schema
          if (input.entityData.schemaName) {
            try {
              logger(`[validateEntity] Validating model against schema "${input.entityData.schemaName}"`)
              const { Schema } = await import('@/Schema/Schema')
              const schema = Schema.create(input.entityData.schemaName)
              const schemaSnapshot = schema.getService().getSnapshot()
              const schemaStatus = schemaSnapshot.value
              logger(`[validateEntity] Schema status: ${schemaStatus}`)
              
              if (schemaStatus === 'idle') {
                const schemaContext = schemaSnapshot.context
                logger(`[validateEntity] Running validateModelAgainstSchema`)
                const schemaResult = validationService.validateModelAgainstSchema(
                  schemaContext,
                  input.entityData.modelName,
                  input.entityData
                )
                logger(`[validateEntity] Schema validation result:`, schemaResult)
                
                if (!schemaResult.isValid) {
                  result = {
                    isValid: false,
                    errors: schemaResult.errors,
                  }
                }
              } else {
                logger(`[validateEntity] Schema not in idle state (${schemaStatus}), skipping schema validation`)
              }
            } catch (error) {
              logger('Error validating model against schema:', error)
              // Continue with structure validation only
            }
          } else {
            logger(`[validateEntity] No schemaName provided, skipping schema validation`)
          }
        }
      } else if (input.entityType === 'modelProperty') {
        // Use existing ModelProperty validation
        const { SchemaValidationService } = await import('@/Schema/service/validation/SchemaValidationService')
        const validationService = new SchemaValidationService()
        
        // Validate property structure
        const structureResult = validationService.validatePropertyStructure(input.entityData)
        
        if (!structureResult.isValid) {
          result = {
            isValid: false,
            errors: structureResult.errors,
          }
        } else {
          // If schema name and model name provided, validate against schema
          if (input.entityData._schemaName && input.entityData.modelName) {
            try {
              const { Schema } = await import('@/Schema/Schema')
              const schema = Schema.create(input.entityData._schemaName)
              const schemaSnapshot = schema.getService().getSnapshot()
              const schemaStatus = schemaSnapshot.value
              
              if (schemaStatus === 'idle') {
                const schemaContext = schemaSnapshot.context
                
                if (schemaContext.models && Object.keys(schemaContext.models).length > 0) {
                  const schemaResult = validationService.validateProperty(
                    schemaContext,
                    input.entityData.modelName,
                    input.entityData.name || '',
                    input.entityData
                  )
                  
                  if (!schemaResult.isValid) {
                    result = {
                      isValid: false,
                      errors: schemaResult.errors,
                    }
                  }
                }
              }
            } catch (error) {
              logger('Error validating property against schema:', error)
              // Continue with structure validation only
            }
          }
        }
      } else if (input.entityType === 'schema') {
        // Schema validation - use existing validation
        const { SchemaValidationService } = await import('@/Schema/service/validation/SchemaValidationService')
        const validationService = new SchemaValidationService()
        
        const schemaResult = validationService.validateSchema(input.entityData)
        
        if (!schemaResult.isValid) {
          result = {
            isValid: false,
            errors: schemaResult.errors,
          }
        }
      }

      // Return the result - fromPromise will automatically put this in event.output
      const completeMsg = `[validateEntity] Validation complete: isValid=${result.isValid}, errors=${result.errors?.length || 0}`
      logger(completeMsg)
      console.log(completeMsg) // Always log to console
      logger(`[validateEntity] Validation complete:`, result)
      console.log(`[validateEntity] Returning result:`, result)
      return result
    } catch (error) {
      const errorMsg = `[validateEntity] Error in validateEntity: ${error instanceof Error ? error.message : String(error)}`
      logger(errorMsg)
      console.error(errorMsg, error) // Always log to console
      logger('Error in validateEntity:', error)
      // Throw error - fromPromise will automatically create error.platform event
      throw error
    }
  }

  return await _validate()
})

