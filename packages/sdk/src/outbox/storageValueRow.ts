import type { PropertyType } from '@/types'
import type { StorageValueOp, StorageValueRow } from './itemAppliers'

/** A storage op's row fields, from either op shape. */
export function storageValueRowOf(value: StorageValueOp): StorageValueRow & { propertyRecordSchema?: PropertyType } {
  if (value.row) return { ...value.row, propertyRecordSchema: value.propertyRecordSchema }
  const legacy = value.create?.values ?? {}
  return {
    refResolvedValue: legacy.refResolvedValue ?? '',
    localStorageDir: legacy.localStorageDir ?? '',
    schemaUid: (value.update?.schemaUid as string | null | undefined) ?? legacy.schemaUid,
    refModelUid: legacy.refModelUid,
    modelName: legacy.modelName ?? legacy.modelType,
    seedUid: legacy.seedUid,
    versionLocalId: legacy.versionLocalId,
    versionUid: legacy.versionUid,
    propertyRecordSchema: value.create?.propertyRecordSchema,
  }
}

