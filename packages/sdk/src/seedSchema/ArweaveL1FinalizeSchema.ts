import { int, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { InferSelectModel } from 'drizzle-orm'

/** Background job: resolve L1 tx id and wait for L1 confirmation after bundler publish. */
export const arweaveL1FinalizeJobs = sqliteTable(
  'arweave_l1_finalize_jobs',
  {
    id: int('id').primaryKey({ autoIncrement: true }),
    seedLocalId: text('seed_local_id').notNull(),
    dataItemId: text('data_item_id').notNull(),
    /** L1 bundle / anchor transaction id from gateway GraphQL `bundledIn.id`. */
    l1TransactionId: text('l1_transaction_id'),
    bundleId: text('bundle_id'),
    versionLocalId: text('version_local_id'),
    itemPropertyName: text('item_property_name'),
    /** `pending_l1` | `confirmed` | `failed` */
    phase: text('phase').notNull(),
    statusJson: text('status_json'),
    errorMessage: text('error_message'),
    createdAt: int('created_at').notNull(),
    updatedAt: int('updated_at').notNull(),
  },
  (table) => ({
    dataItemIdUnique: uniqueIndex('arweave_l1_finalize_jobs_data_item_id_unique').on(table.dataItemId),
  }),
)

export type ArweaveL1FinalizeJobType = InferSelectModel<typeof arweaveL1FinalizeJobs>
