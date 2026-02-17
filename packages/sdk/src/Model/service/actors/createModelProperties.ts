import { EventObject, fromCallback } from 'xstate'
import { FromCallbackInput } from '@/types'
import { ModelMachineContext } from '../modelMachine'
import { BaseDb } from '@/db/Db/BaseDb'
import { models as modelsTable, properties as propertiesTable } from '@/seedSchema/ModelSchema'
import debug from 'debug'

const logger = debug('seedSdk:model:actors:createModelProperties')

export const createModelProperties = fromCallback<
  EventObject,
  FromCallbackInput<ModelMachineContext> & { propertyDefinitions: { [name: string]: any } }
>(({ sendBack, input }) => {
  const _createProperties = async (): Promise<void> => {
    const { context, propertyDefinitions } = input
    const { id, _dbId, modelName } = context

    
    if (!id || !_dbId || !modelName) {
      throw new Error('Model ID, file ID, and name are required to create properties')
    }
    
    if (!propertyDefinitions || Object.keys(propertyDefinitions).length === 0) {
      logger('No property definitions provided, skipping property creation')
      sendBack({ type: 'createModelPropertiesSuccess' })
      return
    }
    
    logger(`Creating ${Object.keys(propertyDefinitions).length} properties for model "${modelName}" (id: ${_dbId})`)
    
    const mod = await import('../../../ModelProperty/ModelProperty')
    const ModelProperty = mod?.ModelProperty ?? (mod as { default?: unknown })?.default
    if (!ModelProperty) {
      logger('ModelProperty not available from dynamic import')
      sendBack({ type: 'createModelPropertiesError', error: new Error('ModelProperty not available') })
      return
    }
    const drizzleMod = await import('drizzle-orm')
    const { eq } = drizzleMod
    const db = BaseDb.getAppDb()
    
        for (const [propName, propData] of Object.entries(propertyDefinitions)) {
          // Use provided ID or generate a random one
          // IDs should be generated in the import process before creating properties
          const helpersMod = await import('../../../helpers')
          const { generateId } = helpersMod
          const propertyFileId = propData.id || generateId()
          
          logger(`Creating property "${propName}" with fileId "${propertyFileId}"`)
      
      // Query database to get refModelId if the property has ref/refModelName
      // The property should already be in DB from addModelsToDb
      let refModelId: number | undefined = propData.refModelId
      if (!refModelId && (propData.ref || propData.refModelName) && db) {
        try {
          const refModelName = propData.refModelName || propData.ref
          // First try to get refModelId from the property record in the database
          const propertyRecords = await db
            .select()
            .from(propertiesTable)
            .where(eq(propertiesTable.schemaFileId, propertyFileId))
            .limit(1)
          
          if (propertyRecords.length > 0 && propertyRecords[0].refModelId) {
            refModelId = propertyRecords[0].refModelId
            logger(`Found refModelId ${refModelId} from database for property "${propName}"`)
          } else if (refModelName) {
            // Fallback: query models table directly by name
            const refModelRecords = await db
              .select()
              .from(modelsTable)
              .where(eq(modelsTable.name, refModelName))
              .limit(1)
            
            if (refModelRecords.length > 0 && refModelRecords[0].id) {
              refModelId = refModelRecords[0].id
              logger(`Resolved refModelId ${refModelId} from model name "${refModelName}" for property "${propName}"`)
            }
          }
        } catch (error) {
          logger(`Error fetching refModelId for property "${propName}":`, error)
          // Continue without refModelId - it will be resolved later in _initializeOriginalValues
        }
      }
      
      // Create ModelProperty instance
      // This will load from DB if it exists, or create new instance
      // The property should already be in DB from writeModelToDb
      // Note: propertyFileId is the schemaFileId (string), not the database ID (number)
      // We pass it as _propertyFileId so getById() can find the instance
      await ModelProperty.create({
        name: propName,
        modelName,
        modelId: _dbId,
        dataType: propData.dataType,
        ref: propData.ref,
        refModelName: propData.refModelName,
        refModelId,
        refValueType: propData.refValueType,
        storageType: propData.storageType,
        localStorageDir: propData.localStorageDir,
        filenameSuffix: propData.filenameSuffix,
        _propertyFileId: propertyFileId, // Store schemaFileId for getById() lookups
      } as any) // Use 'as any' because _propertyFileId is not in TProperty type
    }
    
    logger(`Successfully created all properties for model "${modelName}"`)
    sendBack({ type: 'createModelPropertiesSuccess' })
  }
  
  _createProperties().catch((error) => {
    logger(`Error creating model properties: ${error}`)
    sendBack({ 
      type: 'createModelPropertiesError', 
      error: error instanceof Error ? error : new Error(String(error))
    })
  })
  
  return () => {
    // Cleanup function (optional)
  }
})

