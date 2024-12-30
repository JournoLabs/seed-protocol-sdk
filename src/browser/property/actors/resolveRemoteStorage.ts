import { EventObject, fromCallback } from 'xstate'
import { FromCallbackInput } from '@/types/machines'
import { PropertyMachineContext } from '@/types/property'

export const resolveRemoteStorage = fromCallback<
  EventObject,
  FromCallbackInput<PropertyMachineContext, EventObject>
>(({ sendBack, input: { context } }) => {
  const { propertyInstances } = context

  if (!propertyInstances) {
    throw new Error(`propertyInstances not found for ${context.seedLocalId}`)
  }

  if (!propertyInstances.has('storageTransactionId')) {
    return
  }

  const storageTransactionId = propertyInstances.get('storageTransactionId')

  const _resolveRemoteStorage = async (): Promise<void> => {
    const path = await import('path-browserify')
    const { fs } = await import('@zenfs/core')

    const filesDirExists = await fs.promises.exists('/files')

    if (!filesDirExists) {
      await fs.promises.mkdir('/files')
    }

    const htmlDir = path.join('/files', 'html')

    const htmlExists = await fs.promises.exists(htmlDir)

    if (htmlExists) {
      const htmlFiles = await fs.promises.readdir(htmlDir)
      const matchingHtmlFile = htmlFiles.find(
        (file) => file === `${storageTransactionId}.html`,
      )
      if (matchingHtmlFile) {
        const htmlString = await fs.promises.readFile(
          path.join(htmlDir, matchingHtmlFile),
          'utf8',
        )
        sendBack({
          type: 'updateValue',
          propertyName: 'html',
          propertyValue: htmlString,
        })
      }
    }

    if (!htmlExists) {
      await fs.promises.mkdir(htmlDir)
    }

    const jsonDir = path.join('/files', 'json')

    const jsonExists = await fs.promises.exists(jsonDir)

    if (jsonExists) {
      const jsonFiles = await fs.promises.readdir(jsonDir)
      const matchingJsonFile = jsonFiles.find(
        (file) => file === `${storageTransactionId}.json`,
      )
      if (matchingJsonFile) {
        const jsonString = await fs.promises.readFile(
          path.join(jsonDir, matchingJsonFile),
          'utf8',
        )
        sendBack({
          type: 'updateValue',
          propertyName: 'json',
          propertyValue: jsonString,
        })
      }
    }

    if (!jsonExists) {
      await fs.promises.mkdir(jsonDir)
    }
  }

  _resolveRemoteStorage().then(() => {
    sendBack({ type: 'resolveRemoteStorageSuccess' })
    return
  })
})
