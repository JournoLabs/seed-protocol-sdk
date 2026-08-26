export {
  setSchemaUidForSchemaDefinition,
  setSchemaUidForModel,
  getSchemaUidForModelFromCache,
  getEasSchemaUidForSchemaDefinition,
} from '@seedprotocol/eas'
import { getEasSchemaForItemProperty } from '@/helpers/getSchemaForItemProperty'
import { setSchemaUidForSchemaDefinition } from '@seedprotocol/eas'

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
