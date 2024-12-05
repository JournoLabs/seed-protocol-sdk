import { int, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const seeds = sqliteTable(
  'seeds',
  {
    localId: text('local_id').unique(),
    uid: text('uid'),
    schemaUid: text('schema_uid'),
    type: text('type'),
    attestationRaw: text('attestation_raw'),
    attestationCreatedAt: int('attestation_created_at'),
    createdAt: int('created_at'),
    updatedAt: int('updated_at'),
    _markedForDeletion: int('_marked_for_deletion'),
  },
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

export type SeedType = seeds.$inferSelect
