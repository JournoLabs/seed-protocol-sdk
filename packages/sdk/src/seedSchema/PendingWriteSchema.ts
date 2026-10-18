import { index, int, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { InferInsertModel, InferSelectModel } from 'drizzle-orm'

/**
 * The item write outbox (ADR 0019): one row per edit to an item, appended when the value is
 * assigned and applied to `seeds`, `versions` and `metadata` by the leader tab's drainer.
 */
export const pendingWrites = sqliteTable(
  'pending_writes',
  {
    id: int('id').primaryKey({ autoIncrement: true }),
    /** Unique per op; the drainer and `save()` refer to an op by it. */
    opId: text('op_id').notNull(),
    /** Ops that apply together in one transaction (Item.create's seed, version and metadata rows). */
    groupId: text('group_id'),
    seedLocalId: text('seed_local_id').notNull(),
    /** Null for ops on the seed itself (`create`, `delete`). */
    propertyName: text('property_name'),
    /** `create` | `set` | `delete` | `storage` */
    kind: text('kind').notNull(),
    /** JSON-encoded value. */
    value: text('value'),
    /** A staged file a `storage` op's value was written to, moved into place when it applies. */
    valueRef: text('value_ref'),
    /** The stored metadata row the edit was made against, to detect a synced row written since. */
    baseRowId: text('base_row_id'),
    baseUid: text('base_uid'),
    createdAt: int('created_at').notNull(),
    /** The tab that appended the op. */
    tabId: text('tab_id'),
    /** `pending` | `applied` | `superseded` | `failed`. An op is claimed and applied in one transaction. */
    status: text('status').notNull(),
    error: text('error'),
    attempts: int('attempts').notNull().default(0),
    appliedAt: int('applied_at'),
    /** JSON the applier recorded when the op applied (for a `set`: the metadata row written). */
    result: text('result'),
    /** JSON: the synced value this op was applied over, when there was one (ADR 0019). */
    conflict: text('conflict'),
    conflictResolvedAt: int('conflict_resolved_at'),
  },
  (table) => ({
    opIdUnique: uniqueIndex('pending_writes_op_id_unique').on(table.opId),
    /** The drainer's order: per property, oldest first, among one status. */
    drainOrder: index('pending_writes_drain_order').on(
      table.status,
      table.seedLocalId,
      table.propertyName,
      table.createdAt,
    ),
  }),
)

export type PendingWriteType = InferSelectModel<typeof pendingWrites>
export type NewPendingWrite = InferInsertModel<typeof pendingWrites>
