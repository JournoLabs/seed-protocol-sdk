import { int, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { InferSelectModel } from 'drizzle-orm'

export const versions = sqliteTable('versions', {
  localId: text('local_id').unique(),
  uid: text('uid'),
  seedLocalId: text('seed_local_id'),
  seedUid: text('seed_uid'),
  seedType: text('seed_type'),
  note: text('note'),
  // Set on insert when the writer leaves it out. No $onUpdate: readers rank rows by
  // COALESCE(attestation_created_at, created_at), and some writers move it on purpose.
  createdAt: int('created_at').$defaultFn(() => Date.now()),
  // Set on every insert and update unless the writer passes a value.
  updatedAt: int('updated_at')
    .$defaultFn(() => Date.now())
    .$onUpdate(() => Date.now()),
  attestationCreatedAt: int('attestation_created_at'),
  attestationRaw: text('attestation_raw'),
  publisher: text('publisher'),
  /**
   * When the version attestation was revoked, in Unix seconds (EAS `revocationTime`, or the local
   * unpublish time until sync confirms it). Null while live or unpublished.
   */
  revokedAt: int('revoked_at'),
})

export type VersionsType = InferSelectModel<typeof versions>
