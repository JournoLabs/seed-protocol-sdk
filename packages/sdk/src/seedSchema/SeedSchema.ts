import { InferSelectModel } from 'drizzle-orm'
import { index, int, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { attestedUidSql } from './attestedUid'

export const seeds = sqliteTable(
  'seeds',
  {
    localId: text('local_id').unique(),
    uid: text('uid'),
    schemaUid: text('schema_uid'),
    type: text('type'),
    // schemaFileId of the models row this item belongs to (= Model.id). Disambiguates items whose
    // model name exists in more than one schema; null for legacy rows that couldn't be backfilled.
    modelFileId: text('model_file_id'),
    publisher: text('publisher'),
    attestationRaw: text('attestation_raw'),
    attestationCreatedAt: int('attestation_created_at'),
    // Set on insert when the writer leaves it out. No $onUpdate: readers rank rows by
    // COALESCE(attestation_created_at, created_at), and some writers move it on purpose.
    createdAt: int('created_at').$defaultFn(() => Date.now()),
    // Set on every insert and update unless the writer passes a value.
    updatedAt: int('updated_at')
      .$defaultFn(() => Date.now())
      .$onUpdate(() => Date.now()),
    _markedForDeletion: int('_marked_for_deletion'),
    revokedAt: int('revoked_at'),
  },
  (table) => [
    index('seeds_uid_idx').on(table.uid),
    index('seeds_type_idx').on(table.type),
    // One row per attested seed uid (migration 0029). Drafts hold a placeholder uid and are left out.
    uniqueIndex('seeds_attested_uid_unique').on(table.uid).where(attestedUidSql(table.uid)),
  ],
  // {
  //   triggers: [
  //     sql<string>`CREATE TRIGGER IF NOT EXISTS seeds_created_at_trigger
  //         BEFORE INSERT
  //         ON seeds
  //         FOR EACH ROW
  //     BEGIN
  //         SELECT strftime('%s', 'now') * 1000 INTO NEW.created_at;
  //     END;`,
  //   ],
  // },
)

export type SeedType = InferSelectModel<typeof seeds>
