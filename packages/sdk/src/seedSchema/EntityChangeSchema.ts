import { index, int, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { InferSelectModel } from 'drizzle-orm'

/**
 * The entity change log (ADR 0020): one row per row written to `seeds`, `versions` or `metadata`,
 * inserted by triggers (migration 0022), so it commits or rolls back with the write. The browser's
 * change feed reads it to tell loaded Items and ItemProperties which seeds changed. Nothing else
 * writes it; the leader tab prunes rows older than 10 minutes.
 */
export const entityChanges = sqliteTable(
  'entity_changes',
  {
    seq: int('seq').primaryKey({ autoIncrement: true }),
    /** `seeds` | `versions` | `metadata` */
    tbl: text('tbl').notNull(),
    seedLocalId: text('seed_local_id'),
    seedUid: text('seed_uid'),
    /** Set for `metadata` rows only. */
    propertyName: text('property_name'),
    /** Unix ms when the trigger ran. */
    at: int('at').notNull(),
  },
  (table) => ({
    at: index('entity_changes_at').on(table.at),
  }),
)

export type EntityChangeType = InferSelectModel<typeof entityChanges>
