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
    // Use full context for validation: fill modelName/dataType from _originalValues when missing, then
    // from DB by schemaFileId (context.id) so just-created renames don't fail structure validation.
    let fullContext = {
      ...context,
      modelName: context.modelName ?? (context._originalValues as any)?.modelName,
      dataType: context.dataType ?? (context._originalValues as any)?.dataType,
    }
    const schemaFileId = typeof context.id === 'string' ? context.id : undefined
    if (schemaFileId && (fullContext.modelName === undefined || fullContext.dataType === undefined)) {
      // Brief wait so trackPendingWrite from ModelProperty.create() has time to run (it's in setTimeout(0))
      await new Promise((r) => setTimeout(r, 60))
      try {
        const dbMod = await import('../../../helpers/db')
        const { getPropertyModelNameAndDataType, getModelNameByModelId } = dbMod
        // Try pending write first (property row may not exist yet)
        if (fullContext.modelName === undefined && schemaFileId) {
          const mod = await import('../../../ModelProperty/ModelProperty')
          const ModelProperty = mod?.ModelProperty ?? (mod as { default?: unknown })?.default
          const pendingModelId = ModelProperty?.getPendingModelId?.(schemaFileId)
          if (pendingModelId != null) {
            const modelName = await getModelNameByModelId(pendingModelId)
            if (modelName) {
              fullContext = { ...fullContext, modelName }
            }
          }
        }
        // Then DB property lookup with retry (catches row after initial write)
        let fromDb: { modelName: string; dataType: string } | undefined
        for (let attempt = 0; attempt < 6; attempt++) {
          fromDb = await getPropertyModelNameAndDataType(schemaFileId)
          if (fromDb) break
          if (attempt < 5) await new Promise((r) => setTimeout(r, 40))
        }
        if (fromDb) {
          fullContext = {
            ...fullContext,
            modelName: fullContext.modelName ?? fromDb.modelName,
            dataType: fullContext.dataType ?? fromDb.dataType,
          }
        }
        // If still no modelName, try pending write again (may have been set during retries)
        if (fullContext.modelName === undefined && schemaFileId) {
          const mod = await import('../../../ModelProperty/ModelProperty')
          const ModelProperty = mod?.ModelProperty ?? (mod as { default?: unknown })?.default
          const pendingModelId = ModelProperty?.getPendingModelId?.(schemaFileId)
          if (pendingModelId != null) {
            const modelName = await getModelNameByModelId(pendingModelId)
            if (modelName) {
              fullContext = { ...fullContext, modelName }
            }
          }
        }
      } catch {
        // ignore
      }
    }
    // Last resort for structure validation: TProperty requires dataType; allow name+id to pass if we have schemaFileId
    if (fullContext.dataType === undefined && (fullContext.modelName !== undefined || schemaFileId)) {
      fullContext = { ...fullContext, dataType: (fullContext.dataType ?? (context._originalValues as any)?.dataType) || 'Text' }
    }
    // Use dynamic imports to break circular dependencies
    const validationServiceMod = await import('../../../Schema/service/validation/SchemaValidationService')
    const { SchemaValidationService } = validationServiceMod
    const validationService = new SchemaValidationService()
    const schemaMod = await import('../../../Schema/Schema')
    const { Schema } = schemaMod
    
    // Validate property structure
    const structureResult = validationService.validatePropertyStructure(fullContext)
    
    if (!structureResult.isValid) {
      // #region agent log
      if (typeof fetch === 'function') { fetch('http://127.0.0.1:7242/ingest/0978b378-ebae-46bf-8fd3-134ef2e16cdd',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9ee076'},body:JSON.stringify({sessionId:'9ee076',location:'validateProperty.ts:structureInvalid',message:'validateProperty structure validation FAILED',data:{name:fullContext.name,errors:structureResult.errors?.map((e:any)=>e.message||e.code)},timestamp:Date.now(),hypothesisId:'D'})}).catch(()=>{}); }
      // #endregion
      sendBack({ type: 'validationError', errors: structureResult.errors })
      return
    }

    // If we have schema name and model name, validate against schema
    if (fullContext._schemaName && fullContext.modelName) {
      try {
        const schema = Schema.create(fullContext._schemaName, {
          waitForReady: false,
        }) as import('@/Schema/Schema').Schema
        const schemaSnapshot = schema.getService().getSnapshot()
        const schemaStatus = schemaSnapshot.value
        
        // Only validate against schema if it's loaded (in idle state)
        // If still loading, skip schema validation and only do structure validation
        if (schemaStatus === 'idle') {
          const schemaContext = schemaSnapshot.context
          
          // Check if models are actually loaded
          if (schemaContext.models && Object.keys(schemaContext.models).length > 0) {
            // If property name has changed, validate against the original name (from schema file)
            // This handles the case where a property is renamed - the schema file still has the old name
            const propertyNameToValidate = fullContext._originalValues?.name && fullContext._originalValues.name !== fullContext.name
              ? fullContext._originalValues.name
              : fullContext.name || ''
            
            const schemaResult = validationService.validateProperty(
              schemaContext,
              fullContext.modelName,
              propertyNameToValidate,
              fullContext
            )
            
            if (!schemaResult.isValid) {
              // If property was renamed, some validation errors are expected (like property_not_found, missing_type)
              // Only fail if it's a critical error that's not related to the rename
              const isRenamed = fullContext._originalValues?.name && fullContext._originalValues.name !== fullContext.name
              const criticalErrors = schemaResult.errors.filter(err => {
                // Allow property_not_found and missing_type errors when property is renamed
                if (isRenamed && (err.code === 'property_not_found' || err.code === 'missing_type')) {
                  return false // Not critical
                }
                // For non-renamed properties, only allow property_not_found if we're validating with the same name
                if (err.code === 'property_not_found' && propertyNameToValidate === fullContext.name) {
                  return false // Not critical
                }
                return true // Critical error
              })
              
              if (criticalErrors.length > 0) {
                // #region agent log
                if (typeof fetch === 'function') { fetch('http://127.0.0.1:7242/ingest/0978b378-ebae-46bf-8fd3-134ef2e16cdd',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9ee076'},body:JSON.stringify({sessionId:'9ee076',location:'validateProperty.ts:schemaCriticalErrors',message:'validateProperty schema validation FAILED (critical)',data:{name:fullContext.name,isRenamed:!!(fullContext._originalValues?.name&&fullContext._originalValues.name!==fullContext.name),criticalErrors:criticalErrors?.map((e:any)=>e.message||e.code)},timestamp:Date.now(),hypothesisId:'D'})}).catch(()=>{}); }
                // #endregion
                sendBack({ type: 'validationError', errors: criticalErrors })
                return
              }
              // Continue with validation - rename-related errors are acceptable
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

