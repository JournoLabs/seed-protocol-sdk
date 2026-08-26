import { getEasSchemaUidBySchemaName } from '../api.js'
import { toSnakeCase } from '../utils.js'

const schemaUidForSchemaDefinition = new Map<string, string>()
const schemaUidForModel = new Map<string, string>()

export const setSchemaUidForSchemaDefinition = ({
  text,
  schemaUid,
}: {
  text: string
  schemaUid: string
}): void => {
  schemaUidForSchemaDefinition.set(toSnakeCase(text), schemaUid)
}

export const setSchemaUidForModel = ({
  modelName,
  schemaUid,
}: {
  modelName: string
  schemaUid: string
}): void => {
  schemaUidForModel.set(modelName.toLowerCase(), schemaUid)
}

export const getSchemaUidForModelFromCache = (modelName: string): string | undefined =>
  schemaUidForModel.get(modelName.toLowerCase())

export const getEasSchemaUidForSchemaDefinition = async ({
  schemaText,
}: {
  schemaText: string
}): Promise<string | undefined> => {
  const textSnakeCase = toSnakeCase(schemaText)
  if (!schemaUidForSchemaDefinition.has(textSnakeCase)) {
    const schemaUid = await getEasSchemaUidBySchemaName({ schemaName: textSnakeCase })
    if (schemaUid) {
      setSchemaUidForSchemaDefinition({ text: textSnakeCase, schemaUid })
    }
    return schemaUid
  }
  return schemaUidForSchemaDefinition.get(textSnakeCase)
}
