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
import { getDataTypeFromString, getMimeType, toMetadataPropertyName } from '@/helpers'
import { getEasSchemaUidForModel } from '@/db/read/getSchemaUidForModel'
import { getEasSchemaForItemProperty } from '@/helpers/getSchemaForItemProperty'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { ImageSize } from '@/helpers/constants'
import { storageFileNameForNewSeed } from '@/helpers/storageFileName'


/** Fetch image from URL (including blob:) and return { buffer, mimeType } for saving as binary. */
const fetchImageAsBuffer = async (url: string): Promise<{ buffer: ArrayBuffer; mimeType?: string }> => {
  const response = await fetch(url)
  const mimeType = response.headers.get('Content-Type')?.split(';')[0]?.trim()
  const imageBuffer = await response.arrayBuffer()
  return { buffer: imageBuffer, mimeType: mimeType || undefined }
}

let imageSchemaUid: string | undefined

export const saveImage = fromCallback<
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

  const _saveImage = async (): Promise<void> => {
    if (!propertyNameRaw) {
      throw new Error('propertyName is required')
    }
    const propertyName = toMetadataPropertyName(propertyNameRaw, 'Image')

    let newValueType
    let fileData: string | ArrayBuffer | undefined
    let mimeType
    let fileName

    if (!imageSchemaUid) {
      const fetchedSchemaUid = await getEasSchemaUidForModel('Image')
      imageSchemaUid = fetchedSchemaUid ?? undefined
    }

    // Handle existing file reference: filename from listImageFiles() that exists in images folder.
    // Check before classifying the string: a filename like "photo.png" also matches the URL regex
    // and would otherwise be fetched relative to the page.
    let isExistingFileReference = false
    if (typeof newValue === 'string' && !newValue.includes('/') && !newValue.startsWith('data:')) {
      const existingFilePath = BaseFileManager.getFilesPath('images', newValue)
      if (await BaseFileManager.pathExists(existingFilePath)) {
        isExistingFileReference = true
        fileName = newValue
      }
    }

    if (typeof newValue === 'string' && !isExistingFileReference) {
      newValueType = getDataTypeFromString(newValue)
    }

    if (newValueType === 'imageBase64') {
      mimeType = getMimeType(newValue as string)
      const base64Data = (newValue as string).split(',')[1] // Strip the Base64 prefix
      const binaryString = atob(base64Data)

      const binaryLength = binaryString.length
      const binaryArray = new Uint8Array(binaryLength)
      for (let i = 0; i < binaryLength; i++) {
        binaryArray[i] = binaryString.charCodeAt(i)
      }
      fileData = binaryArray.buffer
    }

    if (newValueType === 'url') {
      const { buffer, mimeType: fetchedMime } = await fetchImageAsBuffer(newValue as string)
      fileData = buffer
      if (fetchedMime) mimeType = fetchedMime
    }

    if (newValue instanceof File) {
      fileName = newValue.name
      mimeType = newValue.type
      fileData = await newValue.arrayBuffer() // Blob API: works in browsers and Node (no FileReader in Node)
    }

    if (newValue instanceof Blob) {
      mimeType = newValue.type || 'image/png'
      fileData = await newValue.arrayBuffer()
    }

    if (!fileData && !isExistingFileReference) {
      throw new Error('No file data found')
    }

    // Named now so the file can be named after it; the seed row is written when the op applies
    const newImageSeedLocalId = generateId()

    if (!fileName) {
      fileName = newImageSeedLocalId
      if (mimeType) {
        fileName += `.${mimeType.split('/')[1]}`
      }
    } else if (!isExistingFileReference) {
      fileName = storageFileNameForNewSeed(newImageSeedLocalId, fileName)
    }

    const filePath = BaseFileManager.getFilesPath('images', fileName)

    await BaseFileManager.createDirIfNotExists(BaseFileManager.getFilesPath('images'))

    if (fileData instanceof ArrayBuffer) {
      try {
        await BaseFileManager.saveFile(filePath, fileData)
        notifyFileSaved(filePath)
      } catch {
        const fs = await BaseFileManager.getFs()
        fs.writeFileSync(filePath, new Uint8Array(fileData))
        notifyFileSaved(filePath)
      }
    }

    if (typeof fileData === 'string') {
      try {
        await BaseFileManager.saveFile(filePath, fileData)
        notifyFileSaved(filePath)
      } catch {
        const fs = await BaseFileManager.getFs()
        fs.writeFileSync(filePath, fileData)
        notifyFileSaved(filePath)
      }
    }

    const refResolvedDisplayValue = await BaseFileManager.getContentUrlFromPath(filePath)

    const resolvedPropertySchemaUid =
      schemaUid && schemaUid !== imageSchemaUid
        ? schemaUid
        : (await getEasSchemaForItemProperty({
            propertyName,
            easDataType: 'bytes32',
          }))?.id

    const written = await writeStorageValue(
      { seedLocalId, seedUid, propertyName },
      {
        storageSeed: {
          localId: newImageSeedLocalId,
          type: 'image',
          modelFileId: INTERNAL_STORAGE_MODEL_FILE_IDS.image,
          fields: await resolveNewSeedFields('image'),
        },
        // A reference to a file that was already there isn't this value's to delete
        ownedFilePath: isExistingFileReference ? undefined : filePath,
        create: {
          values: {
            propertyName,
            propertyValue: newImageSeedLocalId,
            seedUid,
            versionLocalId,
            versionUid,
            modelName,
            schemaUid: resolvedPropertySchemaUid,
            refSeedType: 'image',
            refModelUid: imageSchemaUid,
            refResolvedValue: fileName,
            localStorageDir: '/images',
            easDataType: 'bytes32',
          },
          propertyRecordSchema,
        },
        update: {
          newValue: newImageSeedLocalId,
          versionLocalId,
          modelName,
          schemaUid: resolvedPropertySchemaUid,
          refSeedType: 'image',
          refResolvedValue: fileName,
          refModelUid: imageSchemaUid,
          localStorageDir: '/images',
          easDataType: 'bytes32',
          dataType: 'Image',
        },
      },
    )
    // A newer value superseded this one; its save sets the context
    if (written.skipped) return

    // Resize the image now it's stored (not for a reference to an existing file, which may already
    // have sized versions, nor for a value a newer one superseded: its file is gone)
    // Resize may not be implemented in all environments (e.g. Node); continue save if it fails
    if (!isExistingFileReference) {
      try {
        // Resize can hang (e.g. browser workers); timeout so we don't block metadata update.
        // File is already saved - sized versions are optional for display optimization.
        const RESIZE_TIMEOUT_MS = 8000
        await Promise.race([
          (async () => {
            await BaseFileManager.resizeImage({ filePath, width: ImageSize.EXTRA_SMALL, height: ImageSize.EXTRA_SMALL })
            await BaseFileManager.resizeImage({ filePath, width: ImageSize.SMALL, height: ImageSize.SMALL })
            await BaseFileManager.resizeImage({ filePath, width: ImageSize.MEDIUM, height: ImageSize.MEDIUM })
            await BaseFileManager.resizeImage({ filePath, width: ImageSize.LARGE, height: ImageSize.LARGE })
            await BaseFileManager.resizeImage({ filePath, width: ImageSize.EXTRA_LARGE, height: ImageSize.EXTRA_LARGE })
          })(),
          new Promise<void>((resolve) => setTimeout(resolve, RESIZE_TIMEOUT_MS)),
        ])
      } catch {
        // Resize not implemented in this environment (e.g. Node); file is already saved
      }
    }

    sendBack({
      type: 'updateContext',
      localId,
      ...written.row,
      propertyValue: newImageSeedLocalId,
      refSeedType: 'image',
      refSchemaUid: imageSchemaUid,
      renderValue: refResolvedDisplayValue,
      refResolvedDisplayValue,
      refResolvedValue: fileName,
      localStorageDir: '/images',
      easDataType: 'bytes32',
      schemaUid,
    })
  }

  _saveImage()
    .then(() => sendBack({ type: 'saveImageSuccess' }))
    .catch((error) => sendBack({ type: 'saveImageError', error }))
})
