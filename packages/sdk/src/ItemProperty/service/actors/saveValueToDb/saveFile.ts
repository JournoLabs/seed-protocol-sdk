import { INTERNAL_STORAGE_MODEL_FILE_IDS } from '@/helpers/constants'
import { notifyFileSaved } from '@/helpers/tabEvents'
import { EventObject, fromCallback } from 'xstate'
import { FromCallbackInput } from '@/types/machines'
import {
  ItemPropertyValueType,
  PropertyMachineContext,
  SaveValueToDbEvent,
} from '@/types/property'
import { createSeed } from '@/db/write/createSeed'
import { toMetadataPropertyName } from '@/helpers'
import { createVersion } from '@/db/write/createVersion'
import { createMetadata } from '@/db/write/createMetadata'
import { updateItemPropertyValue } from '@/db/write/updateItemPropertyValue'
import { rowContext } from './rowContext'
import { getEasSchemaUidForModel } from '@/db/read/getSchemaUidForModel'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { storageFileNameForNewSeed } from '@/helpers/storageFileName'

let fileSchemaUid: string | undefined

/**
 * What a string assigned to a File property means:
 * - `data:` URL: its decoded bytes
 * - `http(s):` or `blob:` URL: fetched
 * - the name of a file already in the files folder: a reference to it
 * - anything else: the file's text content
 * (Bare strings used to be decoded as base64 when they looked like it, so "hello" became
 * garbage, and names like "photo.jpg" were fetched as URLs.)
 */
export async function classifyFileString(
  value: string,
): Promise<{ kind: 'dataUrl'; bytes: ArrayBuffer } | { kind: 'url' } | { kind: 'existing' } | { kind: 'text' }> {
  const dataUrl = /^data:([^,]*?)(;base64)?,(.*)$/s.exec(value)
  if (dataUrl) {
    const [, , isBase64, payload] = dataUrl
    const bytes = isBase64
      ? Uint8Array.from(atob(payload), (c) => c.charCodeAt(0))
      : new TextEncoder().encode(decodeURIComponent(payload))
    return { kind: 'dataUrl', bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer }
  }
  if (/^(https?:\/\/|blob:)/i.test(value)) {
    return { kind: 'url' }
  }
  if (!/[\\/]/.test(value) && value.length < 256) {
    const existingFilePath = BaseFileManager.getFilesPath('files', value)
    if (await BaseFileManager.pathExists(existingFilePath)) {
      return { kind: 'existing' }
    }
  }
  return { kind: 'text' }
}

export const saveFile = fromCallback<
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

    let isExistingFileReference = false
    if (typeof newValue === 'string') {
      const source = await classifyFileString(newValue)
      if (source.kind === 'dataUrl') {
        fileData = source.bytes
      } else if (source.kind === 'url') {
        const response = await fetch(newValue)
        fileData = await response.arrayBuffer()
        if (!newValue.startsWith('blob:')) {
          fileName = new URL(newValue).pathname.split('/').pop() || undefined
        }
      } else if (source.kind === 'existing') {
        isExistingFileReference = true
        fileName = newValue
      } else {
        fileData = newValue
      }
    }

    if (newValue instanceof File) {
      fileName = newValue.name
      fileData = await newValue.arrayBuffer() // Blob API: works in browsers and Node (no FileReader in Node)
    }

    if (!fileData && !isExistingFileReference) {
      throw new Error('No file data found')
    }

    const newFileSeedLocalId = await createSeed({
      type: 'file',
      modelFileId: INTERNAL_STORAGE_MODEL_FILE_IDS.file,
    })

    if (!fileName) {
      fileName = newFileSeedLocalId
    } else if (!isExistingFileReference) {
      fileName = storageFileNameForNewSeed(newFileSeedLocalId, fileName)
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
          notifyFileSaved(filePath)
        } catch {
          const fs = await BaseFileManager.getFs()
          fs.writeFileSync(filePath, new Uint8Array(fileData))
          notifyFileSaved(filePath)
        }
      } else if (typeof fileData === 'string') {
        try {
          await BaseFileManager.saveFile(filePath, fileData)
          notifyFileSaved(filePath)
        } catch {
          const fs = await BaseFileManager.getFs()
          fs.writeFileSync(filePath, fileData)
          notifyFileSaved(filePath)
        }
      }
    }

    // A session URL (blob: in browsers, file:// in Node): it goes in the context only. Stored, it is a
    // dead blob: URL after reload, so readers mint their own from the path, as for Image.
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

    let writtenRow: Partial<PropertyMachineContext> = {}
    if (localId) {
      writtenRow = rowContext(await updateItemPropertyValue({
        localId,
        propertyName,
        newValue: newFileSeedLocalId,
        seedLocalId,
        versionLocalId,
        modelName,
        schemaUid,
        refSeedType: 'file',
        refResolvedValue: fileName,
        refModelUid: fileSchemaUid,
        localStorageDir: '/files',
        easDataType: 'bytes32',
        dataType: 'File',
      } as any))
    }

    sendBack({
      type: 'updateContext',
      localId: newLocalId || localId,
      ...writtenRow,
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
