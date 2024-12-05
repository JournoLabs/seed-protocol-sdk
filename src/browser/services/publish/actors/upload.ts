import { EventObject, fromCallback } from 'xstate'
import { FromCallbackInput, PublishMachineContext } from '@/types'
import { Item } from '@/browser'
import debug from 'debug'
import { getCorrectId } from '@/browser/helpers'

const logger = debug('app:services:publish:actors:upload')

type UploadItem = {
  sourceFilePath: string
  fileSize: number
  filename: string
  seedLocalId?: string
  metadataLocalId?: string
}

export const upload = fromCallback<
  EventObject,
  FromCallbackInput<PublishMachineContext>
>(({ sendBack, input: { context } }) => {
  const { localId } = context

  const _upload = async () => {
    const item = await Item.find({ seedLocalId: localId })

    if (!item) {
      logger('no item with localId', localId)
      return false
    }

    const editedProperties = await item.getEditedProperties()

    for (const propertyData of editedProperties) {
      if (propertyData.refSeedType === 'image') {
        // Check sha256 of local file against sha256 of remote files
        // If different, add this file to uploadItems
      }
    }

    const uploadItems = []

    for (const editedPropertyData of editedProperties) {
      const propertyName = editedPropertyData.propertyName
      const editedProperty = item.properties[propertyName]

      if (!editedProperty || !editedProperty.propertyDef) {
        continue
      }

      if (
        editedProperty.propertyDef.refValueType &&
        editedProperty.propertyDef.refValueType === 'ImageSrc'
      ) {
        const context = editedProperty.getService().getSnapshot().context
        const imageSeedId = context.propertyValue
        const { localId, uid } = getCorrectId(imageSeedId)
      }

      if (
        editedProperty.propertyDef.storageType === 'ItemStorage' &&
        editedProperty.propertyDef.localStorageDir
      ) {
      }
    }

    if (uploadItems.length === 0) {
      return true
    }

    // const turbo = TurboFactory.unauthenticated()

    // turbo.uploadSignedDataItem()
    //
    // const { id, owner, dataCaches, fastFinalityIndexes } = await turbo.uploadFile(() => {
    //   fileStreamFactory => () => fs.createReadStream(filePath),
    //   fileSizeFactory => () => fileSize,
    // });
    return false
  }

  _upload().then((isValid) => {
    if (isValid) {
      sendBack({ type: 'uploadSuccess' })
    }
  })
})
