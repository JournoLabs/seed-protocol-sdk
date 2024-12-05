import originalDayjs from 'dayjs'
import { customAlphabet } from 'nanoid'
import * as nanoIdDictionary from 'nanoid-dictionary'
import { fs } from '@zenfs/core'
import debug from 'debug'

const logger = debug('app:shared:helpers')

export const dayjs = originalDayjs

const { alphanumeric } = nanoIdDictionary

export const generateId = (): string => {
  return customAlphabet(alphanumeric, 10)()
}

export const toSnakeCase = (str: string) => {
  return str.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase()
}

export const identifyString = (str: string) => {
  try {
    JSON.parse(str)
    return 'json'
  } catch (e) {
    // Not JSON
  }

  if (!str) {
    return
  }

  if (str.trim().startsWith('<') && str.trim().endsWith('>')) {
    return 'html'
  }

  // Simple markdown checks (very naive)
  if (/^#{1,6}\s|^-{3,}|\*{3,}|^-{1,2}\s|\*\s/.test(str)) {
    return 'markdown'
  }

  if (/^data:image\/[a-zA-Z]+;base64,[A-Za-z0-9+/]+={0,2}$/.test(str)) {
    return 'base64'
  }

  // Default to plain text if unsure
  return 'text'
}

export const getMimeType = (base64: string) => {
  if (!base64) {
    return null
  }
  const result = base64.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+).*,/)

  if (result && result.length > 1) {
    return result[1]
  } else {
    return null // MIME type could not be determined
  }
}

export const getDataTypeFromString = (
  data: string,
): 'imageBase64' | 'base64' | 'url' | null => {
  const nonImageBase64Regex =
    /^(?!data:image\/(?:jpeg|png|gif|bmp|webp);base64,)[A-Za-z0-9+/=]+$/

  if (nonImageBase64Regex.test(data)) {
    return 'base64'
  }

  // Regular expression for base64 (simple version, checking for base64 format)
  const imageBase64Regex = /^data:image\/[a-zA-Z]+;base64,[A-Za-z0-9+/]+={0,2}$/

  if (imageBase64Regex.test(data)) {
    return 'imageBase64'
  }

  // Regular expression for URL (simple version, checking for common URL format)
  const urlRegex =
    /^(http:\/\/www\.|https:\/\/www\.|http:\/\/|https:\/\/)?[a-z0-9]+([\-\.]{1}[a-z0-9]+)*\.[a-z]{2,5}(:[0-9]{1,5})?(\/.*)?$/

  if (urlRegex.test(data)) {
    return 'url'
  }

  return null
}

export const convertTxIdToImageSrc = async (
  txId: string,
): Promise<string | undefined> => {
  const imageFilePath = `/files/images/${txId}`
  const fileExists = await fs.promises.exists(imageFilePath)
  if (!fileExists) {
    logger(`[ItemView] [updateImageSrc] ${imageFilePath} does not exist`)
    return
  }
  const uint = await fs.promises.readFile(imageFilePath)

  const imageBlob = new Blob([uint])

  return URL.createObjectURL(imageBlob)
}

export const getExecutionTime = async (task, args) => {
  const start = Date.now()
  await task(...args)
  return Date.now() - start
}

export const parseEasRelationPropertyName = (easPropertyName: string) => {
  // Split the input string on the first underscore
  const [singularProperty, modelName, idSegment] = easPropertyName.split('_')

  // If there are any other parts, assume it is a list (e.g., has 'ids' or other suffix)
  const isList = idSegment === 'ids'

  // Create the final property name by pluralizing the singular part
  const propertyName = singularProperty.endsWith('s')
    ? singularProperty
    : singularProperty + 's'

  return {
    propertyName, // Plural form of the property name
    modelName, // Model name extracted from the second part
    isList, // True if the property is a list (e.g., 'ids' is present)
  }
}
