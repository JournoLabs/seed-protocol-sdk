import { toSnakeCase } from '@/helpers'
import { getSchemaForItemProperty } from '@/helpers/getSchemaForItemProperty'

const schemaUidForSchemaDefinition = new Map<string, string>()

export const setSchemaUidForSchemaDefinition = ({ text, schemaUid }) => {
  const propertySnakeCase = toSnakeCase(text)
  schemaUidForSchemaDefinition.set(propertySnakeCase, schemaUid)
}

export const getSchemaUidForSchemaDefinition = (schemaText: string) => {
  const textSnakeCase = toSnakeCase(schemaText)
  if (!schemaUidForSchemaDefinition.has(textSnakeCase)) {
    return
  }
  return schemaUidForSchemaDefinition.get(textSnakeCase)
}

export const fetchSchemaUids = async () => {
  const versionSchemaUid = await getSchemaForItemProperty({
    propertyName: 'version',
    easDataType: 'bytes32',
  })
  if (versionSchemaUid) {
    setSchemaUidForSchemaDefinition({
      text: 'version',
      schemaUid: versionSchemaUid,
    })
  }
  const imageSchemaUid = await getSchemaForItemProperty({
    propertyName: 'image',
    easDataType: 'bytes32',
  })
  if (imageSchemaUid) {
    setSchemaUidForSchemaDefinition({
      text: 'image',
      schemaUid: imageSchemaUid,
    })
  }
}
