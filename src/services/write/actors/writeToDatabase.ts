import { EventObject, fromCallback } from 'xstate'
import debug from 'debug'

const logger = debug('seedSdk:write:writeToDatabase')

type WriteToDatabaseInput = {
  entityType: 'model' | 'modelProperty' | 'schema'
  entityId: string
  entityData: any
}

export const writeToDatabase = fromCallback<
  EventObject,
  WriteToDatabaseInput
>(({ sendBack, input }) => {
  const _write = async (): Promise<void> => {
    try {
      const { BaseDb } = await import('@/db/Db/BaseDb')
      const db = BaseDb.getAppDb()
      
      if (!db) {
        throw new Error('Database not available')
      }

      let output: any = input.entityData

      if (input.entityType === 'model') {
        const { writeModelToDb } = await import('@/helpers/db')
        const { BaseDb } = await import('@/db/Db/BaseDb')
        const { models: modelsTable } = await import('@/seedSchema/ModelSchema')
        const { eq } = await import('drizzle-orm')
        const writeMsg = `Writing model to database: ${input.entityData.modelName} (schemaId: ${input.entityData.schemaId})`
        logger(writeMsg)
        console.log(writeMsg) // Always log to console
        logger(`Writing model to database:`, {
          modelFileId: input.entityId,
          modelName: input.entityData.modelName,
          schemaId: input.entityData.schemaId,
        })
        await writeModelToDb(input.entityId, input.entityData)
        
        // Get _dbId from database after write
        const db = BaseDb.getAppDb()
        if (db) {
          const modelRecords = await db
            .select({ id: modelsTable.id })
            .from(modelsTable)
            .where(eq(modelsTable.schemaFileId, input.entityId)) // entityId is now the schemaFileId (string)
            .limit(1)
          
          if (modelRecords.length > 0 && modelRecords[0].id) {
            output = { ...input.entityData, _dbId: modelRecords[0].id } // Store as _dbId (database integer ID)
          } else {
            output = input.entityData
          }
        } else {
          output = input.entityData
        }
        
        const successMsg = `Successfully wrote model "${input.entityData.modelName}" to database`
        logger(successMsg)
        console.log(successMsg) // Always log to console
      } else if (input.entityType === 'modelProperty') {
        const { writePropertyToDb } = await import('@/helpers/db')
        // Use current ModelProperty context when available so a user rename before the
        // initial write completes is not overwritten by the stale requestWrite payload.
        let dataToWrite = input.entityData
        try {
          const mod = await import('@/ModelProperty/ModelProperty')
          const ModelProperty = mod?.ModelProperty ?? (mod as { default?: unknown })?.default
          if (ModelProperty && typeof ModelProperty.getById === 'function') {
            const instance = ModelProperty.getById(input.entityId)
            if (instance && typeof (instance as any)._getSnapshotContext === 'function') {
              const ctx = (instance as any)._getSnapshotContext()
              const nameChanged = ctx.name !== input.entityData.name
              if (nameChanged) {
                fetch('http://127.0.0.1:7242/ingest/0978b378-ebae-46bf-8fd3-134ef2e16cdd',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'writeToDatabase.ts:modelProperty',message:'Using current context for write (name differed)',data:{entityId:input.entityId,requestName:input.entityData.name,currentName:ctx.name},timestamp:Date.now(),sessionId:'debug-session',runId:'post-fix'})}).catch(()=>{});
              }
              dataToWrite = {
                ...input.entityData,
                name: ctx.name ?? input.entityData.name,
                dataType: ctx.dataType ?? input.entityData.dataType,
                refModelId: ctx.refModelId ?? input.entityData.refModelId,
                refValueType: ctx.refValueType ?? input.entityData.refValueType,
                refModelName: ctx.refModelName ?? input.entityData.refModelName,
                storageType: ctx.storageType ?? input.entityData.storageType,
                localStorageDir: ctx.localStorageDir ?? input.entityData.localStorageDir,
                filenameSuffix: ctx.filenameSuffix ?? input.entityData.filenameSuffix,
              }
            }
          }
        } catch (_) {
          // Fall back to input.entityData if instance not available
        }
        await writePropertyToDb(input.entityId, dataToWrite)
        output = input.entityData
      } else if (input.entityType === 'schema') {
        const { addSchemaToDb } = await import('@/helpers/db')
        const schemaRecord = await addSchemaToDb(
          input.entityData,
          input.entityId, // schemaFileId (string)
          input.entityData.schemaData,
          input.entityData.isDraft
        )
        output = { ...input.entityData, _dbId: schemaRecord.id } // Store as _dbId (database integer ID)
      } else {
        throw new Error(`Unknown entity type: ${input.entityType}`)
      }

      // Send success event explicitly - callback actors don't trigger onDone
      sendBack({
        type: 'writeSuccess',
        output,
      })
    } catch (error) {
      logger('Error in writeToDatabase:', error)
      sendBack({
        type: 'writeError',
        error: error instanceof Error ? error : new Error(String(error)),
      })
    }
  }

  _write().catch((error) => {
    logger('Error in writeToDatabase promise:', error)
    sendBack({
      type: 'writeError',
      error: error instanceof Error ? error : new Error(String(error)),
    })
  })

  return () => {
    // Cleanup function (optional)
  }
})

