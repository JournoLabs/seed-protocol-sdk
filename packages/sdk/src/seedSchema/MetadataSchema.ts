import { index, int, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { InferSelectModel } from 'drizzle-orm'
import { properties } from './ModelSchema'

export const metadata = sqliteTable('metadata', {
  localId: text('local_id').unique(),
  uid: text('uid'),
  propertyId: integer('property_id').references(() => properties.id),
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
  // Set on insert when the writer leaves it out. No $onUpdate: readers rank rows by
  // COALESCE(attestation_created_at, created_at), and some writers move it on purpose.
  createdAt: int('created_at').$defaultFn(() => Date.now()),
  // Set on every insert and update unless the writer passes a value.
  updatedAt: int('updated_at')
    .$defaultFn(() => Date.now())
    .$onUpdate(() => Date.now()),
  publisher: text('publisher'),
  // Unix seconds when this row's attestation was revoked on EAS; null while it's live (or for a
  // local, unpublished row). EAS sync keeps only the canonical attestation per (version, property
  // schema): the newest live one, or the newest revoked one when all are revoked. So a non-null
  // value marks a property kept only for its last value, not one that is present on the version.
  revokedAt: int('revoked_at'),
  // For a row EAS sync derived for an ItemStorage property from a `storage_transaction_id`
  // attestation (uid null, ref_value_type 'file', value = the transaction id): that attestation's
  // uid. Null for every other row. Marks the row as published content, not a local draft.
  derivedFromUid: text('derived_from_uid'),
  // On a cleared local row (null value): publish revokes the property's attestations instead of
  // attesting the empty value (ADR 0021). Null on every other row.
  retract: int('retract', { mode: 'boolean' }),
}, (table) => [
  index('metadata_seed_local_id_property_name_idx').on(table.seedLocalId, table.propertyName),
  index('metadata_seed_uid_idx').on(table.seedUid),
])

export type MetadataType = InferSelectModel<typeof metadata>
