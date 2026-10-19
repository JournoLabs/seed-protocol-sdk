import { INTERNAL_STORAGE_MODEL_FILE_IDS } from '@/helpers/constants'
import { notifyFileSaved } from '@/helpers/tabEvents'
import { EventObject, fromCallback } from 'xstate'
import { FromCallbackInput } from '@/types/machines'
import {
  ItemPropertyValueType,
  PropertyMachineContext,
  SaveValueToDbEvent,
} from '@/types/property'
import { resolveNewSeedFields } from '@/db/write/createSeed'
import { generateId } from '@/helpers/generateId'
import { writeStorageValue } from './storageValue'
import { beginPropertyWrite, propertyWriteKey } from '@/helpers/propertyWriteTickets'
import { getEasSchemaUidForModel } from '@/db/read/getSchemaUidForModel'
import { toMetadataPropertyName } from '@/helpers'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'

let htmlSchemaUid: string | undefined

export const saveHtml = fromCallback<
  EventObject,
  FromCallbackInput<PropertyMachineContext, SaveValueToDbEvent>
>(({ sendBack, input: { context, event } }) => {
  const {
    localId,
    propertyName: propertyNameRaw,
    propertyRecordSchema,
    modelName,
    seedLocalId,
    seedUid,
    versionLocalId,
    versionUid,
  } = context

  const { schemaUid } = context

  let newValue: ItemPropertyValueType

  if (event) {
    newValue = event.newValue
  }

  // Do NOT skip when existingValue === newValue: the value setter sends updateContext before save,
  // so context.propertyValue is already updated by the time we run. Skipping would prevent the first persist.
  // (Same rationale as analyzeInput.ts)

  // Taken when the save starts: a newer save of the property makes this one drop its value
  const writeKey = propertyWriteKey(seedLocalId ?? seedUid, propertyNameRaw)
  const writeTicket = writeKey ? beginPropertyWrite(writeKey) : undefined

  const _saveHtml = async (): Promise<void> => {
    if (!propertyNameRaw) {
      throw new Error('propertyName is required')
    }
    const propertyName = toMetadataPropertyName(propertyNameRaw, 'Html')

    const htmlContent = typeof newValue === 'string' ? newValue : String(newValue ?? '')

    if (!htmlContent) {
      throw new Error('No HTML content found')
    }

    if (!htmlSchemaUid) {
      const fetchedSchemaUid = await getEasSchemaUidForModel('Html')
      htmlSchemaUid = fetchedSchemaUid ?? undefined
    }

    // Named now so the file can be named after it; the seed row is written when the op applies
    const newHtmlSeedLocalId = generateId()

    const fileName = `${newHtmlSeedLocalId}.html`
    const filePath = BaseFileManager.getFilesPath('html', fileName)

    await BaseFileManager.createDirIfNotExists(BaseFileManager.getFilesPath('html'))

    try {
      await BaseFileManager.saveFile(filePath, htmlContent)
      notifyFileSaved(filePath)
    } catch {
      const fs = await BaseFileManager.getFs()
      fs.writeFileSync(filePath, htmlContent)
      notifyFileSaved(filePath)
    }

    const refResolvedDisplayValue = await BaseFileManager.getContentUrlFromPath(filePath)

    // For HTML, renderValue must be the raw HTML content (for editing/display), not the blob URL.
    // The blob URL (refResolvedDisplayValue) is stored in metadata for iframe display when needed.
    const renderValueForContext = htmlContent

    const written = await writeStorageValue(
      { seedLocalId, seedUid, propertyName },
      {
        storageSeed: {
          localId: newHtmlSeedLocalId,
          type: 'html',
          modelFileId: INTERNAL_STORAGE_MODEL_FILE_IDS.html,
          fields: await resolveNewSeedFields('html'),
        },
        ownedFilePath: filePath,
        create: {
          values: {
            propertyName,
            propertyValue: newHtmlSeedLocalId,
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
        },
        update: {
          newValue: newHtmlSeedLocalId,
          versionLocalId,
          modelName,
          schemaUid,
          refSeedType: 'html',
          refResolvedDisplayValue,
          refResolvedValue: fileName,
          refModelUid: htmlSchemaUid,
          localStorageDir: '/html',
          easDataType: 'bytes32',
          dataType: 'Html',
        },
      },
      writeTicket,
    )
    // A newer value superseded this one; its save sets the context
    if (written.skipped) return

    sendBack({
      type: 'updateContext',
      localId,
      ...written.row,
      propertyValue: newHtmlSeedLocalId,
      refSeedType: 'html',
      refSchemaUid: htmlSchemaUid,
      renderValue: renderValueForContext,
      refResolvedDisplayValue,
      refResolvedValue: fileName,
      localStorageDir: '/html',
      easDataType: 'bytes32',
      schemaUid,
    })
  }

  _saveHtml()
    .finally(() => writeTicket?.end())
    .then(() => {
      sendBack({ type: 'saveHtmlSuccess' })
    })
    .catch((error) => {
      sendBack({ type: 'saveHtmlError', error })
    })
})
