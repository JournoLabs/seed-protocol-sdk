import { getEasSchemaUidBySchemaName } from '@/eas'
import { toSnakeCase } from '@/helpers'
import { getEasSchemaForItemProperty } from '@/helpers/getSchemaForItemProperty'

const schemaUidForSchemaDefinition = new Map<string, string>()

type SetSchemaUidForSchemaDefinitionProps = {
  text: string
  schemaUid: string
}

type SetSchemaUidForSchemaDefinition = (
  props: SetSchemaUidForSchemaDefinitionProps,
) => void

export const setSchemaUidForSchemaDefinition: SetSchemaUidForSchemaDefinition = ({ text, schemaUid }) => {
  const propertySnakeCase = toSnakeCase(text)
  schemaUidForSchemaDefinition.set(propertySnakeCase, schemaUid)
}

type GetSchemaUidForSchemaDefinitionProps = {
  schemaText: string
}

type GetSchemaUidForSchemaDefinition = (
  props: GetSchemaUidForSchemaDefinitionProps,
) => Promise<string | undefined>

export const getEasSchemaUidForSchemaDefinition: GetSchemaUidForSchemaDefinition = async ({ schemaText }) => {
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

export const fetchSchemaUids = async () => {
  const versionSchema = await getEasSchemaForItemProperty({
    propertyName: 'version',
    easDataType: 'bytes32',
  })
  if (versionSchema) {
    setSchemaUidForSchemaDefinition({
      text: 'version',
      schemaUid: versionSchema.id,
    })
  }
  const imageSchema = await getEasSchemaForItemProperty({
    propertyName: 'image',
    easDataType: 'bytes32',
  })
  if (imageSchema) {
    setSchemaUidForSchemaDefinition({
      text: 'image',
      schemaUid: imageSchema.id,
    })
  }
}
