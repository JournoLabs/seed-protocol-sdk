import { EventObject, fromCallback } from 'xstate'
import { BaseDb } from '@/db/Db/BaseDb'
import { addSchemaToDb, writeModelToDb, writePropertyToDb } from '@/helpers/db'
import { models as modelsTable } from '@/seedSchema/ModelSchema'
import { eq } from 'drizzle-orm'
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
      const db = BaseDb.getAppDb()
      
      if (!db) {
        throw new Error('Database not available')
      }

      let output: any = input.entityData

      if (input.entityType === 'model') {
        const writeMsg = `Writing model to database: ${input.entityData.modelName} (schemaId: ${input.entityData.schemaId})`
        logger(writeMsg)
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
      } else if (input.entityType === 'modelProperty') {
        // Use current ModelProperty context when available so a user rename before the
        // initial write completes is not overwritten by the stale requestWrite payload.
        let dataToWrite = input.entityData
        try {
          const mod = await import('../../../ModelProperty/ModelProperty')
          const ModelProperty = mod?.ModelProperty ?? (mod as { default?: unknown })?.default
          if (ModelProperty && typeof ModelProperty.getById === 'function') {
            const instance = ModelProperty.getById(input.entityId)
            if (instance && typeof (instance as any)._getSnapshotContext === 'function') {
              const ctx = (instance as any)._getSnapshotContext()
              const ctxName = ctx.name ?? input.entityData.name
              // #region agent log
              if (ctx.name !== input.entityData.name && typeof fetch === 'function') { fetch('http://127.0.0.1:7242/ingest/0978b378-ebae-46bf-8fd3-134ef2e16cdd',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9ee076'},body:JSON.stringify({sessionId:'9ee076',location:'writeToDatabase.ts:modelProperty',message:'writeToDatabase using ctx name (rename detected)',data:{requestWriteName:input.entityData.name,ctxName:ctx.name,finalName:ctxName},timestamp:Date.now(),hypothesisId:'C'})}).catch(()=>{}); }
              // #endregion
              dataToWrite = {
                ...input.entityData,
                name: ctxName,
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
        // #region agent log
        if (typeof fetch === 'function') { fetch('http://127.0.0.1:7242/ingest/0978b378-ebae-46bf-8fd3-134ef2e16cdd',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9ee076'},body:JSON.stringify({sessionId:'9ee076',location:'writeToDatabase.ts:writePropertyToDbDone',message:'writePropertyToDb completed',data:{entityId:input.entityId,name:dataToWrite.name},timestamp:Date.now(),hypothesisId:'C'})}).catch(()=>{}); }
        // #endregion
        output = input.entityData
      } else if (input.entityType === 'schema') {
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

