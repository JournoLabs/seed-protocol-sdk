import { EventObject, fromCallback } from 'xstate'
import { FromCallbackInput } from '@/types/machines'
import {
  ItemPropertyValueType,
  PropertyMachineContext,
  SaveValueToDbEvent,
} from '@/types/property'
import { createSeed } from '@/db/write/createSeed'
import { createVersion } from '@/db/write/createVersion'
import { createMetadata } from '@/db/write/createMetadata'
import { updateItemPropertyValue } from '@/db/write/updateItemPropertyValue'
import { getEasSchemaUidForModel } from '@/db/read/getSchemaUidForModel'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { eventEmitter } from '@/eventBus'

let htmlSchemaUid: string | undefined

export const saveHtml = fromCallback<
  EventObject,
  FromCallbackInput<PropertyMachineContext, SaveValueToDbEvent>
>(({ sendBack, input: { context, event } }) => {
  const {
    localId,
    propertyName: propertyNameRaw,
    propertyValue: existingValue,
    propertyRecordSchema,
    modelName,
    seedLocalId,
    seedUid,
    versionLocalId,
    versionUid,
  } = context

  let { schemaUid } = context

  let newValue: ItemPropertyValueType

  if (event) {
    newValue = event.newValue
  }

  if (existingValue === newValue) {
    sendBack({ type: 'saveValueToDbSuccess' })
    return
  }

  const _saveHtml = async (): Promise<void> => {
    if (!propertyNameRaw) {
      throw new Error('propertyName is required')
    }
    let propertyName = propertyNameRaw

    if (!propertyNameRaw.endsWith('Id')) {
      propertyName = `${propertyName}Id`
    }

    const htmlContent = typeof newValue === 'string' ? newValue : String(newValue ?? '')

    if (!htmlContent) {
      throw new Error('No HTML content found')
    }

    if (!htmlSchemaUid) {
      const fetchedSchemaUid = await getEasSchemaUidForModel('Html')
      htmlSchemaUid = fetchedSchemaUid ?? undefined
    }

    const newHtmlSeedLocalId = await createSeed({
      type: 'html',
    })

    const fileName = `${newHtmlSeedLocalId}.html`
    const filePath = BaseFileManager.getFilesPath('html', fileName)

    await BaseFileManager.createDirIfNotExists(BaseFileManager.getFilesPath('html'))

    await createVersion({
      seedLocalId: newHtmlSeedLocalId,
      seedType: 'html',
    })

    try {
      await BaseFileManager.saveFile(filePath, htmlContent)
      eventEmitter.emit('file-saved', filePath)
    } catch (e) {
      const fs = await BaseFileManager.getFs()
      fs.writeFileSync(filePath, htmlContent)
      eventEmitter.emit('file-saved', filePath)
    }

    const refResolvedDisplayValue = await BaseFileManager.getContentUrlFromPath(filePath)

    let newLocalId

    if (!localId) {
      const result = await createMetadata(
        {
          propertyName,
          propertyValue: newHtmlSeedLocalId,
          seedLocalId,
          seedUid,
          versionLocalId,
          versionUid,
          modelName,
          schemaUid: htmlSchemaUid,
          refSeedType: 'html',
          refModelUid: htmlSchemaUid,
          refResolvedDisplayValue,
          refResolvedValue: fileName,
          localStorageDir: '/html',
          easDataType: 'bytes32',
        },
        propertyRecordSchema,
      )

      if (result && result.localId) {
        newLocalId = result.localId
      }
    }

    if (localId) {
      await updateItemPropertyValue({
        localId,
        propertyName,
        newValue: newHtmlSeedLocalId,
        seedLocalId,
        versionLocalId,
        modelName,
        schemaUid,
        refSeedType: 'html',
        refResolvedDisplayValue,
        refResolvedValue: fileName,
        refModelUid: htmlSchemaUid,
        localStorageDir: '/html',
        easDataType: 'bytes32',
      } as any)
    }

    sendBack({
      type: 'updateContext',
      localId: newLocalId || localId,
      propertyValue: newHtmlSeedLocalId,
      refSeedType: 'html',
      refSchemaUid: htmlSchemaUid,
      renderValue: refResolvedDisplayValue,
      refResolvedDisplayValue,
      refResolvedValue: fileName,
      localStorageDir: '/html',
      easDataType: 'bytes32',
      schemaUid,
    })
  }

  _saveHtml()
    .then(() => {
      sendBack({ type: 'saveHtmlSuccess' })
    })
    .catch((error) => {
      sendBack({ type: 'saveHtmlError', error })
    })
})
