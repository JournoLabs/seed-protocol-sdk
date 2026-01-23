import { EventObject, fromCallback } from 'xstate'
import { FromCallbackInput } from '@/types'
import { ModelPropertyMachineContext } from '../modelPropertyMachine'
// Dynamic import to break circular dependency: helpers/db -> ModelProperty -> compareAndMarkDraft -> helpers/db
// import { savePropertyToDb } from '@/helpers/db'
import debug from 'debug'

const logger = debug('seedSdk:modelProperty:actors:compareAndMarkDraft')

export const compareAndMarkDraft = fromCallback<
  EventObject,
  FromCallbackInput<ModelPropertyMachineContext>
>(({ sendBack, input: { context } }) => {
  const _compareAndMarkDraft = async (): Promise<void> => {
    // If _originalValues is not set, we still need to save to database if the property exists
    // This handles the case where the name is changed before _originalValues is initialized
    if (!context._originalValues) {
      logger('No original values to compare against')
      logger(`[compareAndMarkDraft] Context: modelName=${context.modelName}, name=${context.name}, id=${context.id}, _propertyFileId=${context._propertyFileId}`)
      
      // If we have a name and modelName, try to save to database anyway
      // This ensures name changes are persisted even if _originalValues isn't initialized yet
      // We need either schemaFileId (id or _propertyFileId) to find the property in the database
      const schemaFileId = context._propertyFileId || (typeof context.id === 'string' ? context.id : undefined)
      if (context.modelName && context.name && schemaFileId) {
        logger(`[compareAndMarkDraft] _originalValues not set, but saving to database anyway for property ${context.modelName}:${context.name} (schemaFileId: ${schemaFileId})`)
        try {
          const { savePropertyToDb } = await import('@/helpers/db')
          // Ensure _propertyFileId is set for savePropertyToDb to find the property
          const contextWithFileId = {
            ...context,
            _propertyFileId: schemaFileId,
          }
          await savePropertyToDb(contextWithFileId)
          logger(`[compareAndMarkDraft] Successfully saved property ${context.modelName}:${context.name} to database (no _originalValues)`)
        } catch (error) {
          logger(`[compareAndMarkDraft] Error saving property to database (no _originalValues): ${error}`)
          // Don't throw - this is a best-effort save, but log the error for debugging
          console.error(`[compareAndMarkDraft] Failed to save property ${context.modelName}:${context.name}:`, error)
        }
      } else {
        logger(`[compareAndMarkDraft] Cannot save property ${context.modelName}:${context.name} - missing required fields (schemaFileId: ${schemaFileId})`)
      }
      return
    }

    logger(`[compareAndMarkDraft] Comparing: context.name=${context.name}, _originalValues.name=${context._originalValues?.name}`)
    
    // Compare current values with original
    // Only compare property fields, not internal fields
    const propertyFields = ['name', 'dataType', 'ref', 'refModelName', 'refModelId', 'refValueType', 'storageType', 'localStorageDir', 'filenameSuffix', 'modelName', 'modelId']
    const hasChanges = propertyFields.some(key => {
      const currentValue = (context as any)[key]
      const originalValue = (context._originalValues as any)?.[key]
      
      // Handle name changes specifically
      if (key === 'name') {
        const nameChanged = currentValue !== originalValue
        if (nameChanged) {
          logger(`[compareAndMarkDraft] Name change detected: "${originalValue}" -> "${currentValue}"`)
        }
        return nameChanged
      }
      
      // Handle ref fields - compare by name
      if (key === 'ref' || key === 'refModelName') {
        const currentRef = context.refModelName || context.ref
        const originalRef = context._originalValues?.refModelName || context._originalValues?.ref
        // Both undefined/null means no ref, so they're the same
        if (!currentRef && !originalRef) return false
        return currentRef !== originalRef
      }
      
      // For other fields, compare values (handling undefined/null)
      if (currentValue === undefined && originalValue === undefined) return false
      if (currentValue === null && originalValue === null) return false
      if (currentValue === undefined && originalValue === null) return false
      if (currentValue === null && originalValue === undefined) return false
      
      return currentValue !== originalValue
    })

    if (hasChanges) {
      logger(`Property ${context.modelName}:${context.name} has changes, marking as edited`)
      logger(`[compareAndMarkDraft] Context when saving: id=${context.id}, _propertyFileId=${context._propertyFileId}, name=${context.name}, _originalValues.name=${context._originalValues?.name}`)

      // Use dynamic import to break circular dependency
      const { savePropertyToDb } = await import('@/helpers/db')
      
      // Save to database (but not JSON file) - always save to DB when there are changes
      try {
        await savePropertyToDb(context)
        logger(`[compareAndMarkDraft] Successfully saved property ${context.modelName}:${context.name} to database`)
      } catch (error) {
        logger(`[compareAndMarkDraft] Error saving property to database: ${error}`)
        throw error
      }

      // Mark schema as draft if schema name is available
      if (context._schemaName) {
        // Get the Schema instance and mark it as draft
        const { Schema } = await import('@/Schema/Schema')
        const schema = Schema.create(context._schemaName)

        // Send event to Schema machine to mark as draft
        schema.getService().send({
          type: 'markAsDraft',
          propertyKey: `${context.modelName}:${context.name}`,
        })
      }
    } else {
      // No changes - clear edited flag in database and context
      logger(`Property ${context.modelName}:${context.name} has no changes`)
      
      // Clear isEdited flag in database
      try {
        const { BaseDb } = await import('@/db/Db/BaseDb')
        const { properties: propertiesTable, models: modelsTable } = await import('@/seedSchema')
        const { eq, and } = await import('drizzle-orm')
        
        const db = BaseDb.getAppDb()
        if (db && context.modelName && context.name) {
          // Find model by name
          const modelRecords = await db
            .select({ id: modelsTable.id })
            .from(modelsTable)
            .where(eq(modelsTable.name, context.modelName))
            .limit(1)
          
          if (modelRecords.length > 0) {
            // Find property by name and modelId
            const propertyRecords = await db
              .select({ id: propertiesTable.id })
              .from(propertiesTable)
              .where(
                and(
                  eq(propertiesTable.name, context.name),
                  eq(propertiesTable.modelId, modelRecords[0].id)
                )
              )
              .limit(1)
            
            if (propertyRecords.length > 0) {
              // Clear isEdited flag in database
              await db
                .update(propertiesTable)
                .set({ isEdited: false })
                .where(eq(propertiesTable.id, propertyRecords[0].id!))
              logger(`Cleared isEdited flag in database for property ${context.modelName}:${context.name}`)
            }
          }
        }
      } catch (error) {
        logger(`Error clearing isEdited flag in database: ${error}`)
      }
      
      sendBack({
        type: 'clearEdited',
      })
    }
  }

  _compareAndMarkDraft().then(() => {
    sendBack({ type: 'compareAndMarkDraftSuccess' })
  }).catch((error) => {
    logger('Error comparing and marking draft:', error)
    sendBack({ type: 'compareAndMarkDraftError', error })
  })

  return () => {
    // Cleanup function (optional)
  }
})
