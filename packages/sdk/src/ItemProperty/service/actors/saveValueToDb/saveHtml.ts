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
import { toMetadataPropertyName } from '@/helpers'
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

  // Do NOT skip when existingValue === newValue: the value setter sends updateContext before save,
  // so context.propertyValue is already updated by the time we run. Skipping would prevent the first persist.
  // (Same rationale as analyzeInput.ts)

  const _saveHtml = async (): Promise<void> => {
    if (!propertyNameRaw) {
      throw new Error('propertyName is required')
    }
    const propertyName = toMetadataPropertyName(propertyNameRaw, 'Html')

    const htmlContent = typeof newValue === 'string' ? newValue : String(newValue ?? '')

    if (!htmlContent) {
      throw new Error('No HTML content found')
    }

    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/2810478a-7cf0-49a8-bc23-760b81417972',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'413b74'},body:JSON.stringify({sessionId:'413b74',location:'saveHtml.ts:entry',message:'Html save started',data:{propertyName,htmlContentLength:htmlContent.length,existingValue:typeof existingValue,newValueType:typeof newValue},timestamp:Date.now(),hypothesisId:'save'})}).catch(()=>{});
    // #endregion

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

    // For HTML, renderValue must be the raw HTML content (for editing/display), not the blob URL.
    // The blob URL (refResolvedDisplayValue) is stored in metadata for iframe display when needed.
    const renderValueForContext = htmlContent

    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/2810478a-7cf0-49a8-bc23-760b81417972',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'413b74'},body:JSON.stringify({sessionId:'413b74',location:'saveHtml.ts:beforeDb',message:'Html save before DB write',data:{newHtmlSeedLocalId,fileName,refResolvedValue:fileName,localStorageDir:'/html',renderValueLength:renderValueForContext.length,filePath},timestamp:Date.now(),hypothesisId:'save'})}).catch(()=>{});
    // #endregion

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
        dataType: 'Html',
      } as any)
    }

    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/2810478a-7cf0-49a8-bc23-760b81417972',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'413b74'},body:JSON.stringify({sessionId:'413b74',location:'saveHtml.ts:sendBack',message:'Html save sendBack updateContext',data:{propertyValue:newHtmlSeedLocalId,refResolvedValue:fileName,localStorageDir:'/html',renderValueLength:renderValueForContext.length},timestamp:Date.now(),hypothesisId:'save'})}).catch(()=>{});
    // #endregion

    sendBack({
      type: 'updateContext',
      localId: newLocalId || localId,
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
    .then(() => {
      sendBack({ type: 'saveHtmlSuccess' })
    })
    .catch((error) => {
      sendBack({ type: 'saveHtmlError', error })
    })
})
