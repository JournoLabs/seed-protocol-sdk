import { EventObject, fromCallback } from 'xstate'
import { FromCallbackInput } from '@/types/machines'
import {
  ItemPropertyValueType,
  PropertyMachineContext,
  SaveValueToDbEvent,
} from '@/types/property'
import { createSeed } from '@/db/write/createSeed'
import { getDataTypeFromString, getMimeType } from '@/helpers'
import { createVersion } from '@/db/write/createVersion'
import { fs } from '@zenfs/core'
import { getContentUrlFromPath } from '@/helpers'
import { createMetadata } from '@/db/write/createMetadata'
import { updateItemPropertyValue } from '@/db/write/updateItemPropertyValue'
import { getSchemaUidForSchemaDefinition } from '@/stores/eas'
import { getSchemaUidForModel } from '@/db/read/getSchemaUidForModel'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'

const readFileAsDataUrl = async (file: File): Promise<string> => {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = async (e) => {
      const base64 = e.target.result.split(',')[1] // Extract the base64 string
      const mimeType = file.type // Get the file's MIME type
      const base64WithMimeType = `data:${mimeType};base64,${base64}`

      resolve(base64WithMimeType)
    }

    reader.readAsDataURL(file)
  })
}

const readFileAsArrayBuffer = async (file: File): Promise<ArrayBuffer> => {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = async (e) => {
      const arrayBuffer = e.target.result as ArrayBuffer

      resolve(arrayBuffer)
    }

    reader.readAsArrayBuffer(file)
  })
}

const fetchImage = async (url: string) => {
  const response = await fetch(url)
  const mimeType = response.headers.get('Content-Type')
  const imageBuffer = await response.arrayBuffer()
  const bytes = new Uint8Array(imageBuffer)

  const binaryString = bytes.reduce(
    (acc, byte) => acc + String.fromCharCode(byte),
    '',
  )

  let base64 = btoa(binaryString)

  if (mimeType) {
    base64 = `data:${mimeType};base64,${base64}`
  }

  return base64
}

let imageSchemaUid: string | undefined

export const saveImageSrc = fromCallback<
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

  const _saveImageSrc = async (): Promise<void> => {
    let propertyName = propertyNameRaw

    if (!propertyNameRaw.endsWith('Id')) {
      propertyName = `${propertyName}Id`
    }

    let newValueType
    let fileData: string | ArrayBuffer | undefined
    let mimeType
    let fileName

    if (!imageSchemaUid) {
      imageSchemaUid = await getSchemaUidForModel('Image')
    }

    if (typeof newValue === 'string') {
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
      fileData = await fetchImage(newValue as string)
    }

    if (newValue instanceof File) {
      fileName = newValue.name
      mimeType = newValue.type
      fileData = await readFileAsArrayBuffer(newValue)
    }

    if (!fileData) {
      throw new Error('No file data found')
    }

    const newImageSeedLocalId = await createSeed({
      type: 'image',
    })

    if (!fileName) {
      fileName = newImageSeedLocalId
      if (mimeType) {
        fileName += `.${mimeType.split('/')[1]}`
      }
    }

    const filePath = `/files/images/${fileName}`

    const imageVersionLocalId = await createVersion({
      seedLocalId: newImageSeedLocalId,
      seedType: 'image',
    })

    if (fileData instanceof ArrayBuffer) {
      try {
        await fs.promises.writeFile(filePath, new Uint8Array(fileData))
      } catch (e) {
        fs.writeFileSync(filePath, new Uint8Array(fileData))
      }
    }

    if (typeof fileData === 'string') {
      try {
        await fs.promises.writeFile(filePath, fileData)
      } catch (e) {
        fs.writeFileSync(filePath, fileData)
      }
    }

    const refResolvedDisplayValue = await BaseFileManager.getContentUrlFromPath(filePath)

    if (!schemaUid) {
      schemaUid = getSchemaUidForSchemaDefinition(propertyName)
    }

    if (!localId) {
      await createMetadata(
        {
          propertyName,
          propertyValue: newImageSeedLocalId,
          seedLocalId,
          seedUid,
          versionLocalId,
          versionUid,
          modelName,
          schemaUid,
          refSeedType: 'image',
          refModelUid: imageSchemaUid,
          refSchemaUid: imageSchemaUid,
          refResolvedDisplayValue,
          refResolvedValue: fileName,
          localStorageDir: '/images',
          easDataType: 'bytes32',
        },
        propertyRecordSchema,
      )
    }

    if (localId) {
      await updateItemPropertyValue({
        localId: localId,
        propertyName: propertyNameRaw,
        newValue: newImageSeedLocalId,
        seedLocalId,
        versionLocalId,
        modelName,
        schemaUid,
        refSeedType: 'image',
        refResolvedDisplayValue,
        refResolvedValue: fileName,
        refModelUid: imageSchemaUid,
        refSchemaUid: imageSchemaUid,
        localStorageDir: '/images',
        easDataType: 'bytes32',
      })
    }

    sendBack({
      type: 'updateContext',
      propertyValue: newImageSeedLocalId,
      refSeedType: 'image',
      refSchemaUid: imageSchemaUid,
      renderValue: refResolvedDisplayValue,
      refResolvedDisplayValue: refResolvedDisplayValue,
      refResolvedValue: fileName,
      localStorageDir: '/images',
      easDataType: 'bytes32',
    })
  }

  _saveImageSrc().then(() => {
    sendBack({ type: 'saveImageSrcSuccess' })
  })
})