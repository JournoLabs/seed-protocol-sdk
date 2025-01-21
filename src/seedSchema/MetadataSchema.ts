import { int, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const metadata = sqliteTable('metadata', {
  localId: text('local_id').unique(),
  uid: text('uid'),
  propertyName: text('property_name'),
  propertyValue: text('property_value'),
  schemaUid: text('schema_uid'),
  modelType: text('model_type'),
  seedLocalId: text('seed_local_id'),
  seedUid: text('seed_uid'),
  versionLocalId: text('version_local_id'),
  versionUid: text('version_uid'),
  easDataType: text('eas_data_type'),
  refValueType: text('ref_value_type'),
  refModelUid: text('ref_schema_uid'),
  refSeedType: text('ref_seed_type'),
  refResolvedValue: text('ref_resolved_value'),
  refResolvedDisplayValue: text('ref_resolved_display_value'),
  localStorageDir: text('local_storage_dir'),
  attestationRaw: text('attestation_raw'),
  attestationCreatedAt: int('attestation_created_at'),
  contentHash: text('content_hash'),
  createdAt: int('created_at'),
  updatedAt: int('updated_at'),
})

export type MetadataType = metadata.$inferSelect
