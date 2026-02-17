import { EventObject, fromCallback } from 'xstate'
import { FromCallbackInput } from '@/types/machines'
import { PropertyMachineContext } from '@/types/property'
import { getEasSchemaUidForSchemaDefinition } from '@/stores/eas'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { INTERNAL_PROPERTY_NAMES } from '@/helpers/constants'


export const initialize = fromCallback<
  EventObject,
  FromCallbackInput<PropertyMachineContext, EventObject>
>(({ sendBack, input: { context } }) => {
  const { 
    isRelation, 
    propertyName, 
    storageTransactionId,
    propertyRecordSchema, 
  } = context
  let { schemaUid } = context

  const _initialize = async () => {
    if (
      !schemaUid && 
      propertyName &&
      !INTERNAL_PROPERTY_NAMES.includes(propertyName) &&
      (
        !propertyRecordSchema ||
        !propertyRecordSchema.storageType ||
        propertyRecordSchema.storageType !== 'ItemStorage'
      )
    ) {
      try {
        schemaUid = await getEasSchemaUidForSchemaDefinition({ schemaText: propertyName })
        if (schemaUid) {
          sendBack({ type: 'updateContext', schemaUid })
        }
      } catch (error) {
        // If schema fetch fails, continue without schemaUid - it's not required for local metadata
        // Log error in development but don't throw
        if (process.env.NODE_ENV === 'development') {
          console.warn(`Failed to fetch schemaUid for property ${propertyName}:`, error)
        }
      }
    }
  
    if (isRelation) {
      sendBack({ type: 'isRelatedProperty' })
      sendBack({ type: 'initializeSuccess' })
      return
    }
  
    if (!isRelation) {
      if (
        (propertyName !== 'html' && propertyName !== 'json') ||
        !storageTransactionId
      ) {
        sendBack({ type: 'initializeSuccess' })
        return
      }
  
        if (propertyName === 'html') {
          const htmlFilePath = BaseFileManager.getFilesPath('html', `${storageTransactionId}.html`)
          const exists = await BaseFileManager.pathExists(htmlFilePath)
          if (!exists) {
            return
          }
          const renderValue = await BaseFileManager.readFileAsString(htmlFilePath)
            .catch((error) => {
              console.warn('Error reading html file', error)
            })
          sendBack({ type: 'updateContext', renderValue })
          return
        }
        if (propertyName === 'json') {
          const jsonFilePath = BaseFileManager.getFilesPath('json', `${storageTransactionId}.json`)
          const exists = await BaseFileManager.pathExists(jsonFilePath)
          if (!exists) {
            return
          }
          const renderValue = await BaseFileManager.readFileAsString(jsonFilePath)
            .catch((error) => {
              console.warn('Error reading json file', error)
            })
          sendBack({ type: 'updateContext', renderValue })
          return
        }
  
    }
  }

  _initialize().then(() => {
    sendBack({ type: 'initializeSuccess' })
  })
})
