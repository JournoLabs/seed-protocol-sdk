import { EventObject, fromCallback } from 'xstate'
import { FromCallbackInput } from '@/types/machines'
import {
  ItemPropertyValueType,
  PropertyMachineContext,
  SaveValueToDbEvent,
} from '@/types/property'
import { createSeed } from '@/db/write/createSeed'
import { getDataTypeFromString, toMetadataPropertyName } from '@/helpers'
import { createVersion } from '@/db/write/createVersion'
import { createMetadata } from '@/db/write/createMetadata'
import { updateItemPropertyValue } from '@/db/write/updateItemPropertyValue'
import { getEasSchemaUidForModel } from '@/db/read/getSchemaUidForModel'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { eventEmitter } from '@/eventBus'

const readFileAsArrayBuffer = async (file: File): Promise<ArrayBuffer> => {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = async (e) => {
      if (!e.target || !e.target.result) {
        throw new Error('FileReader result is null')
      }
      resolve(e.target.result as ArrayBuffer)
    }
    reader.readAsArrayBuffer(file)
  })
}

let fileSchemaUid: string | undefined

export const saveFile = fromCallback<
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
  // so context is already updated. Skipping would prevent persisting existing file references (string filename).

  const _saveFile = async (): Promise<void> => {
    if (!propertyNameRaw) {
      throw new Error('propertyName is required')
    }
    const propertyName = toMetadataPropertyName(propertyNameRaw, 'File')

    // Wait for file system to be initialized (client may still be loading)
    const fsTimeoutMs = 10000
    const fsPollMs = 100
    const fsStart = Date.now()
    while (Date.now() - fsStart < fsTimeoutMs) {
      try {
        BaseFileManager.getWorkingDir()
        break
      } catch {
        await new Promise((r) => setTimeout(r, fsPollMs))
      }
    }
    try {
      BaseFileManager.getWorkingDir()
    } catch (e) {
      throw new Error(
        `File system not initialized. Ensure the client has finished loading before saving files. (${(e as Error)?.message})`,
      )
    }

    let fileData: string | ArrayBuffer | undefined
    let fileName: string | undefined

    if (!fileSchemaUid) {
      const fetchedSchemaUid = await getEasSchemaUidForModel('File')
      fileSchemaUid = fetchedSchemaUid ?? undefined
    }

    if (typeof newValue === 'string') {
      const newValueType = getDataTypeFromString(newValue)
      if (newValueType === 'base64') {
        const base64Data = (newValue as string).split(',')[1] || newValue
        const binaryString = atob(base64Data)
        const binaryArray = new Uint8Array(binaryString.length)
        for (let i = 0; i < binaryString.length; i++) {
          binaryArray[i] = binaryString.charCodeAt(i)
        }
        fileData = binaryArray.buffer
      } else if (newValueType === 'url') {
        const response = await fetch(newValue as string)
        fileData = await response.arrayBuffer()
        const urlPath = new URL(newValue as string)
        fileName = urlPath.pathname.split('/').pop()
      } else {
        fileData = newValue
      }
    }

    if (newValue instanceof File) {
      fileName = newValue.name
      fileData = await readFileAsArrayBuffer(newValue)
    }

    // Handle existing file reference: filename from listFiles() that exists in files folder
    let isExistingFileReference = false
    if (
      typeof newValue === 'string' &&
      getDataTypeFromString(newValue) === null
    ) {
      const existingFilePath = BaseFileManager.getFilesPath('files', newValue)
      const pathExistsResult = await BaseFileManager.pathExists(existingFilePath)
      if (pathExistsResult) {
        isExistingFileReference = true
        fileName = newValue
        fileData = undefined
      }
    }

    if (!fileData && !isExistingFileReference) {
      throw new Error('No file data found')
    }

    const newFileSeedLocalId = await createSeed({
      type: 'file',
    })

    if (!fileName) {
      fileName = newFileSeedLocalId
    }

    const filePath = BaseFileManager.getFilesPath('files', fileName)

    await BaseFileManager.createDirIfNotExists(BaseFileManager.getFilesPath('files'))

    await createVersion({
      seedLocalId: newFileSeedLocalId,
      seedType: 'file',
    })

    if (!isExistingFileReference) {
      if (fileData instanceof ArrayBuffer) {
        try {
          await BaseFileManager.saveFile(filePath, fileData)
          eventEmitter.emit('file-saved', filePath)
        } catch (e) {
          const fs = await BaseFileManager.getFs()
          fs.writeFileSync(filePath, new Uint8Array(fileData))
          eventEmitter.emit('file-saved', filePath)
        }
      } else if (typeof fileData === 'string') {
        try {
          await BaseFileManager.saveFile(filePath, fileData)
          eventEmitter.emit('file-saved', filePath)
        } catch (e) {
          const fs = await BaseFileManager.getFs()
          fs.writeFileSync(filePath, fileData)
          eventEmitter.emit('file-saved', filePath)
        }
      }
    }

    const refResolvedDisplayValue = await BaseFileManager.getContentUrlFromPath(filePath)

    let newLocalId

    if (!localId) {
      const result = await createMetadata(
        {
          propertyName,
          propertyValue: newFileSeedLocalId,
          seedLocalId,
          seedUid,
          versionLocalId,
          versionUid,
          modelName,
          schemaUid: fileSchemaUid,
          refSeedType: 'file',
          refModelUid: fileSchemaUid,
          refResolvedDisplayValue,
          refResolvedValue: fileName,
          localStorageDir: '/files',
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
        newValue: newFileSeedLocalId,
        seedLocalId,
        versionLocalId,
        modelName,
        schemaUid,
        refSeedType: 'file',
        refResolvedDisplayValue,
        refResolvedValue: fileName,
        refModelUid: fileSchemaUid,
        localStorageDir: '/files',
        easDataType: 'bytes32',
        dataType: 'File',
      } as any)
    }

    sendBack({
      type: 'updateContext',
      localId: newLocalId || localId,
      propertyValue: newFileSeedLocalId,
      refSeedType: 'file',
      refSchemaUid: fileSchemaUid,
      renderValue: refResolvedDisplayValue,
      refResolvedDisplayValue,
      refResolvedValue: fileName,
      localStorageDir: '/files',
      easDataType: 'bytes32',
      schemaUid,
    })
  }

  _saveFile()
    .then(() => sendBack({ type: 'saveFileSuccess' }))
    .catch((error) => sendBack({ type: 'saveFileError', error }))
})
