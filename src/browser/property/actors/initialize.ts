import { EventObject, fromCallback } from 'xstate'
import { propertyMachine } from '../propertyMachine'
import { fs } from '@zenfs/core'

export const initialize = fromCallback<EventObject, typeof propertyMachine>(
  ({ sendBack, input: { context } }) => {
    const { isRelation, propertyName, storageTransactionId, seedLocalId } =
      context

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

      const _getContentsFromFileSystem = async () => {
        if (propertyName === 'html') {
          const htmlFilePath = `/files/html/${storageTransactionId}.html`
          const exists = await fs.promises.exists(htmlFilePath)
          if (!exists) {
            return
          }
          const renderValue = await fs.promises
            .readFile(`/files/html/${storageTransactionId}.html`, 'utf8')
            .catch((error) => {
              console.warn('Error reading html file', error)
            })
          sendBack({ type: 'updateRenderValue', renderValue })
          return
        }
        if (propertyName === 'json') {
          const jsonFilePath = `/files/json/${storageTransactionId}.json`
          const exists = await fs.promises.exists(jsonFilePath)
          if (!exists) {
            return
          }
          const renderValue = await fs.promises
            .readFile(`/files/json/${storageTransactionId}.json`, 'utf8')
            .catch((error) => {
              console.warn('Error reading json file', error)
            })
          sendBack({ type: 'updateRenderValue', renderValue })
          return
        }
      }

      _getContentsFromFileSystem().then(() => {
        sendBack({ type: 'initializeSuccess' })
      })
    }
  },
)
