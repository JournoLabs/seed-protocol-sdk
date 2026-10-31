import { index, int, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { InferSelectModel } from 'drizzle-orm'

/** One send of an attestation transaction. Written apart from `publish_processes` snapshots. */
export const publishAttempts = sqliteTable(
  'publish_attempts',
  {
    id: text('id').primaryKey(),
    publishRunId: text('publish_run_id'),
    seedLocalId: text('seed_local_id').notNull(),
    /** JSON array: every seed in the requests, the publishing item's included. */
    seedLocalIds: text('seed_local_ids').notNull(),
    step: text('step').notNull(), // 'multiPublish', or direct EAS's 'seed', 'version', 'properties'
    /** JSON: the normalized requests in the order they were sent, bigints as strings. */
    requests: text('requests').notNull(),
    sender: text('sender').notNull(),
    attester: text('attester').notNull(),
    chainId: int('chain_id').notNull(),
    /** EntryPoint nonce key the send is pinned to, as a decimal string. */
    nonceKey: text('nonce_key'),
    /** The EntryPoint that key is on. */
    entryPoint: text('entry_point'),
    /** Chain head just before the send, as a decimal string. */
    fromBlock: text('from_block'),
    txHash: text('tx_hash'),
    status: text('status').notNull(), // PublishAttemptStatus
    createdAt: int('created_at').notNull(),
    updatedAt: int('updated_at').notNull(),
  },
  (table) => [index('publish_attempts_status_idx').on(table.status)],
)

export type PublishAttemptType = InferSelectModel<typeof publishAttempts>
