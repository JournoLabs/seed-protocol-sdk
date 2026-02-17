import { ModelProperty } from '@/ModelProperty/ModelProperty'

/**
 * Convert Model.properties array to object format (for backward compatibility)
 * This replaces the old model.schema getter
 */
export function modelPropertiesToObject(properties: ModelProperty[]): { [propertyName: string]: any } {
  const schemaObj: { [propertyName: string]: any } = {}
  
  for (const property of properties) {
    const propContext = property._getSnapshotContext()
    if (propContext.name) {
      schemaObj[propContext.name] = {
        dataType: propContext.dataType,
        ref: propContext.refModelName || propContext.ref,
        refValueType: propContext.refValueType,
        storageType: propContext.storageType,
        localStorageDir: propContext.localStorageDir,
        filenameSuffix: propContext.filenameSuffix,
      }
    }
  }
  
  return schemaObj
}

