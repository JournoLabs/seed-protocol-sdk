import { int, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { InferSelectModel } from 'drizzle-orm'

export const publishProcesses = sqliteTable('publish_processes', {
  id: int('id').primaryKey({ autoIncrement: true }),
  seedLocalId: text('seed_local_id').notNull(),
  modelName: text('model_name').notNull(),
  schemaId: text('schema_id'),
  status: text('status').notNull(), // 'in_progress' | 'completed' | 'failed' | 'interrupted'
  startedAt: int('started_at').notNull(),
  completedAt: int('completed_at'),
  errorMessage: text('error_message'),
  errorStep: text('error_step'),
  errorDetails: text('error_details'),
  persistedSnapshot: text('persisted_snapshot').notNull(),
  seedId: text('seed_id'),
  existingSeedUid: text('existing_seed_uid'),
  createdAt: int('created_at'),
  updatedAt: int('updated_at'),
})

export type PublishProcessType = InferSelectModel<typeof publishProcesses>
