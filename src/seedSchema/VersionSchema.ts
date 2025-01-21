import { int, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const versions = sqliteTable('versions', {
  localId: text('local_id').unique(),
  uid: text('uid'),
  seedLocalId: text('seed_local_id'),
  seedUid: text('seed_uid'),
  seedType: text('seed_type'),
  note: text('note'),
  createdAt: int('created_at'),
  updatedAt: int('updated_at'),
  attestationCreatedAt: int('attestation_created_at'),
  attestationRaw: text('attestation_raw'),
})

export type VersionsType = versions.$inferSelect
