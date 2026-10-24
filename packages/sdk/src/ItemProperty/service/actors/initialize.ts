import { EventObject, fromCallback } from 'xstate'
import { FromCallbackInput } from '@/types/machines'
import { PropertyMachineContext } from '@/types/property'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { INTERNAL_PROPERTY_NAMES } from '@/helpers/constants'
import { lookupPropertySchemaUid } from '@/helpers/propertySchemaUid'


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
      // Undefined when the lookup fails: local metadata doesn't need it.
      schemaUid = await lookupPropertySchemaUid(propertyName, propertyRecordSchema)
      if (schemaUid) {
        sendBack({ type: 'updateContext', schemaUid })
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
