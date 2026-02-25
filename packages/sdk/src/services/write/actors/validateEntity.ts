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

// XState v5 type inference bug: fromPromise types are inverted
// We use type assertion to work around this
export const validateEntity = fromPromise<
  ValidateEntityInput,
  ValidateEntityOutput
// @ts-ignore - XState v5 type inference bug: fromPromise incorrectly expects output type to match input type
>(async ({ input }) => {
  // Type assertion to fix XState v5 type inference bug
  // Convert through unknown to avoid type overlap error
  const entityInput = input as unknown as ValidateEntityInput
  
  const _validate = async (): Promise<ValidateEntityOutput> => {
    try {
      const msg = `[validateEntity] Starting validation for ${entityInput.entityType}`
      logger(msg)
      logger(`[validateEntity] Entity data:`, entityInput.entityData)
      let result: ValidateEntityOutput = { isValid: true, errors: [] }

      if (entityInput.entityType === 'model') {
        const structureMsg = `[validateEntity] Validating model structure`
        logger(structureMsg)
        // Use existing Model validation
        const validationServiceMod = await import('../../../Schema/service/validation/SchemaValidationService')
        const { SchemaValidationService } = validationServiceMod
        const validationService = new SchemaValidationService()
        
        // Validate model structure
        const structureResult = validationService.validateModelStructure(entityInput.entityData)
        const structureResultMsg = `[validateEntity] Structure validation result: isValid=${structureResult.isValid}, errors=${structureResult.errors?.length || 0}`
        logger(structureResultMsg)
        
        if (!structureResult.isValid) {
          result = {
            isValid: false,
            errors: structureResult.errors,
          }
        } else {
          // If schema name provided, validate against schema
          if (entityInput.entityData.schemaName) {
            try {
              logger(`[validateEntity] Validating model against schema "${entityInput.entityData.schemaName}"`)
              const schemaMod = await import('../../../Schema/Schema')
              const { Schema } = schemaMod
              const schema = Schema.create(entityInput.entityData.schemaName, {
                waitForReady: false,
              }) as import('../../../Schema/Schema').Schema
              const schemaSnapshot = schema.getService().getSnapshot()
              const schemaStatus = schemaSnapshot.value
              logger(`[validateEntity] Schema status: ${schemaStatus}`)
              
              if (schemaStatus === 'idle') {
                const schemaContext = schemaSnapshot.context
                logger(`[validateEntity] Running validateModelAgainstSchema`)
                const schemaResult = validationService.validateModelAgainstSchema(
                  schemaContext,
                  entityInput.entityData.modelName,
                  entityInput.entityData
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
      } else if (entityInput.entityType === 'modelProperty') {
        // Use existing ModelProperty validation
        const validationServiceMod = await import('../../../Schema/service/validation/SchemaValidationService')
        const { SchemaValidationService } = validationServiceMod
        const validationService = new SchemaValidationService()
        
        // Validate property structure
        const structureResult = validationService.validatePropertyStructure(entityInput.entityData)
        
        if (!structureResult.isValid) {
          result = {
            isValid: false,
            errors: structureResult.errors,
          }
        } else {
          // If schema name and model name provided, validate against schema
          if (entityInput.entityData._schemaName && entityInput.entityData.modelName) {
            try {
              const schemaMod = await import('../../../Schema/Schema')
              const { Schema } = schemaMod
              const schema = Schema.create(entityInput.entityData._schemaName, {
                waitForReady: false,
              }) as import('@/Schema/Schema').Schema
              const schemaSnapshot = schema.getService().getSnapshot()
              const schemaStatus = schemaSnapshot.value
              
              if (schemaStatus === 'idle') {
                const schemaContext = schemaSnapshot.context
                
                if (schemaContext.models && Object.keys(schemaContext.models).length > 0) {
                  const schemaResult = validationService.validateProperty(
                    schemaContext,
                    entityInput.entityData.modelName,
                    entityInput.entityData.name || '',
                    entityInput.entityData
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
      } else if (entityInput.entityType === 'schema') {
        // Schema validation - use existing validation
        const validationServiceMod = await import('../../../Schema/service/validation/SchemaValidationService')
        const { SchemaValidationService } = validationServiceMod
        const validationService = new SchemaValidationService()
        
        const schemaResult = validationService.validateSchema(entityInput.entityData)
        
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
      logger(`[validateEntity] Validation complete:`, result)
      return result
    } catch (error) {
      const errorMsg = `[validateEntity] Error in validateEntity: ${error instanceof Error ? error.message : String(error)}`
      logger(errorMsg)
      logger('Error in validateEntity:', error)
      // Throw error - fromPromise will automatically create error.platform event
      throw error
    }
  }

  return await _validate()
// @ts-ignore - XState v5 type inference bug: fromPromise incorrectly expects output type to match input type
}) as any

